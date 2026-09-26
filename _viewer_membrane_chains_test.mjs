/* =========================================================================
   _viewer_membrane_chains_test.mjs — LES CHAÎNES ACYLE D'UN FEUILLET NE
   DISPARAISSENT PAS QUAND SA RANGÉE DE TÊTES CHANGE DE STYLE.

   LE RAPPORT, mot pour mot :

     « I deselect the lipid (eg POPC). I select ball and stick for upper leaflet
       and lower leaflet. I make slightly transparent upper leaflet. Then I
       select CPK for upper headgroup and the result is that the headgroup
       becomes CPK but the acyl chains of the upper leaflet disappear. »

   CE QUI SE PASSAIT : la règle du propriétaire des têtes
   (membraneHeadOwnerExprs) soustrait à un feuillet les atomes de sa rangée de
   têtes. Elle lisait ces atomes par la MÊME résolution que la rangée elle-même —
   et cette résolution retombait sur la définition du SCRIPT dès que la mesure du
   viewer manquait dans la carte mémoïsée (carte construite SANS les quatre
   clauses quand le premier appel tombe dans le commit de la mesure) ou n'existait
   pas du tout (une bicouche que membraneLeafletsOf n'a pas su mesurer). Or une
   macro de membrane définit souvent `upper_headgroups` par une simple tranche —
   « resn POPC and z>90 » — qui couvre TOUT le feuillet : le feuillet se dessinait
   alors `(feuillet) and not (feuillet)`, L'ENSEMBLE VIDE. Ses chaînes acyle
   disparaissaient, pendant que la rangée de têtes passait bien en CPK.

   CE QUI EST VÉRIFIÉ ICI :

     1. les quatre noms MESURÉS se résolvent par la GÉOMÉTRIE, dans les deux
        endroits qui décident de ce qu'une rangée dessine — `selKeyExpr` (la
        rangée) et `expandSelectionExpr` (les `hideFor` écrits par les gestes) ;
     2. la mémoire des noms réservés porte les quatre clauses dans sa signature :
        une carte sans elles ne peut plus être figée pour toute la session ;
     3. sans mesure publiée, le viewer n'impose AUCUNE hiérarchie : styliser la
        rangée de têtes n'écrit rien dans le `hideFor` du feuillet, et la règle de
        rendu ne soustrait rien ;
     4. la scène, rejouée sur une bicouche POPC synthétique avec le VRAI code
        (mesure · pont PyMOL · gestes des deux barres · exclusionOf), garde les
        chaînes acyle du feuillet du haut dans les DEUX configurations ;
     5. la version d'AVANT le correctif, reconstruite EN MÉMOIRE, vide bien le
        feuillet : la sonde ci-dessous sait donc voir le défaut (mutation) ;
     6. LE MÊME RAPPORT QUAND LA MACRO A DESSINÉ LES TÊTES (`show ball+stick,
        upper_headgroups`) : choisir CPK ÉTEINT ce ball+stick, et c'est ce geste
        qui écrivait l'EXPRESSION de la rangée de têtes dans le `hideFor` du
        feuillet. La règle d'exclusion reconnaît maintenant cette écriture comme
        le NOM qu'elle recopie (membraneNameOfEntry), le geste ne laisse que le
        nom (toggleSelStyle), et le feuillet garde ses chaînes acyle — mesuré
        comme non mesuré ;
     7. la mutation de CETTE réparation (expression écrite, règle des noms seuls)
        vide bien le feuillet à son tour : la sonde sait voir ce défaut-là aussi.
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
const gone = (needle, what) => ok(!VIEW.includes(needle), `${what}\n  encore là   : ${needle}`);
const slice = (from, to) => {
  const i = VIEW.indexOf(from);
  assert.ok(i >= 0, `ancre introuvable : ${from}`);
  const j = VIEW.indexOf(to, i + from.length);
  assert.ok(j > i, `fin introuvable : ${to}`);
  return VIEW.slice(i, j);
};

/* ── 1. LA MESURE GAGNE, AUX DEUX ENDROITS QUI DESSINENT ─────────────────── */
has('const measured = membraneSeleRef.current[key] || membraneSeleRef.current[String(key).toLowerCase()];',
  'selKeyExpr lit la clause MESURÉE du nom, même quand la carte mémoïsée ne l’a pas');
