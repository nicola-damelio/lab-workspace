/* =========================================================================
   _viewer_headgroups_test.mjs — « headgroups » doit sélectionner les têtes.

   Le rapport, dont l'utilisateur a trouvé la cause lui-même : « era headgroups
   che invece di selezionare gli headgroups selezionava tutta la membrana e
   finché non nascondo headgroups la membrana resta ». Dans la macro :

       select phosphate,  name P* and resn POPC+POPE
       select headgroups, phosphate or POPC          ← TOUT le lipide

   `POPC` est un NOM DE RÉSIDU (ou la sélection du macro qui les couvre tous) :
   l'expression attrape CHAQUE atome des phospholipides, queues comprises. La
   ligne « headgroups » dessine donc la bicouche entière, et aucune autre ligne
   ne peut la reprendre : les lignes sont des CALQUES, les mêmes atomes sont
   dessinés plusieurs fois (même défaut que _viewer_selection_toggle_test.mjs).
   Le viewer CONNAÎT les têtes : `lipidGroupOf`, le classificateur du menu
   Lipids, celui dont membraneLeafletsOf mesure les feuillets — les deux menus
   ne peuvent pas se contredire. Donc quand un nom PROMET les têtes et que son
   expression les dépasse, la mesure gagne (comme `upper_leaflet` écrit `z>90`) ;
   quand l'expression EST déjà les têtes, elle est gardée telle quelle, et quand
   le nom ne parle pas des têtes (`membrane`, `water`), on n'y touche jamais.

   Le viewer est un .jsx : il ne s'importe pas sous Node. Ses helpers PURS sont
   donc EXTRAITS puis EXÉCUTÉS sur une structure SIMULÉE (comme dans
   _pymol_selection_bridge_test.mjs) ; le câblage est vérifié SUR LA SOURCE.
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
const slice = (from, to) => {
  const i = VIEW.indexOf(from);
  assert.ok(i >= 0, `ancre introuvable : ${from}`);
  const j = VIEW.indexOf(to, i + from.length);
  assert.ok(j > i, `fin introuvable : ${to}`);
  return VIEW.slice(i, j);
};

// Les deux morceaux exécutés : le pont + la mesure de membrane + les noms de
// têtes, et les helpers de comptage/ensembles d'atomes dont ils se servent.
const CODE_BRIDGE = slice('const PYMOL_PREDICATES = {', '\nconst normalizeStructureSource');
const CODE_STORE = slice('const nglSeleCount = ', '/* ---- ONE routing function');
// NGL est simulé : `Structure#getAtomSet` reçoit un `new NGL.Selection(str)` et
// rend un AtomSet, dont le code du viewer lit `.get(i)` et `.getSize()`.
const HARNESS = `
  const isLipidResname = (n) => /^(POPC|POPE|POPS|PSM|CHL1)$/.test(String(n || '').toUpperCase());
  const lipidGroupOf = (name) => (/^(P|O13|O14|N|HN1|O3|HO3)$/.test(String(name || '')) ? 'head' : 'acyl');
  const table = cfg.sets;
  const structure = {
    atomCount: cfg.atoms.length,
    eachAtom: (cb) => cfg.atoms.forEach((a) => cb(a)),
    getAtomSet: (sele) => {
      const s = String((sele && sele.string) || '');
      let idx = table.get(s);
      if (!idx && s.charAt(0) === '@') {
        idx = s.slice(1).split(',').map((v) => Number(v)).filter((v) => Number.isFinite(v));
      }
      const set = new Set(idx || []);
      return { get: (i) => set.has(i), getSize: () => set.size };
    },
  };
  return {
    structure, table,
    membraneOverridesFor, measuredHeadClause, membraneLeafletsOf, seleIsWithin, nglSeleCount,
    // EXACTEMENT le chemin de production du viewer (vocabulaire de la structure,
    // jokers développés, noms résolus) : le test mesure ce que l'écran reçoit.
    toNgl: (raw, named, overrides) => pymolSeleForStructure(structure, named, raw, () => {}, overrides),
  };
`;
const build = (atoms, sets) => {
  globalThis.window = { NGL: { Selection: class { constructor(s) { this.string = String(s); } } } };
  return new Function('cfg', `${CODE_STORE}\n${CODE_BRIDGE}${HARNESS}`)({ atoms, sets });
};

/* Une bicouche minuscule le long de z : deux résidus par feuillet, douze atomes
   par résidu (P et O13 = tête, C1…C10 = chaînes) — au moins 40 atomes de lipide,
   sinon membraneLeafletsOf y voit un ligand et non une bicouche. */
