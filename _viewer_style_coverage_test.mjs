/* =========================================================================
   _viewer_style_coverage_test.mjs — LES COMMANDES DE STYLE DESSINENT TOUTE LA
   MOLÉCULE : chaque atome, chaque liaison.

   LE RAPPORT, MOT POUR MOT :
     « there are still important problems with the molecular viewer. the style
       commands are very strange. If I put the general to cartoon or to whatever
       other style nothing is displayed. If I put the backbone in ball and sticks
       the backbone is displayed correctly but then if I put the side chains in ball
       and sticks part of the backbone vanishes. In other words you have to deeply
       revise these commands because nothing works. I cannot even display the
       molecule in ball and sticks because it appears fragmented. »
   — et la référence que l'utilisateur donne : « in the vercel deployment be33c40 the
   controls of the viewer worked well ». be33c40 dessinait la scène comme L'UNION des
   rangées : la rangée General décrivait la molécule ENTIÈRE, chaque partie dessinait
   ses atomes, et RIEN ne retirait d'atomes à personne. Les sessions suivantes y ont
   ajouté un PARTAGE d'atomes (« la rangée General cède ses atomes aux parties qui ont
   leur propre style », le CA du squelette enlevé puis rendu), et les trois pannes du
   rapport en découlent :
     1. un General dont TOUTES les parties avaient dévié ne dessinait PLUS RIEN
        (`:A and protein and not (…) and not (…)` = ∅) — « nothing is displayed » ;
     2. la rangée des chaînes latérales perdait le CA que sa parenthèse venait de
        prendre (`(sidechain or .CA) and not backbone`) — les chaînes flottaient ;
     3. NGL ne dessine une liaison que si ses DEUX atomes sont dans la MÊME
        représentation : entre un squelette sans CA (N · C · O) et des chaînes
        latérales sans N ni C (CB · CG · …), les liaisons N–CA et CA–C
        n'appartenaient à AUCUNE représentation — « it appears fragmented ».

   CE QUE CETTE SUITE MESURE, SUR LE VRAI buildSectionReps : une protéine de quatre
   résidus (N · CA · C · O · CB · CG), ses liaisons, et un modèle des mots NGL que les
   sélections produites emploient (`protein` · `backbone` · `sidechain` · `.CA` ·
   `@index` · and / or / not). Pour chaque GESTE de la barre de style — les gestes sont
   appliqués par les VRAIES fonctions de la hiérarchie (setGeneralSectionField ·
   setRowSectionField) — les rangées réellement dessinées sont évaluées :
     • TOUTE la molécule est couverte : aucun atome que personne ne dessine ;
     • TOUTE liaison est dessinée par AU MOINS une rangée : aucune chaîne coupée ;
     • la rangée General, quand elle a un style, dessine la molécule ENTIÈRE ;
     • AUCUNE sélection produite n'est soustractive (` and not `) : une rangée ne peut
       donc plus être vidée ni amputée par une autre.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let passed = 0;
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const eq = (a, b, what) => {
  assert.deepEqual(a, b, `${what}\n  attendu : ${JSON.stringify(b)}\n  obtenu  : ${JSON.stringify(a)}`);
  passed += 1;
};

const SRC = process.env.VIEWER_SRC || new URL('./src/components/NMRMoleculeViewer.jsx', import.meta.url);
const VIEW = readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');
const has = (needle, what) => ok(VIEW.includes(needle), `${what}\n  introuvable : ${needle}`);
const gone = (needle, what) => ok(!VIEW.includes(needle), `${what}\n  encore présent : ${needle}`);

/* ── Extraction : `const name = (…) => { … };`, `const name = { … };`, ──────
   `const name = … ;` (corps d'expression : les crochets sont équilibrés). */
