/* =========================================================================
   _viewer_general_cession_test.mjs — LA RANGÉE GENERAL DESSINE CE QUE LES AUTRES
   LUI LAISSENT : le style PROPRE d'une sous-rangée l'emporte sur General POUR
   EXACTEMENT les atomes qu'elle dessine.

   Le geste de l'utilisateur, mot pour mot :
     « General en ball and stick = la molécule entière en ball and stick ; puis Lines
       sur les chaînes latérales → les billes/bâtons disparaissent pour les SEULES
       chaînes latérales, et des lignes apparaissent à leur place. »

   Ce que cette suite mesure, sur la RÈGLE elle-même — `generalCession` et
   `partAtomsHeldBack`, extraits du viewer et exécutés sur une protéine de quatre
   résidus (le banc atome par atome de _viewer_style_coverage_test.mjs) :

     §1 QUI CÈDE : seules les rangées qui ont leur PROPRE style (`follow: false`), et
        leur clause est celle de sectionRowSele (part + ancre + ponts), jamais amputée ;
     §2 QUI NE CÈDE PAS : une rangée qui SUIT General, une ENVELOPPE (surface · mesh,
        un seul objet), et le défaut d'une molécule neuve ;
     §3 LE GARDE-FOU : l'atome dont un voisin ne serait plus dessiné par personne reste
        à General — c'est le CA quand les chaînes latérales prennent leur CB ;
     §4 UN PARCOURS NE SE COUPE PAS : General → cartoon ne dessine plus son ruban quand
        le squelette a pris le sien, mais le garde quand ce squelette est CACHÉ ;
     §5 LA PANNE « nothing is displayed » : quand les parties ont tout pris, la rangée
        General n'est pas construite du tout (`empty`) ;
     §6 LE CÂBLAGE, ET LA MOLÉCULE ENTIÈRE : la règle est appelée par le rendu, sa
        clause est la seule soustractive du rendu, et un VRAI NGL relit la molécule que
        General garde (un POPC : `[POPC] and not (…)`).

   VIEWER_SRC rejoue la suite sur une version d'avant la règle : elle y est ROUGE — la
   règle n'y existe pas (`generalCession`), et le banc peut même ne pas s'y construire si
   cette révision nomme autrement ce dont il a besoin.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// Le VRAI NGL de la page (le `require` est résolu depuis CE fichier, donc depuis
// node_modules du dépôt) — pour §6, où une vraie sélection doit être relue.
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
const gone = (needle, what) => ok(!VIEW.includes(needle), `${what}\n  encore là   : ${needle}`);

/* ── Extraction : `const name = (…) => { … };`, `const name = { … };`, ─────────
   `const name = … ;` — le comptage de profondeur lit un MASQUE où les commentaires
   sont remplacés par des espaces de même longueur (la prose du viewer est pleine de
   parenthèses et de points-virgules). */
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
// Un nom qui n'existe QUE dans la version d'APRÈS (VIEWER_SRC rejoue la suite sur une
// révision plus ancienne, pour vérifier qu'elle y est ROUGE) : extrait quand il est là,
// ignoré sinon — la première assertion du fichier dit alors ce qui manque.
const sliceMaybe = (src, name) => (src.includes(`const ${name} = `) ? sliceDecl(src, name) : '');
/* ══ 0. LE BANC D'ESSAI : UNE PROTÉINE DE QUATRE RÉSIDUS ══════════════════════
   Les SIX atomes lourds d'une alanine (N · CA · C · O · CB · CG) et leurs liaisons —
   N–CA, CA–C, C–O, CA–CB, CB–CG, plus le peptide C(i)–N(i+1). Chaque atome connaît ses
   VOISINS COVALENTS (`eachBondedAtom`), donc le pont d'une rangée et le garde-fou de la
   cession sont calculés pour de vrai. `ATOM_EVAL` rejoue les mots NGL que les sélections
   produites emploient : `:A` · `protein` · `backbone` · `sidechain` · `.CA` · `@liste`
   · and / or / and not, parenthèses comprises. */
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
atoms.forEach((a) => {
  a.eachBondedAtom = (cb) => BONDS.forEach(([x, y]) => {
    if (x === a.index) cb(atoms[y]);
    else if (y === a.index) cb(atoms[x]);
  });
});
const STRUCTURE = { eachAtom: (cb) => atoms.forEach((a) => cb(a)) };
const CAS = [1, 2, 3, 4].map((resno) => indexOf(resno, 'CA'));
const SIDECHAINS = atoms.filter((a) => !BACKBONE_NAMES.has(a.name)).map((a) => a.index);
const label = (i) => `${atoms[i].resno}${atoms[i].name}`;
const list = (set) => [...set].sort((a, b) => a - b);
const labelsOf = (set) => list(set).map(label);

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