has('const ngl = geo || measured || expandSelectionExpr(text);',
  '…et elle passe avant la définition du script (geo → measured → pont)');
has('const measured = membraneSeleRef.current[text] || membraneSeleRef.current[text.toLowerCase()];',
  'expandSelectionExpr résout aussi les quatre noms par la mesure');
has('if (measured) return measured;',
  '…et le fait AVANT le pont, donc avant toute définition de script');
has('the headgroup becomes CPK but the acyl', 'le rapport est cité là où la règle est réparée (selKeyExpr)');

/* ── 2. LA MÉMOIRE DES NOMS RÉSERVÉS PORTE LES QUATRE CLAUSES ────────────── */
has('const baseSig = Object.keys(base)', 'la signature de la mémoire part des clauses publiées');
has('return `${k}=${clause.length}:${clause.slice(0, 10)}:${clause.slice(-6)}`;',
  '…lues par leur taille et leurs deux bouts (une signature qui reste courte)');
has('::${baseSig}`;', '…et elle est dans la signature : une carte sans elles n’est plus figée');

/* ── 3. SANS MESURE, AUCUNE HIÉRARCHIE ───────────────────────────────────── */
has('const measured = membraneSeleRef.current[key];\n    const chained = measured ? membraneHeadRelinquish(key, value !== \'hide\', work) : work;',
  'le geste de style n’écrit le livre de comptes des têtes que si le viewer A mesuré la bicouche');
has('const measuredOwner = MEMBRANE_CHILD_OF[key] ? membraneSeleRef.current[MEMBRANE_CHILD_OF[key]] : null;',
  'la règle de rendu lit la clause MESURÉE des têtes, jamais celle du script');
has('const membraneOwners = measuredOwner ? membraneHeadOwnerExprs(key, styles, () => measuredOwner) : \'\';',
  '…et ne soustrait rien du tout quand il n’y a pas de mesure');
gone('membraneHeadOwnerExprs(key, styles, selKeyExpr)',
  'l’ancienne lecture (par le script) a disparu du rendu');


/* ── 4. LA SCÈNE, REJOUÉE AVEC LE VRAI CODE ──────────────────────────────────
   On exécute les fonctions RÉELLES du viewer (mesure des feuillets · pont PyMOL
   · gestes des deux barres · exclusionOf, extrait tel quel) sur une bicouche
   POPC synthétique aux noms CHARMM36, et l'on compte les atomes que chaque
   rangée dessine vraiment. NGL ne s'importe pas dans Node (bundle ESM qui
   importe le paquet CJS `signals`), donc la syntaxe qu'il lit est évaluée ici
   dans ses formes exactes (`@i,j,k`, `none`, `all`, `(…) and not (… or …)`, un
   nom de résidu nu, `[A,B]`, `.NAME`, `:A`, `_C`, `1-10`) ; toute forme inconnue
   LÈVE : la sonde ne peut pas mentir en silence. */
const PRE_FIX = {
  selKeyExpr: `const selKeyExpr = (key) => {
  const reserved = reservedOverrides();
  const named = selections.find((s) => s.name === key);
  const text = named ? named.expr : key;
  const geo = reserved.map[key] || reserved.map[String(key).toLowerCase()];
  return geo || expandSelectionExpr(text);
};`,
};

const GEST_OLD = slice('const toggleSelStyle = (key, style, from) => {', 'const membraneSoloOn = (key) => {')
  .replace("const measured = membraneSeleRef.current[key];\n    const chained = measured ? membraneHeadRelinquish(key, value !== 'hide', work) : work;",
    "const chained = membraneHeadRelinquish(key, value !== 'hide', work);");