const MASK = VIEW.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
const sliceDecl = (src, name) => {
  const head = `const ${name} = `;
  const start = src.indexOf(head);
  assert.ok(start >= 0, `déclaration ${name} introuvable`);
  let depth = 0;
  for (let i = start + head.length; i < src.length; i += 1) {
    const c = MASK[i];
    if (c === '(' || c === '{' || c === '[') depth += 1;
    else if (c === ')' || c === '}' || c === ']') depth -= 1;
    else if (c === ';' && depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`${name} : déclaration non terminée`);
};
const sliceFn = (src, name) => {
  const start = src.indexOf(`const ${name} = `);
  assert.ok(start >= 0, `fonction ${name} introuvable`);
  const arrow = src.indexOf('=>', start);
  const body = arrow >= 0 ? src.indexOf('{', arrow) : -1;
  const between = body > arrow ? MASK.slice(arrow + 2, body).trim() : 'x';
  if (body < 0 || between !== '') return sliceDecl(src, name);
  let depth = 0;
  for (let i = body; i < src.length; i += 1) {
    if (MASK[i] === '{') depth += 1;
    else if (MASK[i] === '}') { depth -= 1; if (depth === 0) return `${src.slice(start, i + 1)};`; }
  }
  throw new Error(`${name} : corps non terminé`);
};
// Un nom qui n'existe QUE dans une révision plus ancienne du viewer (VIEWER_SRC, pour
// comparer avant/après le rapport) : extrait quand il est là, ignoré sinon.
const sliceMaybe = (src, name) => (src.includes(`const ${name} = `) ? sliceFn(src, name) : '');
const sliceObject = (src, name) => {
  const start = src.indexOf(`const ${name} = {`);
  assert.ok(start >= 0, `objet ${name} introuvable`);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i += 1) {
    if (MASK[i] === '{') depth += 1;
    else if (MASK[i] === '}') { depth -= 1; if (depth === 0) return `${src.slice(start, i + 1)};`; }
  }
  throw new Error(`${name} : objet non terminé`);
};

/* ══ 1. LA MOLÉCULE D'ESSAI ET LE MODÈLE DES MOTS NGL ═════════════════════════
   Une protéine de quatre résidus, chaîne A : les SIX atomes lourds d'une alanine
   (N · CA · C · O · CB · CG) et leurs liaisons — N–CA, CA–C, C–O, CA–CB, CB–CG, plus
   le peptide C(i)–N(i+1). Les atomes portent `eachBondedAtom`, donc le PONT d'une
   rangée (bridgeAtomIndices) est calculé pour de vrai, comme dans le navigateur. */
const BACKBONE_NAMES = new Set(['N', 'CA', 'C', 'O']);
const ATOM_NAMES = ['N', 'CA', 'C', 'O', 'CB', 'CG'];
const RESIDUES = 4;
const atoms = [];
for (let resno = 1; resno <= RESIDUES; resno += 1) {
  ATOM_NAMES.forEach((name) => {
    const element = name[0] === 'C' ? 'C' : name === 'N' ? 'N' : 'O';
    atoms.push({ index: atoms.length, name, atomname: name, element, resno, chainname: 'A', chainname2: 'A', resname: 'ALA', eachBondedAtom: () => {} });
  });
}
const indexOf = (resno, name) => atoms.find((a) => a.resno === resno && a.name === name).index;
const BONDS = [];
const bond = (x, y) => { if (Number.isFinite(x) && Number.isFinite(y)) BONDS.push([x, y]); };
for (let resno = 1; resno <= RESIDUES; resno += 1) {
  bond(indexOf(resno, 'N'), indexOf(resno, 'CA'));
  bond(indexOf(resno, 'CA'), indexOf(resno, 'C'));
  bond(indexOf(resno, 'C'), indexOf(resno, 'O'));
  bond(indexOf(resno, 'CA'), indexOf(resno, 'CB'));
  bond(indexOf(resno, 'CB'), indexOf(resno, 'CG'));
  if (resno < RESIDUES) bond(indexOf(resno, 'C'), indexOf(resno + 1, 'N'));
}
// Chaque atome sait à qui il est lié (ce que bridgeAtomIndices lit).
atoms.forEach((a) => {
  a.eachBondedAtom = (cb) => BONDS.forEach(([x, y]) => {
    if (x === a.index) cb(atoms[y]);
    else if (y === a.index) cb(atoms[x]);
  });
});
const STRUCTURE = { eachAtom: (cb) => atoms.forEach((a) => cb(a)) };
const label = (i) => `${atoms[i].resno}${atoms[i].name}`;