/* ══ 1. LA RÈGLE, EXTRAITE DU VIEWER ET EXÉCUTÉE ══════════════════════════════ */
const SECTION = { id: 'main::protein|A', key: 'protein|A', kind: 'protein', name: 'Chain A', sele: ':A and protein', count: 1 };
const RULE = new Function('ATOM_EVAL', 'STRUCTURE', [
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
  sliceMaybe(VIEW, 'SPLINE_STYLES'),
  sliceMaybe(VIEW, 'SPLINE_TRAIT_OWNERS'),
  sliceMaybe(VIEW, 'partAtomsHeldBack'),
  sliceMaybe(VIEW, 'generalCession'),
  'return { generalCession, partAtomsHeldBack, sectionRowSele, SPLINE_STYLES, SPLINE_TRAIT_OWNERS };',
].join('\n'))(ATOM_EVAL, STRUCTURE);

ok(typeof RULE.generalCession === 'function',
  'la règle de la cession est une fonction à part, lisible et mesurable seule');
ok(typeof RULE.partAtomsHeldBack === 'function',
  '…avec son garde-fou : l’atome qu’une part ne peut pas emporter');
eq(RULE.SPLINE_STYLES, ['cartoon', 'ribbon', 'tube', 'trace'],
  'les styles qui PARCOURTENT la molécule sont nommés une fois pour toutes');
eq(RULE.SPLINE_TRAIT_OWNERS, { protein: ['backbone'], nucleic: ['backbone', 'ribose'] },
  '…et les rangées qui parcourent le même chemin, par type de section');

// Les looks d'un essai : ce que la barre écrit dans l'arbre de la section. `follow`
// (faux pour GENERAL) dit si la rangée SUIT General — le défaut d'une molécule neuve —
// ou si elle a son PROPRE style.
const LOOK = (style, follow) => ({ style, colorBy: 'element', solidColor: 0xffffff, opacity: 0, sphere: 1, bond: 1, follow });
const looksOf = (rows) => ({
  general: LOOK(rows.general ? rows.general.style : 'cartoon', false),
  backbone: LOOK(rows.backbone ? rows.backbone.style : 'cartoon', !rows.backbone || rows.backbone.follow !== false),
  sidechain: LOOK(rows.sidechain ? rows.sidechain.style : 'licorice', !rows.sidechain || rows.sidechain.follow !== false),
});
const NONE = { cede: '', empty: false, walkLost: false };
const cessionOf = (rows, opts = {}) => RULE.generalCession(STRUCTURE, SECTION, looksOf(rows), opts);

/* ── §1 · LE GESTE DE L'UTILISATEUR : « Lines » sur les chaînes latérales ────── */
const lines = cessionOf(
  { general: { style: 'ball+stick' }, backbone: { style: 'ball+stick' }, sidechain: { style: 'line', follow: false } },
  { anchorSideChains: true },
);
eq(lines.cede, `(:A and protein and (sidechain or .CA) and not @${CAS.join(',')})`,
  'la clause des chaînes latérales est celle de sectionRowSele, MOINS les CA que General doit garder');