const CODE = (preFix, oldWrite) => {
  const src = [
    slice('const LIPID_RESNAMES = new Set([', '/* ---- PART 2.1bis'),
    slice('const LIPID_GLYCEROL_NAMES = new Set(', 'const lipidSubCache = new WeakMap();'),
    slice('const nglSeleCount = ', '/* ---- ONE routing function'),
    slice('const PYMOL_PREDICATES = {', '\nconst normalizeStructureSource'),
    preFix ? PRE_FIX.selKeyExpr : slice('const selKeyExpr = (key) => {', '// Number of atoms matching a selection key'),
    preFix ? GEST_OLD : slice('const toggleSelStyle = (key, style, from) => {', 'const membraneSoloOn = (key) => {'),
    slice('const hiddenRowExprs = (styles, selfKey, exprOf) => {', 'const requestSceneRepaint = () => {'),
  ].join('\n');
  if (!oldWrite) return src;
  /* MUTATION DE LA DEUXIÈME RÉPARATION : le geste qui écrit l'EXPRESSION de la
     rangée cliquée (le code d'avant) et la règle d'exclusion qui ne reconnaît que
     les NOMS (l'ancienne : ni membraneNameOfEntry, ni les deux comparaisons de
     clause). La sonde DOIT alors voir le feuillet se vider de ses chaînes acyle. */
  return src
    .replace('const token = MEMBRANE_SIDE_OF[key] ? key : raw;', 'const token = raw;')
    .replace('const named = membraneNameOfEntry(e, ctx.scriptDefs);', "const named = '';")
    .replace('  const text = membraneClauseText(e);\n', '')
    .replace('  if (own && text === own) return false;\n  if (parent && text === parent) return false;\n', '');
};

const EXCL_SRC = slice('const exclusionOf = (style) => {', 'const addSele = (type, params, seleBase, style) => {')
  .replace(/^const exclusionOf = /, '')
  .replace(/;\s*$/, '')
  .trim();

const TOKEN_RE = /\[[^\]]*\]|@[0-9,\s]*|[()]|\.[A-Za-z0-9']+|:[A-Za-z0-9]+|_[A-Za-z]+|[A-Za-z][A-Za-z0-9']*|\d+-\d+|\d+/g;

/* ── L'ATELIER : NGL simulé, et l'état React que ce code a autour de lui ──── */
const HARNESS = `
  const atoms = cfg.atoms;
  const all = new Set(atoms.map((a) => a.index));
  const leaf = (tok) => {
    const t = String(tok);
    if (t === 'none') return new Set();
    if (t === 'all' || t === '*') return new Set(all);
    if (t.charAt(0) === '@') return new Set(t.slice(1).split(',').map(Number).filter(Number.isFinite));
    if (t.charAt(0) === '[') {
      const names = t.slice(1, -1).split(',').map((v) => v.trim().toUpperCase());
      return new Set(atoms.filter((a) => names.includes(String(a.resname).toUpperCase())).map((a) => a.index));
    }
    if (t.charAt(0) === '.') {
      const n = t.slice(1).toUpperCase();
      return new Set(atoms.filter((a) => String(a.atomname).toUpperCase() === n).map((a) => a.index));
    }
    if (t.charAt(0) === ':') {
      const c = t.slice(1).toUpperCase();
      return new Set(atoms.filter((a) => String(a.chain || 'A').toUpperCase() === c).map((a) => a.index));
    }
    if (t.charAt(0) === '_') {
      const e = t.slice(1).toUpperCase();
      return new Set(atoms.filter((a) => String(a.element).toUpperCase() === e).map((a) => a.index));
    }
    if (/^[0-9]+(-[0-9]+)?$/.test(t)) {
      const m = /^([0-9]+)-([0-9]+)$/.exec(t);
      return new Set(atoms.filter((a) => (m ? a.resno >= Number(m[1]) && a.resno <= Number(m[2]) : a.resno === Number(t))).map((a) => a.index));
    }
    const n = t.toUpperCase();
    return new Set(atoms.filter((a) => String(a.resname).toUpperCase() === n).map((a) => a.index));
  };
  const nglSet = (text, where) => {
    const toks = String(text).match(cfg.TOKEN_RE) || [];
    let i = 0;
    const peek = () => toks[i];
    const unary = () => {
      if (peek() === 'not') { i += 1; return { op: 'not', a: unary() }; }
      const t = peek();
      if (t === '(') { i += 1; const e = expr(); if (peek() !== ')') throw new Error('parenthese non fermee'); i += 1; return e; }
      if (t === undefined) throw new Error('fin inattendue');
      i += 1;
      return { op: 'leaf', set: leaf(t) };
    };
    function expr() {
      let a = unary();
      while (peek() === 'and' || peek() === 'or') {
        const op = toks[i]; i += 1; a = { op, a, b: unary() };
      }
      return a;
    }
    const val = (node) => {
      if (node.op === 'leaf') return node.set;
      if (node.op === 'not') { const s = val(node.a); return new Set([...all].filter((k) => !s.has(k))); }
      if (node.op === 'and') { const b = val(node.b); return new Set([...val(node.a)].filter((k) => b.has(k))); }
      if (node.op === 'or') return new Set([...val(node.a), ...val(node.b)]);
      throw new Error('noeud inconnu');
    };
    const tree = expr();
    if (i !== toks.length) throw new Error('tokens non lus dans ' + where + ' : ' + String(text).slice(0, 200));
    return val(tree);
  };
  const structure = {
    atomCount: atoms.length,
    eachAtom: (cb) => atoms.forEach((a) => cb(a)),
    getAtomSet: (sele) => {
      const s = nglSet(String((sele && sele.string) || ''), 'getAtomSet');
      return { get: (k) => s.has(k), getSize: () => s.size };
    },
  };
`;