/* LE MODÈLE DES MOTS NGL — exactement ceux que sectionRowSele emploie :
   `:A` (chaîne), `protein` (nos quatre résidus le sont), `backbone` (N · CA · C · O),
   `sidechain` (le reste), `.CA`, `@i,j,k` (liste d'index), `all`, et les trois
   combinaisons « or », « and », « and not » avec parenthèses. NGL ne dessine une
   liaison que si les DEUX atomes sont dans la MÊME sélection : c'est la règle que le
   modèle rejoue pour compter les liaisons qu'aucune rangée ne dessine. */
const ATOM_EVAL = (sele) => {
  const s = String(sele || '');
  let i = 0;
  const skip = () => { while (i < s.length && s[i] === ' ') i += 1; };
  const word = () => {
    const j = i;
    while (i < s.length && s[i] !== ' ' && s[i] !== '(' && s[i] !== ')') i += 1;
    return s.slice(j, i);
  };
  const setOf = (w) => {
    const out = new Set();
    if (w === 'all') return new Set(atoms.map((a) => a.index));
    if (w.startsWith('@')) {
      w.slice(1).split(',').forEach((n) => { const k = Number(n); if (Number.isFinite(k)) out.add(k); });
      return out;
    }
    if (w.startsWith(':')) {
      atoms.forEach((a) => { if (a.chainname === w.slice(1)) out.add(a.index); });
      return out;
    }
    atoms.forEach((a) => {
      if (w === 'protein') out.add(a.index);
      else if (w === 'backbone' && BACKBONE_NAMES.has(a.name)) out.add(a.index);
      else if (w === 'sidechain' && !BACKBONE_NAMES.has(a.name)) out.add(a.index);
      else if (w === '.CA' && a.name === 'CA') out.add(a.index);
    });
    return out;
  };
  const factor = () => {
    skip();
    if (s[i] === '(') { i += 1; const r = expr(); skip(); if (s[i] === ')') i += 1; return r; }
    return setOf(word());
  };
  const term = () => {
    let set = factor();
    for (;;) {
      skip();
      if (s.startsWith('and not ', i)) { i += 8; const b = factor(); set = new Set([...set].filter((x) => !b.has(x))); }
      else if (s.startsWith('and ', i)) { i += 4; const b = factor(); set = new Set([...set].filter((x) => b.has(x))); }
      else return set;
    }
  };
  const expr = () => {
    let set = term();
    for (;;) {
      skip();
      if (s.startsWith('or ', i)) { i += 3; term().forEach((x) => set.add(x)); }
      else return set;
    }
  };
  const result = expr();
  skip();
  eq(i, s.length, `le modèle lit la sélection ENTIÈRE : « ${s} »`);
  return result;
};