eq(labelsOf(ATOM_EVAL(lines.cede)), ['1CB', '1CG', '2CB', '2CG', '3CB', '3CG', '4CB', '4CG'],
  '…et elle emporte EXACTEMENT les atomes des chaînes latérales : pas un de plus');
eq(lines.empty, false, '…il reste donc de quoi dessiner à General (le squelette et ses CA)');
eq(lines.walkLost, false, '…et un style qui DESSINE DES ATOMES ne prend jamais le parcours');

// Le squelette dévié prend le sien, sans laisser personne amputé : sa clause est
// exactement ce que sectionRowSele écrit, et il garde les CA dont il a besoin.
const backboneRow = cessionOf(
  { general: { style: 'ball+stick' }, backbone: { style: 'line', follow: false } },
  { anchorSideChains: true },
);
eq(backboneRow.cede, `(:A and protein and backbone and not @${CAS.join(',')})`,
  'la clause du squelette garde les mêmes CA : la liaison N–CA reste dans une représentation');
eq(labelsOf(ATOM_EVAL(backboneRow.cede)), ['1N', '1C', '1O', '2N', '2C', '2O', '3N', '3C', '3O', '4N', '4C', '4O'],
  '…et elle dessine tout le reste de son squelette, CA compris par sa propre sélection');

/* ── §2 · QUI NE CÈDE RIEN ──────────────────────────────────────────────────── */
eq(cessionOf({ general: { style: 'ball+stick' }, backbone: { style: 'ball+stick', follow: true } }), NONE,
  'une partie qui SUIT General ne prend rien : sa rangée dessine avec le style de General');
['surface', 'mesh', 'hide'].forEach((style) => eq(
  cessionOf({ general: { style }, backbone: { style: 'licorice', follow: false } }), NONE,
  `General → ${style} : rien n’est cédé — une enveloppe est UN objet, « Hide » n’a rien à dessiner`,
));
eq(cessionOf({ general: { style: 'ball+stick' } }), NONE,
  '…et un style de General que TOUTES les parties suivent ne cède rien non plus');
eq(cessionOf({}), NONE, 'le DÉFAUT d’une molécule neuve ne bouge pas d’un atome');

/* ── §3 · LE GARDE-FOU : UNE LIAISON NE SE COUPE PAS ────────────────────────── */
// Le CA que les chaînes latérales viennent de prendre RESTE à General : sans lui, la
// liaison CB–CA n'appartiendrait à aucune représentation — c'est le symptôme « it
// appears fragmented » du rapport, et c'est exactement ce que la part ne peut pas
// emporter (le N du squelette, lui, n'est dessiné par aucune des deux rangées).
const sidechainPart = new Set([...CAS, ...SIDECHAINS]);
const heldForSidechains = RULE.partAtomsHeldBack(STRUCTURE, sidechainPart, sidechainPart, sidechainPart, new Set(atoms.map((a) => a.index)));
eq(labelsOf(heldForSidechains), ['1CA', '2CA', '3CA', '4CA'],
  'le garde-fou retient les CA : le voisin N n’est dessiné ni par la part ni par une autre part');
// …et il ne retient RIEN de trop : dès qu'un voisin est emporté par une autre rangée
// (ici : tout le monde, `taken` = la molécule entière), la part emporte ce qu'elle veut.
eq([...RULE.partAtomsHeldBack(STRUCTURE, sidechainPart, sidechainPart, new Set(atoms.map((a) => a.index)), new Set(atoms.map((a) => a.index)))], [],
  'un atome dont chaque voisin est dessiné par la part (ou emporté avec une autre) ne reste pas à General');
// Un HYDROGÈNE ne retient personne : il ne relie jamais deux parts, et les rangées des
// bases ou des pentoses ne le listent même pas (nucleicGroupIndicesIn les écarte).
const hOnly = { eachAtom: (cb) => cb({ index: 0, element: 'C', eachBondedAtom: (n) => n({ index: 1, element: 'H' }) }) };
eq([...RULE.partAtomsHeldBack(hOnly, new Set([0]), new Set([0]), new Set([0]), new Set([0, 1]))], [],
  'un hydrogène voisin ne retient pas son atome lourd — sinon aucune base ne quitterait General');