const STUBS = (preFix) => `
  globalThis.window = globalThis.window || {};
  window.NGL = { Selection: class { constructor(s) { this.string = String(s); } } };
  const selections = cfg.selections || [];
  const namedSeleMap = () => {
    const m = new Map();
    selections.forEach((s) => { if (s && s.name) m.set(String(s.name).toLowerCase(), s.expr); });
    return m;
  };
  const usedTranslateWarnRef = { current: new Map() };
  let selStyles = cfg.selStyles || {};
  const selStylesRef = { current: selStyles };
  const setSelStyles = (next) => { selStyles = next; selStylesRef.current = next; };
  // L'ÉTAT publié (les quatre clauses) et la MESURE (le ref) : ce sont deux choses
  // différentes, et c'est justement là que le défaut se nichait.
  const membraneSeleRef = { current: cfg.published === null ? {} : (cfg.published || cfg.membraneSele || {}) };
  const membraneMeasRef = { current: cfg.measured || null };
  const reservedMapRef = { current: null };
  let COLD = false;
  const reservedOverrides = () => {
    const base = COLD ? {} : (membraneSeleRef.current || {});
    const baseSig = Object.keys(base).map((k) => k + '=' + String(base[k] || '').length).join('|');
    const sig = selections.map((s) => s.name + '=' + s.expr).join('|') + '::' + (measuredHeadClause(membraneMeasRef.current) || '') + '::' + baseSig;
    const cached = reservedMapRef.current;
    if (cached && cached.struct === structure && cached.sig === sig) return cached.out;
    const out = membraneOverridesFor(structure, namedSeleMap(), membraneMeasRef.current, base);
    reservedMapRef.current = { struct: structure, sig, out };
    return out;
  };
  const expandSelectionExpr = (raw) => {
    const text = String(raw || '');
    if (!text) return 'all';
    ${preFix ? '' : "const measured = membraneSeleRef.current[text] || membraneSeleRef.current[text.toLowerCase()];\n    if (measured) return measured;"}
    return pymolSeleForStructure(structure, namedSeleMap(), text, () => {}, reservedOverrides().map);
  };
`;


/* L'ÉPILOGUE : la décision de rendu d'UNE rangée, telle que le viewer la prend
   (`exclusionOf` est le VRAI code, extrait tel quel ; `addSele` en est le miroir :
   `sele = (exclusion) ? (expr) and not (exclusion) : expr`). */