/* ══ 2. LE RENDU RÉEL : buildSectionReps, sur la molécule d'essai ═════════════ */
const SCHEME_KEYS = [
  'let elementSchemeKey = "k-element"; let residueSchemeKey = "k-residue"; let baseTypeSchemeKey = "k-base";',
  'let sstrucSchemeKey = "k-sstruc"; let sugarSchemeKey = "k-sugar"; let glycanSchemeKey = "k-glycan";',
  'let lipidClassSchemeKey = "k-lipid"; let nucleicFormSchemeKey = "k-form"; let nucleicMotifSchemeKey = "k-motif";',
  'let chargeSchemeKey = "k-charge"; let chainSchemeKey = "k-chain"; let gradientSchemeKey = "k-gradient";',
].join('\n');
// `ATOM_EVAL` remplace le lecteur de sélection de la page (atomIndicesForSele) : le pont
// d'une rangée (bridgeAtomIndices) et la restriction à la molécule de la section
// (moleculeIndicesOf) passent donc par le MÊME modèle de mots NGL que la mesure.
const MODULE = new Function('ATOM_EVAL', 'STRUCTURE', [
  sliceDecl(VIEW, 'LICORICE_BOND_RADIUS'),
  sliceDecl(VIEW, 'BALLSTICK_BOND_RADIUS'),
  sliceDecl(VIEW, 'BASE_BOND_RADIUS'),
  sliceDecl(VIEW, 'TUBE_RADIUS'),
  sliceFn(VIEW, 'sectionOpacity'),
  sliceObject(VIEW, 'DEFAULT_ATOM_COLORS'),
  sliceObject(VIEW, 'KIND_CATEGORY'),
  sliceDecl(VIEW, 'DEFAULT_ELEMENT_COLOR'),
  sliceObject(VIEW, 'STYLES'),
  sliceObject(VIEW, 'COLORS'),
  sliceObject(VIEW, 'SECTION_SUBSECTIONS'),
  sliceDecl(VIEW, 'subsectionsOf'),
  sliceDecl(VIEW, 'subsectionSpec'),
  sliceFn(VIEW, 'defaultLookOf'),
  sliceFn(VIEW, 'effectiveSectionLook'),
  sliceDecl(VIEW, 'ATOM_DRAW_STYLES'),
  sliceFn(VIEW, 'sectionRowSele'),
  'const atomIndicesForSele = (structure, sele) => (structure === STRUCTURE ? [...ATOM_EVAL(sele)] : []);',
  sliceDecl(VIEW, 'moleculeIndexCache'),
  sliceFn(VIEW, 'moleculeIndicesOf'),
  sliceDecl(VIEW, 'indexSele'),
  sliceFn(VIEW, 'bridgeAtomIndices'),
  sliceFn(VIEW, 'anchoredPartSele'),
  sliceFn(VIEW, 'nucleicGroupOf'),
  sliceDecl(VIEW, 'nucleicGroupCache'),
  sliceFn(VIEW, 'nucleicGroupIndicesIn'),
  sliceFn(VIEW, 'nucleotideGroupIndices'),
  sliceDecl(VIEW, 'emptySelectionWarned'),
  sliceFn(VIEW, 'warnIfEmptySelection'),
  sliceDecl(VIEW, 'schemeParam'),
  sliceFn(VIEW, 'sectionColorParams'),
  sliceFn(VIEW, 'sectionStyleReps'),
  SCHEME_KEYS,
  'const espColorParams = () => ({ colorScheme: "esp" });',
  'const flagMeshShadows = () => {};',
  'const nucleicRingPlates = () => null;',
  'const DEFAULT_NUCLEIC_COLORS = { base: 0xffffff, sugar: 0xffffff, phosphate: 0xffffff };',
  'const gradientRangesFor = () => null;',
  'const gradientColorStore = { ranges: null };',
  sliceMaybe(VIEW, 'SPLINE_STYLES'),
  sliceMaybe(VIEW, 'generalWalkingSele'),
  sliceFn(VIEW, 'buildSectionReps'),
  'return { buildSectionReps };',
].join('\n'))(ATOM_EVAL, STRUCTURE);