const bilayer = () => {
  const atoms = [];
  let i = 0;
  [[1, 0, -20], [2, 30, -20], [3, 60, 20], [4, 90, 20]].forEach(([resno, xy, z]) => {
    const names = ['P', 'O13', ...Array.from({ length: 10 }, (_, k) => `C${k + 1}`)];
    names.forEach((atomname, k) => {
      const head = k < 2;
      atoms.push({
        index: i++, residueIndex: resno - 1, resno, resname: 'POPC', atomname, element: atomname[0],
        x: xy, y: xy, z: head ? z : z - Math.sign(z) * 4,
      });
    });
  });
  return atoms;
};
const ATOMS = bilayer();
const LIPIDS = ATOMS.map((a) => a.index);
// P et O13 de chaque résidu : 0,1 · 12,13 (feuillet bas), 24,25 · 36,37 (haut).
const HEAD_LIST = [0, 1, 12, 13, 24, 25, 36, 37];
const HEADS = `@${HEAD_LIST.join(',')}`;

const h = build(ATOMS, new Map());

/* ── 1. La mesure : les têtes des deux feuillets ─────────────────────────── */
const m = h.membraneLeafletsOf(h.structure);
ok(!!m, 'la bicouche simulée est mesurée (membraneLeafletsOf)');
eq(m.lower.headIndices, [0, 1, 12, 13], 'feuillet inférieur : les atomes de tête (P, O13) de ses deux résidus');
eq(m.upper.headIndices, [24, 25, 36, 37], '…feuillet supérieur : idem, les queues (C1…C10) restent dehors');
eq(h.measuredHeadClause(m), HEADS, 'la clause des têtes = union TRIÉE des deux feuillets, au format `@i,j,k` que NGL lit');
eq(h.measuredHeadClause(null), null, 'sans mesure : aucune clause de têtes');

/* ── 2. La macro : « headgroups » = tout le lipide ───────────────────────── */
// Ce que le pont produit RÉELLEMENT pour l'expression du macro (la sélection
// `popc` du macro est inlinée par le pont, comme PyMOL inline ses sélections).
const named = new Map([
  ['popc', 'resn POPC'],
  ['phosphate', 'name P* and popc'],
  ['headgroups', 'phosphate or popc'],
]);
const scripted = h.toNgl('phosphate or popc', named);
ok(/POPC/.test(scripted), 'le pont résout l’expression du macro : « POPC » y est un nom de résidu');
h.table.set(scripted, LIPIDS);   // NGL : cette expression = TOUS les atomes des lipides
const out = h.membraneOverridesFor(h.structure, named, m, {});
eq(out.map.headgroups, HEADS, 'la ligne « headgroups » reçoit les TÊTES mesurées, plus tout le lipide');
eq(out.fixed.size, 1, 'exactement un nom est corrigé…');
ok(out.fixed.has('headgroups'), '…et c’est « headgroups »');
ok(out.fixed.get('headgroups').includes('whole lipid'), 'le ⚠ nomme le défaut : la macro couvrait tout le lipide');
ok(out.fixed.get('headgroups').includes(String(LIPIDS.length)), 'le ⚠ donne le compte que la macro couvrait (tous les atomes des lipides)');
ok(out.fixed.get('headgroups').includes('8 atoms'), '…et le compte des têtes mesurées (8 atomes)');
ok(out.fixed.get('headgroups').includes('phosphate or popc'), 'le ⚠ cite l’expression du macro, pour qu’il se reconnaisse');
ok(!out.fixed.has('phosphate'), '« phosphate » (P*) n’est pas signalé : ses atomes SONT des têtes');
eq(out.map.phosphate, undefined, '…et il garde donc sa propre définition');

/* ── 3. Une macro déjà juste garde SON expression ────────────────────────── */
const namedOk = new Map([['headgroups', 'name P* or name O13']]);
h.table.set(h.toNgl('name P* or name O13', namedOk), HEAD_LIST);
const outOk = h.membraneOverridesFor(h.structure, namedOk, m, {});
eq(outOk.map.headgroups, undefined, 'une expression qui EST déjà les têtes n’est jamais remplacée');
eq(outOk.fixed.size, 0, '…et rien n’est signalé à l’utilisateur');

/* ── 4. Un nom qui ne parle PAS des têtes n’est jamais touché ────────────── */
const namedMem = new Map([['membrane', 'resn POPC'], ['water', 'resn TIP3']]);
h.table.set(h.toNgl('resn POPC', namedMem), LIPIDS);
const outMem = h.membraneOverridesFor(h.structure, namedMem, m, {});
eq(outMem.map.membrane, undefined, '« membrane » peut légitimement être tout le lipide : on n’y touche pas');
eq([...outMem.fixed.keys()], [], '…et le ⚠ n’en parle pas');

/* ── 5. Sans bicouche mesurable, le script reste seul maître ─────────────── */
const outNone = h.membraneOverridesFor(h.structure, named, null, {});
eq(outNone.map.headgroups, undefined, 'pas de bicouche mesurable → aucune correction, le script décide');
eq(outNone.fixed.size, 0, '…et aucun avertissement inventé');