const EPILOGUE = (preFix) => `
  const atomsOf = (sele) => nglSet(sele, 'atomsOf');
  const rowReps = (key) => {
    const st = selStyles[key] || {};
    if (st.hidden) return [];
    const expr = selKeyExpr(key);
    if (!expr || expr === '') return [];
    const hiddenElsewhere = hiddenRowExprs(selStyles, key, selKeyExpr);
    ${preFix
      ? 'const membraneOwners = membraneHeadOwnerExprs(key, selStyles, selKeyExpr);'
      : "const measuredOwner = MEMBRANE_CHILD_OF[key] ? membraneSeleRef.current[MEMBRANE_CHILD_OF[key]] : null;\n    const membraneOwners = measuredOwner ? membraneHeadOwnerExprs(key, selStyles, () => measuredOwner) : '';"}
    // Le contexte de la règle d'exclusion, EXACTEMENT comme le rendu le pose.
    const membraneCtx = {
      own: expr,
      parent: MEMBRANE_PARENT_OF[key]
        ? (membraneSeleRef.current[MEMBRANE_PARENT_OF[key]] || expandSelectionExpr(MEMBRANE_PARENT_OF[key]))
        : '',
      measured: membraneSeleRef.current,
      scriptDefs: membraneScriptDefs(selections),
    };
    const makeExclusion = new Function('key', 'st', 'membraneOwners', 'hiddenElsewhere', 'membraneExclusionKept', 'expandSelectionExpr', 'membraneCtx', 'membraneNameOfEntry',
      'return (' + cfg.EXCL_SRC + ');');
    const exclusionOf = makeExclusion(key, st, membraneOwners, hiddenElsewhere, membraneExclusionKept, expandSelectionExpr, membraneCtx, membraneNameOfEntry);
    const out = [];
    const add = (type, style) => {
      const ex = exclusionOf(style);
      const sele = ex ? '(' + expr + ') and not (' + ex + ')' : expr;
      out.push({ type, style, atoms: atomsOf(sele).size, selected: atomsOf(sele) });
    };
    if (st.ball) add('ball+stick', 'ball');
    if (st.stick) add('licorice', 'stick');
    if (st.sphere) add('spacefill', 'sphere');
    if (st.line) add('line', 'line');
    return out;
  };
  const sel = () => selStylesRef.current;
  const kept = (k, e, ctx) => membraneExclusionKept(k, e, ctx || {});
  const styleOf = (key, token) => { setSelField(key, 'style', token); return selStylesRef.current; };
  const look = (key, field, value) => { setSelField(key, field, value); return selStylesRef.current; };
  const measured = () => membraneLeafletsOf(structure);
  const clauses = (m) => ({
    upper_leaflet: m.upper.clause, lower_leaflet: m.lower.clause,
    upper_headgroups: m.upper.headIndices.length ? '@' + m.upper.headIndices.join(',') : 'none',
    lower_headgroups: m.lower.headIndices.length ? '@' + m.lower.headIndices.join(',') : 'none',
  });
  const freeze = (v) => { COLD = !!v; };
  return { structure, atomsOf, rowReps, sel, kept, styleOf, measured, clauses, freeze, look };
`;

const build = (atoms, selections, measured, opts = {}) => new Function('cfg',
  `${STUBS(opts.preFix)}\n${CODE(opts.preFix, opts.oldWrite)}\n${HARNESS}\n${EPILOGUE(opts.preFix)}`)({
  atoms, selections, measured, TOKEN_RE, EXCL_SRC, ...opts,
});

/* ── Une bicouche POPC RÉALISTE (noms CHARMM36), le long de z : les têtes à
   |z| ≥ 20, les chaînes vers le milieu, 8 lipides par feuillet. ── */
const HEAD_NAMES = ['P', 'O13', 'O14', 'O12', 'N', 'C12', 'C13', 'C14', 'C15'];
const GLYC_NAMES = ['C1', 'C2', 'C3', 'O21', 'O31', 'HA', 'HB', 'HS', 'HX', 'HY'];
const SN1 = ['O22', ...Array.from({ length: 16 }, (_, k) => `C2${k + 1}`)];
const SN2 = ['O32', ...Array.from({ length: 18 }, (_, k) => `C3${k + 1}`)];
const chainH = (prefix) => {
  const out = [];
  for (let k = 1; k <= 16; k += 1) out.push(`${prefix}${k}R`, `${prefix}${k}S`);
  return out;
};
const bilayer = (perLeaflet = 8) => {
  const atoms = [];
  let index = 0;
  let resno = 1;
  const push = (atomname, x, y, z, element) => {
    atoms.push({ index, residueIndex: resno - 1, resno, resname: 'POPC', atomname, element, x, y, z });
    index += 1;
  };
  const lipid = (x, y, side) => {
    const s = side;
    HEAD_NAMES.forEach((n, k) => push(n, x, y, s * (20 + (k % 3)), n.charAt(0)));
    GLYC_NAMES.forEach((n, k) => push(n, x + 0.1 * k, y, s * (17 - 0.2 * k), n.charAt(0)));
    SN1.forEach((n, k) => push(n, x + 0.1 * k, y + 0.1 * k, s * (15 - 0.7 * k), n.charAt(0)));
    chainH('H2').forEach((n, k) => push(n, x + 0.1 * k, y - 0.1 * k, s * (14.6 - 0.7 * k), 'H'));
    SN2.forEach((n, k) => push(n, x - 0.1 * k, y, s * (15 - 0.6 * k), n.charAt(0)));
    chainH('H3').forEach((n, k) => push(n, x - 0.1 * k, y + 0.1 * k, s * (14.6 - 0.6 * k), 'H'));
    resno += 1;
  };
  for (let i = 0; i < perLeaflet; i += 1) lipid(10 * (i % 3), 10 * Math.floor(i / 3), 1);
  for (let i = 0; i < perLeaflet; i += 1) lipid(10 * (i % 3), 10 * Math.floor(i / 3), -1);
  return atoms;
};


