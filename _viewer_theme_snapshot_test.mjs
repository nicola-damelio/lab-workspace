/* =========================================================================
   _viewer_theme_snapshot_test.mjs — LES DEUX MODES D'ENREGISTREMENT.

   La demande : « Obiettivo è implementare un sistema di salvataggio e
   caricamento a due modalità … Salvataggio Cumulativo (Theme/Preset
   universale) … Salvataggio della Scena Specifica (Snapshot esatto) ».

     MODE 1 · THÈME — un dictionnaire de styles par CLASSE MOLÉCULAIRE
       (protéine · acide nucléique · lipide · sucre · ligand · eau · ion),
       indépendant du système chargé. Sauvegarde = MERGE (la « regola aurea » :
       les classes absentes de la scène RESTENT dans le fichier), et si deux
       molécules d'une même classe sont dessinées différemment, la barre DEMANDE
       laquelle devient le défaut de la classe. Chargement = application PARTIELLE
       (environnement global + les classes connues ; une classe inconnue garde le
       style de base NEUTRE, que le prochain enregistrement apprendra).
     MODE 2 · SNAPSHOT — l'état exact de CE système, clé par SECTION
       (« protein · chain A » …), sans aucun merge : un fichier isolé, rejoué sur
       les mêmes sections (par id, puis par clé de section).

   Ce qui est vérifié ici est EXÉCUTÉ (le merge, la capture de l'environnement, le
   lecteur des deux magasins), le reste est lu dans la source — comme les autres
   garde-fous du viewer, qui est un .jsx et ne s'importe pas sous Node.
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

const SRC = process.env.VIEWER_SRC || new URL('./src/components/NMRMoleculeViewer.jsx', import.meta.url);
const VIEW = readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');
const has = (needle, what) => ok(VIEW.includes(needle), `${what}\n  introuvable : ${needle}`);
const gone = (needle, what) => ok(!VIEW.includes(needle), `${what}\n  encore présent : ${needle}`);
const countOf = (re) => (VIEW.match(re) || []).length;

/* ── Extraction : `const name = (…) => { … };` ───────────────────────────── */
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
const sliceArray = (src, name) => {
  const start = src.indexOf(`const ${name} = [`);
  assert.ok(start >= 0, `tableau ${name} introuvable`);
  const end = src.indexOf('];', start);
  assert.ok(end > start, `tableau ${name} non terminé`);
  return src.slice(start, end + 2);
};
// Les flèches d'UNE ligne (`const f = (x) => expr;`) : coupées à la fin de la ligne.
const sliceArrow = (src, name) => {
  const start = src.indexOf(`const ${name} = (`);
  assert.ok(start >= 0, `fonction ${name} introuvable`);
  const lineEnd = src.indexOf('\n', start);
  assert.ok(lineEnd > start, `fonction ${name} : ligne non terminée`);
  const line = src.slice(start, lineEnd).trimEnd();
  return line.endsWith(';') ? line : `${line};`;
};

/* ── Le banc d'essai : le merge RÉEL, la capture RÉELLE, un localStorage doublure ── */
const sandbox = [
  sliceArray(VIEW, 'THEME_GLOBAL_KEYS'),
  sliceFn(VIEW, 'captureThemeGlobal'),
  sliceArrow(VIEW, 'classStyleSig'),
  sliceFn(VIEW, 'mergeThemeClasses'),
  sliceFn(VIEW, 'loadNamedMap'),
  sliceFn(VIEW, 'saveNamedMap'),
  `const VIEWER_THEME_KEY = ${(/'labViewerThemes'/.exec(VIEW) || [''])[0] || "''"};`,
  `const VIEWER_SNAPSHOT_KEY = ${(/'labViewerSnapshots'/.exec(VIEW) || [''])[0] || "''"};`,
  'return { THEME_GLOBAL_KEYS, captureThemeGlobal, classStyleSig, mergeThemeClasses, loadNamedMap, saveNamedMap, VIEWER_THEME_KEY, VIEWER_SNAPSHOT_KEY };',
].join('\n');
const store = new Map();
const fakeLocalStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
};
const H = new Function('__ls', sandbox.replace(/\blocalStorage\b/g, '__ls'))(fakeLocalStorage);