// Les VRAIES fonctions de la hiérarchie : un geste de la barre s'applique exactement
// comme dans le navigateur (cascade sur General, déviation sur une rangée).
const HIER = new Function([
  sliceObject(VIEW, 'DEFAULT_ATOM_COLORS'),
  sliceObject(VIEW, 'KIND_CATEGORY'),
  sliceDecl(VIEW, 'DEFAULT_ELEMENT_COLOR'),
  sliceObject(VIEW, 'STYLES'),
  sliceObject(VIEW, 'COLORS'),
  sliceObject(VIEW, 'SECTION_SUBSECTIONS'),
  sliceDecl(VIEW, 'subsectionsOf'),
  sliceDecl(VIEW, 'subsectionSpec'),
  sliceDecl(VIEW, 'SECTION_LOOK_FIELDS'),
  sliceDecl(VIEW, 'FOLLOW_FIELDS'),
  sliceFn(VIEW, 'defaultLookOf'),
  sliceFn(VIEW, 'effectiveSectionLook'),
  sliceFn(VIEW, 'partStyleUnderGeneral'),
  sliceDecl(VIEW, 'RADIUS_FIELDS'),
  sliceFn(VIEW, 'setGeneralSectionField'),
  sliceFn(VIEW, 'setRowSectionField'),
  'return { setGeneralSectionField, setRowSectionField, effectiveSectionLook };',
].join('\n'))();

const SECTIONS = [{ id: 'main::protein|A', key: 'protein|A', kind: 'protein', name: 'Chain A', sele: ':A and protein', count: 1 }];
const LOOK = (style, colorBy, follow) => ({ style, colorBy, solidColor: 0xffffff, opacity: 0, sphere: 1, bond: 1, follow });
const tree = (g, b, s) => ({ protein: { general: LOOK(g[0], g[1], false), backbone: LOOK(b[0], b[1], b[2]), sidechain: LOOK(s[0], s[1], s[2]) } });
const sceneOf = (t) => {
  const reps = [];
  const comp = {
    structure: STRUCTURE,
    addRepresentation(type, params) { const rep = { type, params }; reps.push(rep); return rep; },
  };
  MODULE.buildSectionReps(comp, SECTIONS, { 'main::protein|A': t }, {});
  return reps;
};
/* Ce que la scène DESSINE vraiment : l'union des sélections de ses rangées. Un atome
   absent de toute sélection n'est dessiné par personne ; une liaison dont un seul bout
   est dessiné (ou dont les deux bouts sont dans deux rangées différentes) n'est
   dessinée par aucune — c'est exactement la règle de NGL. */
/* LE STYLE D'UNE RANGÉE DIT CE QU'ELLE PEUT DESSINER : un « cartoon », un
   « ribbon », un « tube » ou un « trace » NE DESSINE AUCUN ATOME (NGL le fait courir
   le long des CA), donc il ne comble jamais une liaison manquante ; une enveloppe
   (« surface ») recouvre les atomes qu'elle décrit ; les styles qui dessinent des
   ATOMES (ball+stick · licorice · line · spacefill) portent, EUX, les bâtons. */
const ATOM_REPS = new Set(['ball+stick', 'licorice', 'line', 'spacefill', 'base']);
const coverage = (reps) => {
  const sets = reps.map((r) => ATOM_EVAL(r.params.sele));
  const described = new Set();
  sets.forEach((s) => s.forEach((x) => described.add(x)));
  const atomSets = [];
  reps.forEach((r, i) => { if (ATOM_REPS.has(r.type)) atomSets.push(sets[i]); });
  const atomDrawn = new Set();
  atomSets.forEach((s) => s.forEach((x) => atomDrawn.add(x)));
  return {
    missingAtoms: atoms.filter((a) => !described.has(a.index)).map((a) => label(a.index)),
    // Une liaison dont les DEUX atomes sont dessinés en ATOMES doit tenir dans UNE
    // SEULE représentation (la règle de NGL) : c'est exactement « part of the
    // backbone vanishes » quand elle est violée — N dans la rangée du squelette, CA
    // dans celle des chaînes latérales, et le bâton n'appartient à personne.
    missingBonds: BONDS
      .filter(([x, y]) => atomDrawn.has(x) && atomDrawn.has(y) && !atomSets.some((s) => s.has(x) && s.has(y)))
      .map(([x, y]) => `${label(x)}–${label(y)}`),
    subtractive: reps.filter((r) => String(r.params.sele).includes(' and not ')).map((r) => r.params.sele),
  };
};
const gesture = (steps) => steps.reduce((t, [kind, sub, field, value]) => (
  sub === 'general'
    ? HIER.setGeneralSectionField(t, kind, field, value)
    : HIER.setRowSectionField(t, kind, sub, field, value)
), {});
const check = (what, t) => {
  const reps = sceneOf(t);
  const c = coverage(reps);
  eq(c.missingAtoms, [], `${what} : AUCUN atome n’est laissé hors de toute rangée dessinée`);
  eq(c.missingBonds, [], `${what} : AUCUNE liaison dont les deux atomes sont dessinés n’est laissée sans bâton`);
  eq(c.subtractive, [], `${what} : aucune clause soustractive n’est produite`);
  return reps;
};