/* ── 4. LA SCÈNE DU RAPPORT, REJOUÉE ────────────────────────────────────────
   La macro définit les quatre noms par des TRANCHES, comme une macro de membrane
   le fait couramment — dont un `upper_headgroups` qui couvre TOUT le feuillet du
   haut (« resn POPC and z>0 »). Le geste du rapport : Hide sur POPC, ball+stick
   sur les deux feuillets, feuillet du haut transparent, puis CPK sur
   upper_headgroups. */
const ATOMS = bilayer(8);
const TRANCHE_MACRO = [
  { name: 'POPC', expr: 'resn POPC' },
  { name: 'upper_leaflet', expr: 'resn POPC and z>0' },
  { name: 'lower_leaflet', expr: 'resn POPC and z<0' },
  { name: 'upper_headgroups', expr: 'resn POPC and z>0' },
  { name: 'lower_headgroups', expr: 'resn POPC and z<0' },
];

/* `headsInBall` : la MACRO a laissé les deux rangées de têtes en ball+stick
   (`show ball+stick, upper_headgroups`) — l'ingrédient sans lequel le défaut ne
   se produit pas, car `setSelRowStyle` n'éteint un ancien style (et n'écrit donc
   dans les autres rangées) que si la rangée cliquée le dessinait. */
const scene = (opts) => {
  const probe = build(ATOMS, TRANCHE_MACRO, null, opts);
  const m = probe.measured();
  ok(!!m, 'la bicouche synthétique est mesurée (membraneLeafletsOf)');
  const clauses = probe.clauses(m);
  const heads = opts.headsInBall ? { ball: true, stick: true } : {};
  const h = build(ATOMS, TRANCHE_MACRO, m, {
    ...opts,
    membraneSele: opts.noMeasurement ? null : clauses,
    selStyles: { POPC: { sphere: true }, upper_headgroups: { ...heads }, lower_headgroups: { ...heads } },
  });
  if (opts.freezeMap) h.freeze(true);   // la carte des noms réservés est figée SANS les clauses
  return { h, m, clauses };
};

const gesture = (h) => {
  h.styleOf('POPC', 'hide');                     // « I deselect the lipid (eg POPC) »
  h.styleOf('upper_leaflet', 'ball+stick');      // « ball and stick for upper leaflet »
  h.styleOf('lower_leaflet', 'ball+stick');      // « and lower leaflet »
  h.look('upper_leaflet', 'opacity', 0.25);      // « I make slightly transparent upper leaflet »
  const before = h.rowReps('upper_leaflet');
  h.styleOf('upper_headgroups', 'spacefill');    // « Then I select CPK for upper headgroup »
  return { before, after: h.rowReps('upper_leaflet'), heads: h.rowReps('upper_headgroups') };
};

/* (a) LA MESURE EST PUBLIÉE mais la carte des noms est GELÉE SANS ELLE — le
   commit même de la mesure, quand `selStyles` a déjà des rangées. */
{
  const { h, clauses } = scene({ freezeMap: true });
  const upperHeads = h.atomsOf(clauses.upper_headgroups);
  const upperAll = h.atomsOf(clauses.upper_leaflet);
  ok(upperAll.size > upperHeads.size, 'la mesure a bien des feuillets ET des têtes (bicouche synthétique)');
  const { before, after, heads } = gesture(h);
  ok(before[0] && before[0].atoms === upperAll.size,
    'le feuillet dessine d’abord TOUTE la mesure du feuillet (les têtes sont encore à lui)');
  ok(after.length > 0 && after[0].atoms === upperAll.size - upperHeads.size,
    `LE RAPPORT : le feuillet garde ses chaînes acyle quand les têtes passent en CPK\n  attendu ${upperAll.size - upperHeads.size} atomes (feuillet − têtes mesurées), obtenu ${after.length ? after[0].atoms : 0}`);
  ok(heads.length > 0 && heads[0].atoms === upperHeads.size,
    `…et la rangée de têtes en CPK dessine EXACTEMENT les têtes MESURÉES (${upperHeads.size}), pas la tranche du script`);
  eq((h.sel().upper_leaflet || {}).hideFor, { ball: ['upper_headgroups'] },
    'le livre de comptes reste celui du geste (le feuillet cède ses têtes), mais il se résout par la mesure');
}