/* ── §4 · UN PARCOURS NE SE COUPE PAS ───────────────────────────────────────── */
['cartoon', 'ribbon', 'tube', 'trace'].forEach((st) => {
  const taken = cessionOf({ general: { style: st }, backbone: { style: 'ball+stick', follow: false } });
  eq(taken.walkLost, true,
    `General → ${st} : le squelette a pris SON parcours, donc General ne rejoue pas le sien`);
  eq(taken.cede, '',
    `…et rien n’est cédé atome par atome : un parcours se prend ENTIER (ou pas du tout)`);
  eq(cessionOf({ general: { style: st }, backbone: { style: 'hide', follow: false } }).walkLost, false,
    `…mais un squelette CACHÉ ne prend pas le parcours : son ruban reste le seul dessin de la chaîne`);
  eq(cessionOf({ general: { style: st }, backbone: { style: 'cartoon', follow: true } }).walkLost, false,
    `…et un squelette qui SUIT General ne prend rien : le défaut d’une molécule est intact`);
});
// Un ACIDE NUCLÉIQUE : le C4' du sucre est le TRACE ATOM de NGL, donc la RIBOSE parcourt
// le même chemin que le squelette — son style propre emporte le ruban de General aussi.
const NUCLEIC = { ...SECTION, kind: 'nucleic', sele: ':A and nucleic' };
const nucleicLooks = {
  general: LOOK('cartoon', false), backbone: LOOK('cartoon', true),
  bases: LOOK('rings', true), ribose: LOOK('ball+stick', false),
};
ok(RULE.generalCession(STRUCTURE, NUCLEIC, nucleicLooks, {}).walkLost,
  'le style propre de la RIBOSE emporte le ruban de General (SPLINE_TRAIT_OWNERS.nucleic)');
ok(!RULE.generalCession(STRUCTURE, NUCLEIC, { ...nucleicLooks, ribose: LOOK('hide', false) }, {}).walkLost,
  '…mais pas quand cette ribose est sur « Hide » : General reste le seul à parcourir la chaîne');

/* ── §5 · LA PANNE « nothing is displayed » NE PEUT PLUS ARRIVER ────────────── */
// Les deux rangées déviées prennent tout, la partie cachée cède ses atomes : il ne
// reste RIEN à General — et c'est DIT (`empty`), donc sa rangée n'est pas construite
// du tout (voir buildSectionReps) au lieu de partir à NGL avec une sélection vide.
const everyone = cessionOf(
  { general: { style: 'ball+stick' }, backbone: { style: 'line', follow: false }, sidechain: { style: 'line', follow: false } },
  { anchorSideChains: true },
);
eq(everyone.cede, '(:A and protein and backbone) or (:A and protein and (sidechain or .CA))',
  'les deux rangées en atomes prennent leurs atomes, chacune sans être amputée');
eq(everyone.empty, true,
  '…et quand il ne reste plus un atome, la rangée General n’est pas dessinée (plus jamais vide à l’écran)');
const withHidden = cessionOf(
  { general: { style: 'ball+stick' }, backbone: { style: 'ball+stick', follow: false }, sidechain: { style: 'hide', follow: false } },
  { anchorSideChains: false },
);
eq(withHidden.cede, '(:A and protein and backbone) or (:A and protein and sidechain)',
  'une partie CACHÉE cède ses PROPRES atomes, sans ancre : « Hide » veut dire « ne dessine plus ceux-là »');
eq(withHidden.empty, true, '…et General s’efface quand tout est pris ou caché');