/* ══ 3. LES GESTES DU RAPPORT ═════════════════════════════════════════════════
   Les gestes sont ceux de la barre : un style sur « General » passe par la cascade
   (setGeneralSectionField), un style sur une rangée la fait dévier
   (setRowSectionField). Chaque séquence est mesurée : molécule entière, liaisons
   entières, aucune soustraction. */

// 3a. « If I put the general to cartoon or to whatever other style nothing is
//     displayed. » — un style choisi sur General décrit la molécule ENTIÈRE.
['cartoon', 'ribbon', 'tube', 'ball+stick', 'licorice', 'line', 'spacefill', 'sphere'].forEach((style) => {
  const reps = check(`General → ${style}`, gesture([['protein', 'general', 'style', style]]));
  eq(reps.filter((r) => r.params.sele === ':A and protein').length, 1,
    `General → ${style} : la rangée General dessine la molécule entière, une seule fois`);
});

// 3b. « General → hide » : RIEN n'est dessiné — c'est la demande (« quando general é su
//     hide, si attivano backbone e sidechain che invece dovrebbero essere entrambi su
//     hide »). La cascade met toutes les parties sur « Hide », ce « Hide » tient
//     (effectiveSectionLook), et la scène est VIDE : le ✔ de l'en-tête ou un style sur
//     n'importe quelle rangée la ramène.
eq(sceneOf(gesture([['protein', 'general', 'style', 'hide']])), [],
  'General → hide : la scène est vide, comme demandé — aucune sous-rangée ne se rallume toute seule');

// 3c. LE RAPPORT, SYMPTÔME 2 : « If I put the backbone in ball and sticks the backbone
//     is displayed correctly but then if I put the side chains in ball and sticks part
//     of the backbone vanishes. » Le squelette garde TOUS ses CA (sans eux, N–CA et
//     CA–C ne sont dans aucune représentation) et la parenthèse des chaînes latérales
//     garde le CA qu'elle prend.
const bb = check('Backbone → ball+stick (General cartoon)', gesture([['protein', 'backbone', 'style', 'ball+stick']]));
ok(bb.some((r) => r.params.sele === ':A and protein and backbone'),
  '…la rangée du squelette dessine son squelette ENTIER, CA compris');
const both = check('Backbone → ball+stick PUIS Side chains → ball+stick',
  gesture([['protein', 'backbone', 'style', 'ball+stick'], ['protein', 'sidechain', 'style', 'ball+stick']]));
ok(both.some((r) => r.params.sele === ':A and protein and (sidechain or .CA)'),
  '…et les chaînes latérales gardent le CA de leur parenthèse : la liaison CB–CA est dessinée');
ok(both.some((r) => r.params.sele === ':A and protein'),
  '…sous le dessin de General, resté ENTIER — c’est lui qui tenait la chaîne ensemble');