/* (b) AUCUNE MESURE PUBLIÉE : les quatre noms ne sont que les sélections du
   script ; le viewer ne leur impose alors AUCUNE hiérarchie. */
{
  const { h } = scene({ noMeasurement: true, freezeMap: true });
  const { before, after } = gesture(h);
  ok(before[0] && before[0].atoms > 0, 'sans mesure, le feuillet dessine ce que le script a sélectionné');
  ok(after[0] && after[0].atoms === before[0].atoms,
    `sans mesure, le CPK des têtes ne retire RIEN au feuillet\n  attendu ${before[0].atoms} atomes, obtenu ${after[0] ? after[0].atoms : 0}`);
  eq((h.sel().upper_leaflet || {}).hideFor || null, null,
    '…et le geste n’écrit aucun livre de comptes de hiérarchie que personne ne peut honorer');
}

/* ── 4 bis. LE MÊME RAPPORT, AVEC LES TÊTES QUE LA MACRO A DESSINÉES ────────
   L'INGRÉDIENT que la sonde d'avant ne mettait pas : la macro laisse les deux
   rangées de têtes en ball+stick (`show ball+stick, upper_headgroups`). Le CPK
   choisi sur `upper_headgroups` ÉTEINT donc d'abord son ball+stick — et
   `toggleSelStyle` inscrivait alors l'EXPRESSION de la rangée de têtes
   (« resn POPC and z>0 », TOUT le feuillet) dans le `hideFor.ball` du feuillet :
   il se dessinait `(feuillet) and not (feuillet)`, L'ENSEMBLE VIDE. La première
   réparation ne couvrait que les entrées écrites en NOM (le menu déroulant) ;
   celle-ci couvre l'écriture par EXPRESSION (les ticks, l'ancien code). */
{
  const { h, clauses } = scene({ freezeMap: true, headsInBall: true });
  const upperHeads = h.atomsOf(clauses.upper_headgroups);
  const upperAll = h.atomsOf(clauses.upper_leaflet);
  const { before, after, heads } = gesture(h);
  ok(before[0] && before[0].atoms === upperAll.size - upperHeads.size,
    'prémisse : le feuillet dessine ses chaînes (ses têtes sont déjà à leur propre rangée)');
  ok(after.length > 0 && after[0].atoms === upperAll.size - upperHeads.size,
    `LE RAPPORT, têtes en ball+stick : le feuillet GARDE ses chaînes acyle quand elles passent en CPK\n  attendu ${upperAll.size - upperHeads.size} atomes, obtenu ${after.length ? after[0].atoms : 0}`);
  ok(heads.length > 0 && heads[0].atoms === upperHeads.size,
    '…et les têtes en CPK dessinent EXACTEMENT les têtes mesurées');
  eq((h.sel().upper_leaflet || {}).hideFor, { ball: ['upper_headgroups'] },
    'le livre de comptes ne garde que le NOM de la rangée de têtes, jamais la tranche du script qui l’a définie (' +
    'sinon la règle d’exclusion, qui lit une expression comme n’importe quelle autre, viderait le feuillet)');
}
/* (b bis) SANS MESURE, la même scène : le nom écrit par le geste ne retire rien
   au feuillet — la hiérarchie des quatre noms n'existe que MESURÉE. */
{
  const { h } = scene({ noMeasurement: true, freezeMap: true, headsInBall: true });
  const { before, after } = gesture(h);
  ok(before[0] && before[0].atoms > 0, 'sans mesure, le feuillet dessine ce que le script a sélectionné');
  ok(after[0] && after[0].atoms === before[0].atoms,
    `…et le geste sur les têtes ne lui retire AUCUN atome\n  attendu ${before[0].atoms} atomes, obtenu ${after[0] ? after[0].atoms : 0}`);
  eq((h.sel().upper_leaflet || {}).hideFor, { ball: ['upper_headgroups'] },
    '…le nom y est bien écrit (le geste est mémorisé), mais il ne se résout pas sans mesure');
}