/* ══ 6. LA MOLÉCULE ENTIÈRE, RELUE PAR UN VRAI NGL ════════════════════════════
   La règle n'est pas qu'un code couleur : la sélection qu'elle écrit pour General part
   à NGL, qui doit la lire. Un POPC (le nommage standard du rapport : C1 · C2 · C3 ·
   O21 · O31 pour le squelette, C21… / C31… pour les deux chaînes, le phosphate et la
   choline pour la tête) est donc RÉELLEMENT parsé, et sa sélection est relue par la
   même fonction que la page (`atomIndicesForSele`) : ce que General garde, plus ce que
   les rangées déviées prennent, c'est la molécule ENTIÈRE. */
const pdbAtomLine = (record, serial, name, resName, chain, resSeq, x, y, z, element) => (
  `${record.padEnd(6)}${String(serial).padStart(5)} ${name.length >= 4 ? name : ` ${name.padEnd(3)}`}`
  + ` ${resName.padEnd(4)}${chain}${String(resSeq).padStart(4)}    `
  + `${x.toFixed(3).padStart(8)}${y.toFixed(3).padStart(8)}${z.toFixed(3).padStart(8)}`
  + `  1.00  0.00          ${element.padStart(2)}`
);
const conectLines = (serial, partners) => {
  const out = [];
  for (let i = 0; i < partners.length; i += 4) {
    out.push(`CONECT${String(serial).padStart(5)}${partners.slice(i, i + 4).map((p) => String(p).padStart(5)).join('')}`);
  }
  return out;
};
const pdbOf = (atomsIn, bonds) => {
  const serialOf = new Map(atomsIn.map((a, i) => [`${a[4]}|${a[0]}`, i + 1]));
  const lines = atomsIn.map(([name, element, res, chain, resno, x, y, z], i) => (
    pdbAtomLine('ATOM', i + 1, name, res, chain, resno, x, y, z, element)
  ));
  const byAtom = new Map();
  bonds.forEach(([a, b]) => {
    const i = serialOf.get(String(a).includes('|') ? String(a) : `1|${a}`);
    const j = serialOf.get(String(b).includes('|') ? String(b) : `1|${b}`);
    assert.ok(i && j, `liaison ${a}–${b} : atome inconnu du jeu d'essai`);
    if (!byAtom.has(i)) byAtom.set(i, []);
    if (!byAtom.has(j)) byAtom.set(j, []);
    byAtom.get(i).push(j);
    byAtom.get(j).push(i);
  });
  [...byAtom.keys()].sort((x, y) => x - y)
    .forEach((i) => lines.push(...conectLines(i, [...byAtom.get(i)].sort((x, y) => x - y))));
  lines.push('END');
  return lines.join('\n');
};
// NGL lit un Blob à travers FileReader : le navigateur l'a, node non.
globalThis.FileReader = class {
  readAsText(blob) {
    Promise.resolve(blob.text()).then((t) => {
      this.result = t;
      if (typeof this.onload === 'function') this.onload({ target: this });
    });
  }
};
const loadPdb = (pdb, params = {}) => NGL.autoLoad(new Blob([pdb], { type: 'text/plain' }), { ext: 'pdb', ...params });

const LIPID_ATOMS = [];
const lipidAtom = (name, element) => LIPID_ATOMS.push([name, element, 'POPC', 'A', 1, 3.0 * LIPID_ATOMS.length, 0, 0]);
[['C1', 'C'], ['C2', 'C'], ['C3', 'C'],                    // le squelette glycérol
  ['O21', 'O'], ['O31', 'O'],                              // ses deux esters
  ['O11', 'O'], ['P', 'P'], ['O13', 'O'], ['O14', 'O'], ['O12', 'O'], ['C11', 'C'], ['C12', 'C'], ['N', 'N'],
  ['C21', 'C'], ['O22', 'O'], ['C22', 'C'],                // la chaîne sn-1
  ['C31', 'C'], ['O32', 'O'], ['C32', 'C'],                // la chaîne sn-2
].forEach(([n, e]) => lipidAtom(n, e));
const LIPID_BONDS = [
  ['C1', 'C2'], ['C2', 'C3'],
  ['C1', 'O21'], ['O21', 'C21'], ['C21', 'O22'], ['C21', 'C22'],
  ['C2', 'O31'], ['O31', 'C31'], ['C31', 'O32'], ['C31', 'C32'],
  ['C3', 'O11'], ['O11', 'P'], ['P', 'O13'], ['P', 'O14'], ['P', 'O12'],
  ['O12', 'C11'], ['C11', 'C12'], ['C12', 'N'],
];
const LIPID = await loadPdb(pdbOf(LIPID_ATOMS, LIPID_BONDS));
eq(LIPID.atomCount, 19, 'le POPC de l’essai est réellement parsé par NGL (19 atomes lourds)');