/* ══ 1. LES DEUX MAGASINS SONT SÉPARÉS ════════════════════════════════════ */
eq(H.VIEWER_THEME_KEY, 'labViewerThemes', 'le thème a son propre magasin');
eq(H.VIEWER_SNAPSHOT_KEY, 'labViewerSnapshots', 'le snapshot aussi');
H.saveNamedMap(H.VIEWER_THEME_KEY, { A: { v: 1 } });
eq(H.loadNamedMap(H.VIEWER_THEME_KEY), { A: { v: 1 } }, '…et un nom écrit se relit');
eq(H.loadNamedMap(H.VIEWER_SNAPSHOT_KEY), {}, 'les deux magasins ne se mélangent pas');
store.set(H.VIEWER_THEME_KEY, 'pas du json');
eq(H.loadNamedMap(H.VIEWER_THEME_KEY), {}, 'un magasin illisible rend un objet vide (jamais une exception)');
store.set(H.VIEWER_THEME_KEY, JSON.stringify({ bon: { v: 1 }, mauvais: 'texte', liste: [1, 2], nul: null }));
eq(Object.keys(H.loadNamedMap(H.VIEWER_THEME_KEY)), ['bon'],
  'les entrées qui ne sont pas des objets sont ignorées (un fichier étranger ne casse rien)');

/* ══ 2. L'ENVIRONNEMENT GLOBAL DES DEUX MODES ═════════════════════════════ */
const setup = {
  v: 1, catStyles: { protein: { style: 'cartoon' } }, catLabels: { protein: {} },
  sidechainStyle: 'ball+stick', sstrucColors: { helix: 1, sheet: 2, loop: 3 },
  selectedResidueColor: 255, assignedAtomColor: 65280,
  fog: true, shadows: { on: true }, clip: { on: false }, background: '#101010',
  quality: true, large: { style: 'line' }, generalLook: { foo: 'bar' },
  palettes: { elements: {} }, savedAt: 'hier',
};
const glob = H.captureThemeGlobal(setup);
ok(glob.fog === true && glob.background === '#101010' && glob.clip && glob.shadows,
  'la capture garde la scène : brouillard · fond · clipping · ombres');
ok(glob.generalLook && glob.palettes && glob.sstrucColors && glob.catStyles,
  '…et la roue ⚙ (palettes + look général), les couleurs de 2°-structure et les menus');
eq(Object.keys(glob).sort(), [...H.THEME_GLOBAL_KEYS].sort(),
  'RIEN d’autre : ni la version, ni la date, ni un champ inconnu');
ok(!('savedAt' in glob) && !('v' in glob), '…en particulier pas les métadonnées du fichier');
has('const applyThemeGlobal = (global) => applyViewerSetup(', 'l’environnement est relu par le LECTEUR des ⚙️ setups');
ok(VIEW.indexOf('const applyThemeGlobal = (global)') > VIEW.indexOf('const applyViewerSetup = (s) => {'),
  '…et il est défini APRÈS applyViewerSetup : au niveau module il ne l’aurait pas vu');
eq(countOf(/const applyThemeGlobal = /g), 1, 'une seule définition (aucune copie au niveau module)');

/* ══ 3. LA SIGNATURE D'UNE CLASSE (le conflit) ════════════════════════════ */
eq(H.classStyleSig({ p: { style: 'cartoon' } }), H.classStyleSig({ p: { style: 'cartoon' } }),
  'deux protéines dessinées pareil ont la MÊME signature : pas de conflit');
ok(H.classStyleSig({ p: { style: 'cartoon' } }) !== H.classStyleSig({ p: { style: 'licorice' } }),
  'deux styles différents → deux signatures : le conflit est détectable');

/* ══ 4. LA « REGOLA AUREA » : LE MERGE (mode 1) ═══════════════════════════ */
// Le fichier contenait un ARN ; la scène n'a qu'un phospholipide : l'ARN RESTE.
const prev = { nucleic: { general: { style: 'tube' } } };
const scene = { lipid: [{ id: 'l1', look: { general: { style: 'licorice' } } }] };
eq(H.mergeThemeClasses(prev, scene, null), {
  nucleic: { general: { style: 'tube' } },
  lipid: { general: { style: 'licorice' } },
}, 'la classe absente de la scène est CONSERVÉE (l’exemple ARN → phospholipide de la demande)');
eq(H.mergeThemeClasses(prev, {}, null).nucleic, { general: { style: 'tube' } },
  'une scène sans classe connue ne vide jamais le fichier');