/* ── 5. MUTATION : LA VERSION D'AVANT LE CORRECTIF VIDE BIEN LE FEUILLET ─────
   Le même code, avec les trois lectures d'avant (selKeyExpr par le script,
   expandSelectionExpr par le pont, règle des têtes par selKeyExpr) et le geste
   sans garde. La sonde DOIT alors voir le défaut : sans cela, elle ne prouverait
   rien. */
{
  const { h, clauses } = scene({ freezeMap: true, preFix: true });
  const upperHeads = h.atomsOf(clauses.upper_headgroups);
  const { after, heads } = gesture(h);
  eq(after[0] ? after[0].atoms : 0, 0,
    'AVANT le correctif : le feuillet du haut se dessine (feuillet) and not (feuillet) — L’ENSEMBLE VIDE, ses chaînes acyle disparaissent (le rapport)');
  ok(heads[0] && heads[0].atoms > upperHeads.size,
    '…et la rangée de têtes avale la tranche du script au lieu des têtes mesurées');
}

/* ── 5 bis. MUTATION DE LA DEUXIÈME RÉPARATION ──────────────────────────────
   Le geste écrit l'expression (le code d'avant) et la règle d'exclusion ne
   reconnaît que les noms (l'ancienne) : la même bicouche, les mêmes têtes en
   ball+stick, le même CPK — et les entrées écrites en EXPRESSION passent la
   règle, le feuillet perd des atomes qu'il doit garder. */
{
  const RULE_CTX = {
    own: '@leaflet', parent: '', measured: { upper_leaflet: '@leaflet', upper_headgroups: '@heads' },
    scriptDefs: [['resn popc and z>0', 'upper_headgroups']],
  };
  const { h, clauses } = scene({ freezeMap: true, headsInBall: true, oldWrite: true });
  const upperHeads = h.atomsOf(clauses.upper_headgroups);
  const upperAll = h.atomsOf(clauses.upper_leaflet);
  const { after } = gesture(h);
  eq((h.sel().upper_leaflet || {}).hideFor, { ball: ['resn POPC and z>0', 'upper_headgroups'] },
    'AVANT la deuxième réparation : le feuillet reçoit l’EXPRESSION de la rangée de têtes (« resn POPC and z>0 »), celle de la macro');
  ok(after.length > 0 && after[0].atoms < upperAll.size - upperHeads.size,
    `…et il perd des atomes qu’il doit garder : ${after[0] ? after[0].atoms : 0} au lieu de ${upperAll.size - upperHeads.size} `
    + '— dans un fichier où la tranche du script coïncide avec le feuillet mesuré, il les perd TOUS (le rapport)');
  eq(h.kept('upper_leaflet', 'resn POPC and z>0', RULE_CTX), true,
    'AVANT : la règle accepte l’entrée écrite en expression (elle ne connaît que les noms)…');
  const fixed = scene({ freezeMap: true, headsInBall: true }).h;
  eq(fixed.kept('upper_leaflet', 'resn POPC and z>0', RULE_CTX), true,
    '…APRÈS aussi — mais elle est alors résolue comme le NOM qu’elle recopie : le feuillet retire les têtes MESURÉES, non la tranche du script (les nombres ci-dessus le montrent)');
  eq(h.kept('upper_headgroups', 'resn POPC and z>0', RULE_CTX), true,
    'AVANT, l’autre sens : la rangée de têtes acceptait sa PROPRE tranche — « têtes and not têtes », la rangée vide (le rapport « invisibili in ball and stick »)');
  eq(fixed.kept('upper_headgroups', 'resn POPC and z>0', RULE_CTX), false,
    'APRÈS : l’entrée est reconnue comme la rangée de têtes ELLE-MÊME et refusée — aucune rangée ne s’efface elle-même');
}

/* ── Bilan ───────────────────────────────────────────────────────────────── */
console.log(`_viewer_membrane_chains_test.mjs — ${passed} assertions OK (les chaînes acyle survivent au CPK des têtes)`);