/* ── LA RÈGLE SUR CETTE MOLÉCULE, RELUE PAR NGL : `[POPC] and not (…)` ──────── */
const REAL = new Function('NGL', [
  'const window = { NGL };',
  sliceDecl(VIEW, 'LIPID_RESNAMES'),
  sliceFn(VIEW, 'isLipidResname'),
  sliceDecl(VIEW, 'LIPID_GLYCEROL_NAMES'),
  sliceDecl(VIEW, 'LIPID_ACYL_RE'),
  sliceDecl(VIEW, 'LIPID_POLAR_ELEMENTS'),
  sliceDecl(VIEW, 'LIPID_NAMED_PROBE'),
  sliceDecl(VIEW, 'LIPID_CHAIN_PROBE_RE'),
  sliceDecl(VIEW, 'LIPID_COVALENT_RADII'),
  sliceFn(VIEW, 'lipidBondCutoff'),
  sliceFn(VIEW, 'atomElement'),
  sliceFn(VIEW, 'atomIndicesForSele'),
  sliceFn(VIEW, 'lipidGroupOf'),
  sliceDecl(VIEW, 'lipidPartIndexStore'),
  sliceDecl(VIEW, 'lipidSubCache'),
  sliceFn(VIEW, 'lipidSubSelections'),
  sliceDecl(VIEW, 'moleculeIndexCache'),
  sliceFn(VIEW, 'moleculeIndicesOf'),
  sliceDecl(VIEW, 'indexSele'),
  sliceFn(VIEW, 'bridgeAtomIndices'),
  sliceFn(VIEW, 'anchoredPartSele'),
  sliceFn(VIEW, 'nucleicGroupOf'),
  sliceDecl(VIEW, 'nucleicGroupCache'),
  sliceFn(VIEW, 'nucleicGroupIndicesIn'),
  sliceFn(VIEW, 'nucleotideGroupIndices'),
  sliceObject(VIEW, 'STYLES'),
  sliceObject(VIEW, 'COLORS'),
  sliceObject(VIEW, 'SECTION_SUBSECTIONS'),
  sliceDecl(VIEW, 'subsectionsOf'),
  sliceDecl(VIEW, 'subsectionSpec'),
  sliceDecl(VIEW, 'ATOM_DRAW_STYLES'),
  sliceFn(VIEW, 'sectionRowSele'),
  sliceDecl(VIEW, 'SPLINE_STYLES'),
  sliceDecl(VIEW, 'SPLINE_TRAIT_OWNERS'),
  sliceFn(VIEW, 'partAtomsHeldBack'),
  sliceFn(VIEW, 'generalCession'),
  'return { atomIndicesForSele, generalCession, partAtomsHeldBack, sectionRowSele };',
].join('\n'))(NGL);

const LIPID_SECTION = { id: 'main::lipid|POPC', key: 'lipid|POPC', kind: 'lipid', name: 'POPC', sele: '[POPC]', count: 1 };
const lipidIdx = (name) => REAL.atomIndicesForSele(LIPID, `[POPC] and .${name}`)[0];
const everything = new Set(REAL.atomIndicesForSele(LIPID, '[POPC]'));
const tailSele = REAL.sectionRowSele(LIPID, LIPID_SECTION, 'tail', { anchorParts: true });
const tailAtoms = new Set(REAL.atomIndicesForSele(LIPID, tailSele));
const lipidCession = REAL.generalCession(LIPID, LIPID_SECTION, {
  general: LOOK('ball+stick', false), head: LOOK('ball+stick', true),
  tail: LOOK('licorice', false), glycerol: LOOK('ball+stick', true),
}, { anchorSideChains: false });
const generalSele = `[POPC] and not (${lipidCession.cede})`;
const generalAtoms = new Set(REAL.atomIndicesForSele(LIPID, generalSele));