/* ── 6. Les noms mesurés passent EN PREMIER ─────────────────────────────── */
const base = { upper_leaflet: '@0,1,2', upper_headgroups: '@0,1' };
const outBase = h.membraneOverridesFor(h.structure, named, m, base);
eq(outBase.map.upper_headgroups, '@0,1', 'un feuillet mesuré n’est jamais écrasé par la correction');
eq(outBase.map.upper_leaflet, '@0,1,2', '…ni la clause de feuillet');
eq(outBase.map.headgroups, HEADS, '…et la correction s’ajoute à côté des quatre noms réservés');

/* ── 7. LA MÊME réponse partout : le `hide` du macro suit la ligne ──────── */
const hideNgl = h.toNgl('name H* and headgroups', named, outBase.map);
ok(hideNgl.includes(HEADS), '« hide sticks, name H* and headgroups » soustrait les MÊMES atomes que la ligne');
ok(!hideNgl.includes('POPC'), '…jamais l’expression du macro : une seule carte, une seule réponse');

/* ── 8. Les deux primitives, exécutées ──────────────────────────────────── */
eq(h.seleIsWithin(h.structure, '@0,1', '@0,1,2,3'), true, 'seleIsWithin : un sous-ensemble est reconnu');
eq(h.seleIsWithin(h.structure, '@0,5', '@0,1,2,3'), false, '…un atome dehors ne l’est pas');
eq(h.seleIsWithin(h.structure, '@0,1', '@0,1'), true, '…un ensemble égal l’est aussi (aucun faux positif)');
h.table.set('resn POPC', LIPIDS);
eq(h.nglSeleCount(h.structure, 'resn POPC'), LIPIDS.length, 'nglSeleCount compte les atomes d’une expression résolue par NGL');
eq(h.nglSeleCount(h.structure, '@0,1,2'), 3, '…et ceux d’une clause `@`');
delete globalThis.window.NGL;
eq(h.nglSeleCount(h.structure, 'resn POPC'), -1, 'sans NGL le compte est INCONNU (-1) : jamais un zéro trompeur');
eq(h.seleIsWithin(h.structure, '@0,1', '@0,1,2'), null, 'sans NGL, « je ne sais pas » — et le script est gardé');
globalThis.window = { NGL: { Selection: class { constructor(s) { this.string = String(s); } } } };

/* ── 9. Le câblage dans le viewer ───────────────────────────────────────── */
has('const membraneMeasRef = useRef(null);', 'la mesure (les INDEX des têtes) est gardée hors de l’état React');
has('membraneMeasRef.current = m;', '…remplie par la mesure du chargement');
has('const reservedOverrides = () => {', 'le viewer mémoïse la carte nom → clause que le pont résout');
has('membraneOverridesFor(structure, namedSeleMap(), membraneMeasRef.current, membraneSeleRef.current)',
  'la carte vient de la mesure ET des sélections du macro (la correction suit le script)');
has("}::${measuredHeadClause(membraneMeasRef.current) || ''}`",
  'la mémoïsation est invalidée dès que les têtes mesurées changent');
has('pymolSeleForStructure(structure, namedSeleMap(), text, (m) => warns.push(m), reservedOverrides().map)',
  'CHAQUE expansion (ligne, style, hideFor) passe cette carte : une seule réponse, donc jamais d’atomes divergents');
has('const geo = reserved.map[key] || reserved.map[String(key).toLowerCase()];',
  'la ligne résout son nom dans la MÊME carte (insensible à la casse, comme le pont)');
has('const fix = reserved.fixed.get(String(key).toLowerCase());', '…et récupère le ⚠ de son nom corrigé');
has('usedTranslateWarnRef.current.set(text, [...list, fix]);',
  'le ⚠ voyage avec la ligne : même clé que les avertissements du pont');
has('const n = nglSeleCount(structure, selKeyExpr(key));', 'le compte d’atomes d’une ligne passe par le helper NGL du fichier');
gone('component.structure.getSelection(',
  'l’API qui ne résolvait RIEN ne revient pas (`Structure#getSelection` ne prend aucun argument)');
has("const MEMBRANE_HEAD_NAMES = ['headgroups', 'headgroup', 'heads'];",
  'seuls les noms qui PROMETTENT les têtes sont corrigés — jamais « membrane »');
has('if (seleIsWithin(structure, scripted, clause) !== false) return;',
  'la correction n’a lieu que si l’expression du macro SORT des têtes mesurées');
has("A {'`'}select headgroups, phosphate or POPC{'`'} — which PyMOL reads as EVERY atom of those lipids — gets the measured heads instead.",
  'la barre Membrane dit la règle à l’utilisateur');

console.log(`_viewer_headgroups_test.mjs : ${passed} assertions OK`);