// 3d. LE RAPPORT, SYMPTÔME 3 : « I cannot even display the molecule in ball and sticks
//     because it appears fragmented. » Les deux parties dévient, PUIS General prend les
//     ball and sticks : la molécule entière est en ball and sticks, sans trou.
check('les deux parties en ball+stick, PUIS General → ball+stick',
  gesture([
    ['protein', 'backbone', 'style', 'ball+stick'],
    ['protein', 'sidechain', 'style', 'ball+stick'],
    ['protein', 'general', 'style', 'ball+stick'],
  ]));
check('General → ball+stick PUIS Backbone → licorice (une partie dévie)',
  gesture([['protein', 'general', 'style', 'ball+stick'], ['protein', 'backbone', 'style', 'licorice']]));
check('General → ball+stick PUIS Side chains → sphere',
  gesture([['protein', 'general', 'style', 'ball+stick'], ['protein', 'sidechain', 'style', 'sphere']]));

// 3e. L'ORDRE DE L'ANCIEN RAPPORT : « General → Tube » puis « Backbone → Cartoon » —
//     la molécule reste entière, et les DEUX dessins sont là (le tube de General décrit
//     la molécule, le cartoon du squelette se dessine par-dessus : deux `show` de PyMOL
//     peuvent couvrir les mêmes atomes).
const tubeThen = check('General → tube PUIS Backbone → cartoon',
  gesture([['protein', 'general', 'style', 'tube'], ['protein', 'backbone', 'style', 'cartoon']]));
ok(tubeThen.some((r) => r.type === 'tube' && r.params.sele === ':A and protein'),
  '…le tube de General décrit toujours la molécule entière');
ok(tubeThen.some((r) => r.type === 'cartoon' && r.params.sele === ':A and protein and backbone'),
  '…et le cartoon du squelette se dessine vraiment (aucune rangée ne lui prend ses atomes)');

// 3f. UNE ENVELOPPE (« surface ») n'a aucun atome à donner ni à prendre : General
//     l'applique à la molécule entière, et les parties (qui ne savent pas la dessiner)
//     passent sur « Hide » par la cascade.
check('General → surface', gesture([['protein', 'general', 'style', 'surface']]));

// 3g. Le DÉFAUT d'une molécule neuve ne bouge pas d'un caractère : General cartoon, le
//     squelette qui le suit, et les chaînes latérales en licorice.
check('le dessin par défaut (General cartoon · Backbone qui suit · Side chains licorice)',
  tree(['cartoon', 'sstruc'], ['cartoon', 'sstruc', true], ['licorice', 'element', true]));

/* ══ 4. LE CÂBLAGE : LA RÈGLE D'UNION EST DANS LA SOURCE ═════════════════════ */
has("next.follow = next.style !== 'hide' || value === 'hide';",
  'la cascade de General laisse une partie cachée PAR GENERAL dans la hiérarchie (elle le suit)');
has("if (own.style === 'hide') return { ...own, follow: true };",
  '…et ce « Hide » TIENT : la partie ne retombe pas sur son propre style par défaut');
has('const sele = sectionRowSele(structure, sec, spec.sub, { anchorSideChains, anchorParts });',
  'la sélection d’une rangée est ce que sectionRowSele écrit — pour General la molécule entière, pour une partie sa part (+ ancre, + pont)');
has('      : `${base} and backbone`;', 'le squelette garde ses CA : la chaîne ne se coupe plus');
gone('const giveAway =', 'la CESSION D’ATOMES a disparu (aucune clause « and not » n’est fabriquée)');
gone('const generalKeeps =', '…ni « les atomes que le style de General parcourt » à protéger');
gone('const relinquished =', '…ni la liste des parties qui prenaient les atomes de General');
gone('const generalOnly', '…ni la sélection remplacée de la rangée General');
gone('const backboneLosesCa = anchorSideChains', '…ni les CA cédés par le squelette');

console.log(`_viewer_style_coverage_test.mjs — ${passed} assertions OK (chaque atome, chaque liaison)`);