ok(generalAtoms.size > 0 && generalSele.includes(' and not '),
  'la sélection écrite pour General est lue par le VRAI NGL — et il lui reste des atomes');
ok(tailAtoms.has(lipidIdx('C21')) && !generalAtoms.has(lipidIdx('C21')),
  'les carbones acyles quittent General : c’est la rangée des chaînes qui les dessine');
ok(generalAtoms.has(lipidIdx('O21')) && tailAtoms.has(lipidIdx('O21')),
  '…et l’ESTER du glycérol reste des DEUX côtés : la liaison C1–O21 est dessinée par General comme par les chaînes');
ok(generalAtoms.has(lipidIdx('C1')) && generalAtoms.has(lipidIdx('C2')) && generalAtoms.has(lipidIdx('C3')),
  'le squelette du lipide reste à General (les rangées qui le suivent le dessinent aussi)');
ok(generalAtoms.has(lipidIdx('P')) && generalAtoms.has(lipidIdx('N')),
  '…et la tête polaire aussi : la molécule n’est jamais amputée par une seule rangée déviée');
const others = new Set([...tailAtoms]);
['head', 'glycerol'].forEach((sub) => {
  REAL.atomIndicesForSele(LIPID, REAL.sectionRowSele(LIPID, LIPID_SECTION, sub, { anchorParts: true }))
    .forEach((i) => others.add(i));
});
eq([...new Set([...generalAtoms, ...others])].sort((a, b) => a - b).length, everything.size,
  'UNION : la rangée General et les trois parts du lipide couvrent la molécule ENTIÈRE (aucun atome perdu)');

/* ── LE CÂBLAGE DU RENDU, ET L'ANCIENNE CESSION TOUJOURS INTERDITE ──────────── */
has('const cession = generalCession(structure, sec, subLooks, { anchorSideChains });',
  'le rendu calcule la cession une seule fois par section, avec les drapeaux de ses rangées');
has("        ? `${sec.sele || 'all'} and not (${cession.cede})`",
  '…et c’est LA clause soustractive du fichier : celle de la rangée General (les sélections des parts ne bougent pas)');
has("if (spec.sub === 'general' && (cession.walkLost || cession.empty)) return;",
  '…et sa rangée n’est pas construite du tout quand il ne lui reste rien, ou que son parcours est pris');
has("      const drawn = spec.sub === 'general' && cession.cede",
  '…c’est la sélection « drawn » qui part à NGL, celle du lipide comme celle de la protéine');
has('warnIfEmptySelection(structure, drawn, `« ${spec.label} » of ${sec.name}`);',
  '…et c’est ELLE que le diagnostic des sélections vides regarde');
has("const SPLINE_TRAIT_OWNERS = { protein: ['backbone'], nucleic: ['backbone', 'ribose'] };",
  '…avec la table des rangées qui parcourent le même chemin que General');
gone('const giveAway =', 'l’ANCIENNE cession ne peut pas revenir : elle rendait à chaque partie les atomes de General…');
gone('const relinquished =', '…ni la liste des parties qui les prenaient…');
gone('const generalKeeps =', '…ni « les atomes que le style de General parcourt » à protéger…');
gone('const backboneLosesCa = anchorSideChains', '…ni les CA retirés au squelette (« part of the backbone vanishes »)');
gone('const generalWalkingSele =', '…ni la fonction qui protégeait le chemin de General');

console.log(`_viewer_general_cession_test.mjs — ${passed} assertions OK (la cession, règle par règle)`);