// Deux protéines dessinées différemment : c'est l'utilisateur qui tranche…
const two = { protein: [
  { id: 'pA', look: { general: { style: 'cartoon' } } },
  { id: 'pB', look: { general: { style: 'licorice' } } },
] };
eq(H.mergeThemeClasses({}, two, { protein: 'pB' }).protein, { general: { style: 'licorice' } },
  'le choix de l’utilisateur devient le défaut de la classe');
// …et sans réponse (ou réponse périmée) le résultat est DÉTERMINISTE : le premier.
eq(H.mergeThemeClasses({}, two, null).protein, { general: { style: 'cartoon' } },
  'sans réponse, le PREMIER de la classe est écrit (déterministe)');
eq(H.mergeThemeClasses({}, two, { protein: 'inconnu' }).protein, { general: { style: 'cartoon' } },
  'un id de choix qui n’existe plus retombe sur le premier (jamais de trou)');
// Une classe devenue VIDE dans la scène ne l'écrase pas avec du vide.
eq(H.mergeThemeClasses({ protein: { general: { style: 'tube' } } }, { protein: [] }, null).protein,
  { general: { style: 'tube' } }, 'une liste de classe vide laisse le fichier tel quel');

/* ══ 5. LES DEUX MODES, DANS LA SOURCE ════════════════════════════════════ */
// Mode 1 : le prompt de conflit et l'application partielle.
has('if (conflicts.length && !choices) {', 'sauver un thème DEMANDE quand deux molécules d’une classe diffèrent');
has('const conflicts = kinds.filter((kind) => {', '…le conflit est calculé par classe');
has('{themeConflicts.length} class(es) drawn in two ways — choose the class default',
  '…et la barre le dit, avec un sélecteur par classe');
has('looks[sec.id] = initialSectionTree({ [sec.kind]: cls || null }, sec.kind);',
  'au CHARGEMENT, une classe inconnue du thème reçoit le style de base NEUTRE');
// Mode 2 : aucun merge, clé par section, repli par clé de section.
has('sections[sec.id] = { key: sec.key, kind: sec.kind, name: sec.name || sec.key, tree: treeOfSection(sec) };',
  'le snapshot est clé par SECTION (l’instance exacte, pas la classe)');
has('const entry = (sn.sections && sn.sections[sec.id]) || (byKey[sec.key] ? sn.sections[byKey[sec.key]] : null);',
  '…et se rejoue par ID, puis par CLÉ de section');
gone('mergeThemeClasses(nextClasses', 'le snapshot ne passe jamais par le merge du thème');
// Les commandes : un mode actif, un magasin, les mêmes boutons.
has("const activeEnvStore = () => (setupSaveMode === 'theme'", '💾 / 📂 / 🗑 / ⬇ / ⬆ servent le mode ACTIF');
has("{[['theme', '🎨 Theme (cumulative)'], ['snapshot', '📷 Snapshot (this scene)']].map(([m, label]) => (",
  'les deux modes sont deux boutons, dans le panneau « Predefined styles »');
has("{themeConflicts && (", 'le prompt de conflit n’apparaît que là où il y a un conflit');
has('const mergeThemeClasses = (prevClasses, looksByClass, choices) => {',
  'la « regola aurea » est une fonction PURE, donc exécutable par ce garde-fou');
has('const nextClasses = mergeThemeClasses(prev.classes, looksByClass, choices);',
  '…et l’enregistrement du thème passe bien par elle');
ok(VIEW.indexOf('const VIEWER_THEME_KEY') < VIEW.indexOf('const [setupSaveMode, setSetupSaveMode]'),
  'les deux magasins sont déclarés AVANT l’état qui les lit');

console.log(`_viewer_theme_snapshot_test.mjs — ${passed} assertions OK (thème cumulatif + snapshot)`);
