/* =========================================================================
   _viewer_row_bridges_test.mjs — LE PONT QUI RATTACHE CHAQUE PART À SA VOISINE.

   Le rapport, mot pour mot :

     · « side chains in ball and sticks or licorice should also display the bond to
       the backbone » ;
     · « in the same way nucleic acid ribose or desoxyribose must show their bond to
       the bases and to the backbone » ;
     · « in lipids acyl chains must show the bond to the glycerol and glycerol must
       show the bond to phosphate » ;
     · « in sugar each sugar must show the bond to the connected sugars ».

   NGL ne dessine un bâton que si les DEUX atomes de la liaison sont dans la
   sélection de la MÊME représentation, et une sous-sélection de section s'arrête au
   bord de sa part chimique : le CA du squelette restait dans la rangée du squelette,
   le C1' du sucre dans celle du pentose, le O21 · O31 du glycérol dans celle du
   glycérol, le P du phosphate dans celle de la tête. Chaque part FLOTTAIT donc à
   côté de celle à laquelle elle est liée.

   Ce que cette suite vérifie, sur un VRAI NGL (chaque structure est réellement
   parsée, et les liaisons inter-parts sont déclarées par CONECT) :

     §1 la règle du pont (bridgeAtomIndices · anchoredPartSele), pure ;
     §2 les LIPIDES : la chaîne acyle prend son ester de glycérol, le glycérol ses
        carbones acyles ET l'oxygène qui porte le phosphate, la tête le C3 ;
     §3 les ACIDES NUCLÉIQUES : la base prend le C1' de son pentose, le pentose le
        N1 · N9 de sa base et les DEUX phosphates (celui du 5', celui du 3') ;
     §4 les SUCRES : la liaison glycosidique est dans le graphe de liaisons AVANT
        que la moindre représentation existe, et la rangée d'un glycane porte les
        DEUX résidus — donc le bâton entre deux sucres est dessiné ;
     §5 le GARDE-FOU : le pont est DEMANDÉ (ATOM_DRAW_STYLES) et sans lui la
        sélection est EXACTEMENT celle d'avant.

   VIEWER_SRC rejoue la suite sur une version d'avant le correctif : elle doit
   alors ÊTRE ROUGE.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// Le VRAI NGL de la page (le `require` est résolu depuis CE fichier, donc depuis
// node_modules du dépôt).
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

/* ── Extraction : le comptage de profondeur lit un MASQUE où les commentaires sont
   remplacés par des espaces de même longueur — la prose de ce fichier est pleine de
   parenthèses et d'accolades, et sans le masque une déclaration serait tranchée au
   milieu de sa documentation. ──────────────────────────────────────────────────── */
const MASK = VIEW
  .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
  .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
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


/* ══ LE BANC D'ESSAI : la vraie sélection d'une rangée, sur de vraies structures ═
   Sont extraits du viewer les helpers PURS de la classification (PART 2.1 · 2.2 ·
   2.2bis), le catalogue des sections, la sélection de rangée et LE PONT.
   `window` n'existe pas sous Node : `atomIndicesForSele` lit `window.NGL`, donc on
   le pose, comme la page le fait avant de charger une structure. */
const H = new Function('NGL', [
  'const window = { NGL };',
  // Les classificateurs de nature (protéine · acide nucléique · sucre).
  sliceObject(VIEW, 'AA3_TO_1'),
  sliceObject(VIEW, 'NUCLEIC_1_BY_NAME'),
  sliceDecl(VIEW, 'nucAtomKey'),
  sliceDecl(VIEW, 'coordDist'),
  sliceFn(VIEW, 'atomNameSet'),
  sliceDecl(VIEW, 'hasSugarRing'),
  sliceDecl(VIEW, 'hasPhosphateLink'),
  sliceFn(VIEW, 'residueNatureOf'),
  // Les sucres et leurs glycanes (PART 2.2bis) : le regroupement EN UNE molécule et
  // la liaison glycosidique ÉCRITE dans la topologie de la structure.
  sliceObject(VIEW, 'SUGAR_NAME_CODES'),
  sliceDecl(VIEW, 'SUGAR_CODE_NAMES'),
  sliceDecl(VIEW, 'sugarCodeOf'),
  sliceDecl(VIEW, 'SUGAR_RES_SEL'),
  sliceDecl(VIEW, 'SUGAR_IDENTITY_CODES'),
  sliceFn(VIEW, 'isSugarResidueCode'),
  sliceDecl(VIEW, 'SUGAR_KETOSE_CODES'),
  sliceDecl(VIEW, 'SUGAR_ACCEPTOR_RE'),
  sliceDecl(VIEW, 'SUGAR_LINK_CUTOFF'),
  sliceDecl(VIEW, 'sugarShortNameOf'),
  sliceDecl(VIEW, 'sugarAnomericNamesOf'),
  sliceDecl(VIEW, 'sugarElementOf'),
  sliceFn(VIEW, 'sugarLinkEnds'),
  sliceFn(VIEW, 'sugarLinkBondOf'),
  sliceFn(VIEW, 'sugarLinkAtomsOf'),
  sliceFn(VIEW, 'sugarLinksByDistance'),
  sliceFn(VIEW, 'sugarLinksFromBonds'),
  sliceDecl(VIEW, 'linkMonomerPair'),
  sliceDecl(VIEW, 'glycanLabel'),
  sliceFn(VIEW, 'glycanEntities'),
  sliceDecl(VIEW, 'glycanCache'),
  sliceFn(VIEW, 'structureAtomRecords'),
  sliceFn(VIEW, 'sugarMonomersOf'),
  sliceFn(VIEW, 'glycanEntityMapFor'),
  sliceFn(VIEW, 'ensureGlycanBonds'),
  // Les trois parts d'un lipide (PART 2.1).
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
  // Les groupes d'un nucléotide, et LA SÉLECTION D'UNE RANGÉE (le pont compris).
  sliceFn(VIEW, 'nucleicGroupOf'),
  sliceDecl(VIEW, 'nucleicGroupCache'),
  sliceFn(VIEW, 'nucleicGroupIndicesIn'),
  sliceDecl(VIEW, 'moleculeIndexCache'),
  sliceFn(VIEW, 'moleculeIndicesOf'),
  sliceDecl(VIEW, 'indexSele'),
  sliceFn(VIEW, 'nucleotideGroupIndices'),
  sliceFn(VIEW, 'nucleotideGroupSele'),
  sliceFn(VIEW, 'bridgeAtomIndices'),
  sliceFn(VIEW, 'anchoredPartSele'),
  sliceFn(VIEW, 'sectionRowSele'),
  // Le catalogue des sections d'une structure (ce que la barre de style affiche).
  sliceDecl(VIEW, 'LABEL_WATER_NAMES'),
  sliceDecl(VIEW, 'LABEL_ION_ELEMENTS'),
  sliceDecl(VIEW, 'LABEL_ION_RESNAMES'),
  sliceFn(VIEW, 'resnoRangesClause'),
  sliceFn(VIEW, 'resnoListOf'),
  sliceFn(VIEW, 'classifySectionResidue'),
  sliceDecl(VIEW, 'MOL_KINDS'),
  sliceFn(VIEW, 'listMoleculeSections'),
  `return { sectionRowSele, bridgeAtomIndices, anchoredPartSele, nucleotideGroupIndices,
    listMoleculeSections, lipidSubSelections, atomIndicesForSele, ensureGlycanBonds,
    glycanEntityMapFor, nucleicGroupIndicesIn, isLipidResname, isSugarResidueCode, resnoListOf };`,
].join('\n'))(NGL);

/* ── Les fabriques de fichiers : des lignes PDB aux COLONNES du format (NGL lit le
   nom en 13-16, le résidu en 18-21, la chaîne en 22, le numéro en 23-26, x en 31-38
   et l'élément en 77-78), et des records CONECT qui DÉCLARENT chaque liaison. ───── */
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
// `atoms` : [nom, élément, resname, chaîne, numéro, x, y, z] — dans l'ordre des séries.
// `bonds` : des références d'atomes — « nom » (le résidu 1 par défaut) ou
// « numéro|nom » quand un jeu d'essai a le même nom dans deux résidus, comme un vrai
// fichier. Les CONECT sont écrits pour TOUTE liaison et les atomes sont posés à ≥ 2,6 Å
// les uns des autres : NGL ne peut donc rien inférer d'autre, et le graphe de liaisons
// est EXACTEMENT celui que l'essai déclare.
const refKey = (ref) => (String(ref).includes('|') ? String(ref) : `1|${ref}`);
const pdbOf = (atoms, bonds) => {
  const serialOf = new Map(atoms.map((a, i) => [`${a[4]}|${a[0]}`, i + 1]));
  const lines = atoms.map(([name, element, res, chain, resno, x, y, z], i) => (
    pdbAtomLine('ATOM', i + 1, name, res, chain, resno, x, y, z, element)
  ));
  const byAtom = new Map();
  bonds.forEach(([a, b]) => {
    const i = serialOf.get(refKey(a));
    const j = serialOf.get(refKey(b));
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
const loadPdb = (pdb, params = {}) => NGL.autoLoad(new Blob([pdb], { type: 'text/plain' }), { ext: 'pdb', ...params });
// NGL lit un Blob à travers FileReader : le navigateur l'a, node non.
globalThis.FileReader = class {
  readAsText(blob) {
    Promise.resolve(blob.text()).then((t) => {
      this.result = t;
      if (typeof this.onload === 'function') this.onload({ target: this });
    });
  }
};
// Les indices des atomes, TROUVÉS par NGL dans la structure réellement parsée : une
// carte `« résidu|nom » → index`. Les noms sont normalisés sur le prime (`C1*` d'un
// dialecte ancien devient `C1'`) car c'est ce que les noms d'un jeu d'essai écrivent.
const atomMapOf = (structure) => {
  const out = new Map();
  structure.eachAtom((a) => {
    out.set(`${a.resno}|${String(a.atomname || '').replace(/\*/g, "'")}`, a.index);
  });
  return out;
};
const idxIn = (map, resno, name) => {
  const hit = map.get(`${resno}|${name}`);
  assert.ok(Number.isFinite(hit), `l'atome ${name} du résidu ${resno} doit exister (NGL l'a parsé)`);
  return hit;
};
const atomIndices = (structure, sele) => H.atomIndicesForSele(structure, sele);
const bonded = (structure, i, j) => {
  let hit = false;
  structure.getAtomProxy(i).eachBondedAtom((a) => { if (a.index === j) hit = true; });
  return hit;
};
// Une sélection `@i,j,k` comme LISTE D'INDICES (c'est ce que NGL lira) — compare donc
// des NOMBRES, pas des chaînes.
const list = (sele) => String(sele || '').replace(/^@/, '').split(',')
  .map((s) => s.trim()).filter(Boolean).map(Number);

/* ══ 1. LA RÈGLE DU PONT (pure : aucun NGL, aucun fichier) ══════════════════════
   La règle tient en deux phrases : le pont d'une part est l'ensemble des VOISINS
   COVALENTS de ses atomes qui sont HORS de la part mais DANS la molécule de la
   section ; et une rangée qui ne dessine pas ses atomes un par un (ruban · plaque ·
   cachée) n'en demande jamais. Le faux graphe ci-dessous le dit atome par atome. */
const fakeBonds = { 0: [1, 9], 1: [0, 2], 2: [1, 3], 3: [2, 8], 4: [5], 5: [4] };
const fakeStructure = {
  // 0 → 1 (dans la part), 1 → 2 (le bout de la liaison : LE PONT), 3 → 8 (un
  // hydrogène, IGNORÉ), 0 → 9 (un atome qui n'est PAS dans la molécule de la
  // section : jamais pris), 4 → 5 (une autre molécule, entièrement à part).
  eachAtom(cb) {
    Object.keys(fakeBonds).forEach((k) => cb({
      index: Number(k),
      eachBondedAtom(next) { fakeBonds[k].forEach((j) => next({ index: j, element: j === 8 ? 'H' : 'C' })); },
    }));
  },
};
eq(H.bridgeAtomIndices(fakeStructure, new Set([0, 1]), new Set([0, 1, 2, 3, 8])), [2],
  'le pont est le voisin covalent HORS de la part (2) — et lui seul');
eq(H.bridgeAtomIndices(fakeStructure, new Set([2, 3]), new Set([0, 1, 2, 3, 8])), [1],
  '…lu des DEUX côtés : la part du pont est celle qui reçoit l’atome voisin');
eq(H.bridgeAtomIndices(fakeStructure, new Set([0, 1]), new Set([0, 1, 2, 3])), [2],
  'un voisin HORS de la molécule de la section n’est jamais ajouté (9 absent de `within` → absent du pont)');
const hOnly = {
  // La part 0 n'a qu'une sortie hors d'elle-même : un HYDROGÈNE.
  eachAtom(cb) {
    cb({ index: 0, eachBondedAtom(next) { next({ index: 1, element: 'H' }); } });
  },
};
eq(H.bridgeAtomIndices(hOnly, new Set([0]), new Set([0, 1])), [],
  'un HYDROGÈNE ne relie jamais deux parts : il n’est pas un pont (il est dessiné avec son atome lourd)');
eq(H.bridgeAtomIndices(fakeStructure, new Set([3]), new Set([2, 3, 8])), [2],
  '…alors que le CARBONE voisin, lui, pont (2, et 8 l’hydrogène est ignoré)');
eq(H.bridgeAtomIndices(fakeStructure, new Set([4, 5]), new Set([0, 1, 2, 3])), [],
  'une part entièrement hors de la molécule ne pont pas vers elle');
eq(H.bridgeAtomIndices(null, new Set([0]), new Set([0])), [],
  'sans structure (ou sans graphe de liaisons) : aucun pont, jamais une exception');
// `anchoredPartSele` : sans le drapeau, la sélection est EXACTEMENT celle d'avant (ce
// qui garde la plaque, le ruban et les rangées cachées tels quels) ; avec, elle est
// l'union TRIÉE de la part et de ses ponts.
eq(H.anchoredPartSele(fakeStructure, [3, 1, 0], new Set([0, 1, 2, 3]), false), '@0,1,3',
  'sans le drapeau : la part seule, triée (la sélection historique, octet pour octet)');
eq(H.anchoredPartSele(fakeStructure, [3, 1, 0], new Set([0, 1, 2, 3]), true), '@0,1,2,3',
  'avec le drapeau : la part ET le pont, dans l’ordre des indices');
eq(H.anchoredPartSele(fakeStructure, [], new Set([0]), true), '',
  'une part vide reste vide (la rangée ne dessine rien)');
eq(H.anchoredPartSele(fakeStructure, [1], null, true), '@1',
  'sans molécule où chercher, la part seule (un fichier sans graphe ne casse rien)');
/* ══ 2. LES LIPIDES : LA CHAÎNE ACYLE → LE GLYCÉROL → LE PHOSPHATE ══════════════
   « in lipids acyl chains must show the bond to the glycerol and glycerol must show
   the bond to phosphate ». Le POPC ci-dessous a la chimie et le nommage du POPC du
   rapport (C1 · C2 · C3 · O21 · O31 pour le squelette, C21… / O22 et C31… / O32 pour
   les deux chaînes, le phosphate et la choline pour la tête), et ses liaisons
   INTER-PARTS sont déclarées : C1–O21–C21 (chaîne sn-1), C2–O31–C31 (sn-2),
   C3–O11–P (le phosphate). */
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
const LIPID_STRUCT = await loadPdb(pdbOf(LIPID_ATOMS, LIPID_BONDS));
const lipidSec = H.listMoleculeSections(LIPID_STRUCT).find((s) => s.kind === 'lipid');
const lipidIdx = (name) => {
  const hits = atomIndices(LIPID_STRUCT, `[POPC] and .${name}`);
  assert.equal(hits.length, 1, `l'atome ${name} du POPC : trouvé ${hits.length} fois (attendu 1)`);
  return hits[0];
};
ok(!!lipidSec, 'le POPC du jeu d’essai est une SECTION « lipid » (pas un ligand)');
eq(lipidSec && lipidSec.sele, '[POPC]', '…et sa sélection est le code du résidu, ce que NGL sait lire');
const lipidParts = H.lipidSubSelections(LIPID_STRUCT, '[POPC]');
ok(lipidParts.named, 'son nommage est reconnu comme le nommage standard des lipides');
eq(list(lipidParts.glycerol), ['C1', 'C2', 'C3', 'O21', 'O31'].map(lipidIdx),
  'les cinq atomes du squelette sont DANS le squelette');
eq(list(lipidParts.acyl), ['C21', 'O22', 'C22', 'C31', 'O32', 'C32'].map(lipidIdx),
  '…les six atomes des deux chaînes dans les chaînes');
eq(list(lipidParts.head), ['O11', 'P', 'O13', 'O14', 'O12', 'C11', 'C12', 'N'].map(lipidIdx),
  '…et le phosphate + la choline dans la tête');
// Sans le drapeau, la rangée est EXACTEMENT la part : c’est la sélection historique,
// et c’est ce qui garde intactes toutes les autres rangées de la barre.
eq(H.sectionRowSele(LIPID_STRUCT, lipidSec, 'tail'), lipidParts.acyl,
  'sans pont, la rangée des chaînes acyles reste la part seule (octet pour octet)');
eq(H.sectionRowSele(LIPID_STRUCT, lipidSec, 'glycerol'), lipidParts.glycerol,
  '…et celle du glycérol aussi');
// ── LA CHAÎNE ACYLE MONTRE SON BÂTON VERS LE GLYCÉROL ─────────────────────────
const lipidTail = list(H.sectionRowSele(LIPID_STRUCT, lipidSec, 'tail', { anchorParts: true }));
ok(lipidTail.includes(lipidIdx('C21')) && lipidTail.includes(lipidIdx('O21')),
  'la chaîne sn-1 prend l’ESTER du glycérol auquel elle pend : C21 ET O21 sont dans la rangée');
ok(lipidTail.includes(lipidIdx('O31')) && lipidTail.includes(lipidIdx('C31')),
  '…et la sn-2 son propre ester (C31 · O31) : les deux chaînes sont rattachées');
ok(bonded(LIPID_STRUCT, lipidIdx('C21'), lipidIdx('O21')) && bonded(LIPID_STRUCT, lipidIdx('C31'), lipidIdx('O31')),
  'preuve : C21–O21 et C31–O31 sont des liaisons du graphe de la structure (le bâton existe donc)');
// ── LE GLYCÉROL MONTRE SES BÂTONS VERS LE PHOSPHATE ET VERS LES CHAÎNES ───────
const lipidGly = list(H.sectionRowSele(LIPID_STRUCT, lipidSec, 'glycerol', { anchorParts: true }));
ok(lipidGly.includes(lipidIdx('O11')),
  'le glycérol prend l’oxygène qui le relie au phosphate (O11) — le bâton C3–O11 est dessiné');
ok(lipidGly.includes(lipidIdx('C21')) && lipidGly.includes(lipidIdx('C31')),
  '…et les deux carbones acyles : les bâtons vers les chaînes aussi');
ok(bonded(LIPID_STRUCT, lipidIdx('C3'), lipidIdx('O11')) && bonded(LIPID_STRUCT, lipidIdx('O11'), lipidIdx('P')),
  'preuve : C3–O11–P — le bâton part du C3 du glycérol et arrive à l’atome du PHOSPHATE');
// ── ET LA TÊTE PEND DU GLYCÉROL (la même règle, vue de l’autre côté) ──────────
const lipidHead = list(H.sectionRowSele(LIPID_STRUCT, lipidSec, 'head', { anchorParts: true }));
ok(lipidHead.includes(lipidIdx('C3')), 'la tête (donc le phosphate) prend le C3 du glycérol dont elle pend');
ok(bonded(LIPID_STRUCT, lipidIdx('O11'), lipidIdx('C3')), 'preuve : O11–C3, la liaison tête → glycérol');
// ── L’AUTRE LIPIDE : un nommage NON standard ne laisse jamais une part flotter ─
// Un fichier qui nomme ses chaînes autrement (le DDM / DPE du rapport) est classé
// par ÉLÉMENT : les chaînes sont alors tous les carbones. Le pont, lui, ne dépend
// d'AUCUN nom — il lit les liaisons — donc la règle vaut aussi là.
const RAW_ATOMS = [['C1', 'C'], ['C2', 'C'], ['O1', 'O'], ['C3', 'C'], ['O2', 'O'], ['P', 'P'], ['O3', 'O'], ['O4', 'O']];
const RAW_BONDS = [['C1', 'C2'], ['C1', 'O1'], ['O1', 'C3'], ['C2', 'O2'], ['O2', 'P'], ['P', 'O3'], ['P', 'O4']];
const rawAtoms = RAW_ATOMS.map(([n, e], i) => [n, e, 'POPC', 'A', 1, 3.0 * i, 6, 0]);
const RAW_STRUCT = await loadPdb(pdbOf(rawAtoms, RAW_BONDS));
const rawIdx = (name) => atomIndices(RAW_STRUCT, `[POPC] and .${name}`)[0];
const rawParts = H.lipidSubSelections(RAW_STRUCT, '[POPC]');
ok(!rawParts.named, 'un nommage hors norme n’est PAS reconnu (les parts tombent sur les ÉLÉMENTS)');
const rawTail = list(H.sectionRowSele(RAW_STRUCT, { sele: '[POPC]', kind: 'lipid' }, 'tail', { anchorParts: true }));
ok(rawTail.includes(rawIdx('O1')) || rawTail.includes(rawIdx('O2')),
  'même là, la « chaîne » prend l’oxygène auquel elle pend (la règle ne lit que les liaisons)');
ok(bonded(RAW_STRUCT, rawIdx('C3'), rawIdx('O1')), 'preuve : la liaison O1–C3 existe dans le graphe');

/* ══ 3. LES ACIDES NUCLÉIQUES : LA RIBOSE → LES BASES ET LE SQUELETTE ═══════════
   « nucleic acid ribose or desoxyribose must show their bond to the bases and to the
   backbone ». Un dinucléotide (deux DA d'adénine) dont les liaisons INTER-RÉSIDUS
   sont déclarées : le O3' du premier est lié au P du second — la liaison
   phosphodiester du squelette. */
const DNA_NAMES = [['P', 'P'], ['OP1', 'O'], ['OP2', 'O'], ['O5\'', 'O'], ['C5\'', 'C'],
  ['C4\'', 'C'], ['O4\'', 'O'], ['C3\'', 'C'], ['O3\'', 'O'], ['C2\'', 'C'], ['C1\'', 'C'],
  ['N9', 'N'], ['C8', 'C'], ['N7', 'N'], ['C5', 'C'], ['C6', 'C'], ['O6', 'O'],
  ['N1', 'N'], ['C2', 'C'], ['N3', 'N'], ['C4', 'C'], ['N6', 'N']];
const DNA_BONDS = [['O5\'', 'C5\''], ['C5\'', 'C4\''], ['C4\'', 'O4\''], ['O4\'', 'C1\''], ['C1\'', 'C2\''],
  ['C2\'', 'C3\''], ['C3\'', 'C4\''], ['C3\'', 'O3\''], ['C1\'', 'N9'], ['N9', 'C8'],
  ['C8', 'N7'], ['N7', 'C5'], ['C5', 'C6'], ['C6', 'N1'], ['N1', 'C2'], ['C2', 'N3'],
  ['N3', 'C4'], ['C4', 'C5'], ['C4', 'N6'], ['C6', 'O6'], ['P', 'O5\''], ['P', 'OP1'], ['P', 'OP2']];
// Les DEUX résidus portent les MÊMES noms (c'est un fichier PDB), donc chaque lecture
// passe par la carte « résidu|nom » construite plus bas sur la structure parsée.
const DNA_ATOMS = [];
[1, 2].forEach((resno) => DNA_NAMES.forEach(([n, e]) => {
  DNA_ATOMS.push([n, e, 'DA', 'A', resno, 4.0 * DNA_ATOMS.length, 0, 0]);
}));
const DNA_PDB = pdbOf(DNA_ATOMS, [
  ...DNA_BONDS.map(([a, b]) => [`1|${a}`, `1|${b}`]),
  ...DNA_BONDS.map(([a, b]) => [`2|${a}`, `2|${b}`]),
  ['1|O3\'', '2|P'],                       // la liaison phosphodiester : O3'(1) → P(2)
]);
const DNA_STRUCT = await loadPdb(DNA_PDB);
const dnaIdx = atomMapOf(DNA_STRUCT);
const dnaSec = H.listMoleculeSections(DNA_STRUCT).find((s) => s.kind === 'nucleic');
ok(!!dnaSec, 'les deux DA sont reconnus comme une section « nucleic » (une chaîne)');
eq(dnaSec && dnaSec.sele, ':A and nucleic', '…et leur sélection est la chaîne');
const dnaGroups = H.nucleicGroupIndicesIn(DNA_STRUCT);
ok(dnaGroups.base.length >= 12 && dnaGroups.pentose.length >= 16 && dnaGroups.phosphate.length >= 6,
  'les trois groupes d’un nucléotide couvrent bien les bases, le pentose et le phosphate');
// ── LA BASE MONTRE SON BÂTON VERS LE PENTOSE ──────────────────────────────────
const basePlain = H.sectionRowSele(DNA_STRUCT, dnaSec, 'bases');
eq(list(basePlain), list(H.nucleotideGroupIndices(DNA_STRUCT, dnaSec, 'base')),
  'sans pont, la rangée des bases est la liste des atomes de base (rien de neuf)');
const baseAnchored = list(H.sectionRowSele(DNA_STRUCT, dnaSec, 'bases', { anchorParts: true }));
[1, 2].forEach((resno) => {
  const c1 = idxIn(dnaIdx, resno, 'C1\'');
  const n9 = idxIn(dnaIdx, resno, 'N9');
  ok(baseAnchored.includes(c1), `la rangée des bases porte le C1' du résidu ${resno} : le bâton base → sucre est dessiné`);
  ok(baseAnchored.includes(n9), `…et bien sûr son N9 (la base elle-même, résidu ${resno})`);
  ok(bonded(DNA_STRUCT, n9, c1), `preuve : N9–C1' est une liaison du graphe (résidu ${resno})`);
});
// ── LE PENTOSE MONTRE SES BÂTONS VERS LA BASE **ET** VERS LE SQUELETTE ────────
const riboseAnchored = list(H.sectionRowSele(DNA_STRUCT, dnaSec, 'ribose', { anchorParts: true }));
const p1 = idxIn(dnaIdx, 1, 'P');
const p2 = idxIn(dnaIdx, 2, 'P');
const o3one = idxIn(dnaIdx, 1, 'O3\'');
[1, 2].forEach((resno) => {
  ok(riboseAnchored.includes(idxIn(dnaIdx, resno, 'N9')),
    `la ribose du résidu ${resno} porte le N9 de sa base : le bâton ribose → base est dessiné`);
});
ok(riboseAnchored.includes(p1) && riboseAnchored.includes(p2),
  '…et les DEUX phosphates : le sien (par le O5\u2032) et celui du résidu suivant (par le O3\u2032)');
ok(riboseAnchored.includes(p2) && bonded(DNA_STRUCT, o3one, p2),
  'le pentose du PREMIER résidu prend AUSSI le P du SECOND : la liaison O3\u2032-P du squelette est dessinée');
eq(list(H.sectionRowSele(DNA_STRUCT, dnaSec, 'ribose')), list(H.nucleotideGroupIndices(DNA_STRUCT, dnaSec, 'pentose')),
  'sans pont, la rangée de la ribose reste la liste des atomes du pentose');
/* ══ 4. LES SUCRES : CHAQUE SUCRE PORTE SON BÂTON VERS LES SUCRES LIÉS ══════════
   « in sugar each sugar must show the bond to the connected sugars ». Le pire cas
   est reproduit ici : le fichier n'a AUCUN record CONECT et NGL n'infère rien
   (`inferBonds: 'none'`), la SEULE chose qui dise que les deux NAG sont liés est la
   géométrie (le C1 anomère du second à 1,42 Å du O4 du premier). Le groupe sait alors
   que c'est UN glycanE — une molécule, une section, une rangée — et ensureGlycanBonds
   ÉCRIT la liaison dans le graphe AVANT la moindre représentation : la rangée porte
   les DEUX résidus, donc le bâton est dessiné DANS une seule sélection. */
const SUGAR_NAMES = [['C1', 'C'], ['C2', 'C'], ['C3', 'C'], ['C4', 'C'], ['C5', 'C'], ['C6', 'C'],
  ['O2', 'O'], ['O3', 'O'], ['O4', 'O'], ['O5', 'O'], ['O6', 'O'], ['N2', 'N']];
// Chaque atome d'un sucre est posé sur son propre x, à 5 Å du suivant (aucun couple
// C…O ne tombe donc dans la fenêtre d'une liaison, sauf celui que l'on veut) ; le C1
// anomère du SECOND sucre est ramené à 1,42 Å du O4 du premier — la longueur EXACTE
// d'une liaison C–O.
const SUGAR_PDB = pdbOf([
  ...SUGAR_NAMES.map(([n, e], k) => [n, e, 'NAG', 'A', 1, 12 + 5.0 * k, 0, 0]),
  // k = 8 → le O4 du premier est à 52 Å ; le C1 du second est donc posé à 53,42 Å.
  ...SUGAR_NAMES.map(([n, e], k) => [n, e, 'NAG', 'A', 2, (n === 'C1' ? 53.42 : 80 + 5.0 * k), 0, 0]),
], []);
const SUGAR_STRUCT = await loadPdb(SUGAR_PDB, { inferBonds: 'none' });
const sugarInfo = H.glycanEntityMapFor(SUGAR_STRUCT);
eq(sugarInfo.entities.length, 1, 'la GÉOMÉTRIE seule groupe déjà les deux NAG en UN glycanE');
ok(sugarInfo.entities[0].linked, '…et l’entité est marquée LIÉE (deux sucres liés, pas deux isolés)');
const sugarSec = H.listMoleculeSections(SUGAR_STRUCT).find((s) => s.kind === 'sugar');
ok(!!sugarSec, 'le glycane est UNE section « sugar » — une molécule, pas deux résidus séparés');
eq(sugarSec && sugarSec.count, 2, '…qui porte ses DEUX sucres');
eq(sugarSec && sugarSec.sele, ':A and 1-2', '…et les sélectionne tous les deux, EN PLAGES (voir resnoListOf)');
eq(H.resnoListOf([601, 602, 603, 700]), '601-603 or 700',
  'les numéros de résidus s’écrivent en PLAGES : NGL ne lit pas une liste séparée par des virgules');
eq(atomIndices(SUGAR_STRUCT, ':A and 1,2').length, 12,
  'preuve du défaut corrigé : `:A and 1,2` (la forme d’avant) ne lit QUE le premier sucre');
eq(H.ensureGlycanBonds(SUGAR_STRUCT), 1, 'ensureGlycanBonds écrit la liaison glycosidique dans la topologie');
const sugarLink = sugarInfo.linkAtoms[0];
ok(Array.isArray(sugarLink) && sugarLink.length === 2, 'la liaison est faite de DEUX atomes (le C anomère, le O accepteur)');
ok(bonded(SUGAR_STRUCT, sugarLink[0], sugarLink[1]),
  'NGL voit les deux atomes BONDÉS : le bâton entre les deux sucres sera dessiné');
const sugarInSection = atomIndices(SUGAR_STRUCT, sugarSec.sele);
eq(sugarInSection.length, 24, 'la sélection de la section résout bien les DEUX sucres : 24 atomes, pas 12');
ok(sugarLink.every((i) => sugarInSection.includes(i)),
  'les DEUX atomes de la liaison sont DANS la sélection de la section : le bâton tient dans UNE seule représentation');
eq(H.sectionRowSele(SUGAR_STRUCT, sugarSec, 'general'), sugarSec.sele,
  'la rangée d’un glycane EST sa sélection entière : aucun sucre n’est retiré de la rangée');
eq(H.sectionRowSele(SUGAR_STRUCT, sugarSec, 'general', { anchorParts: true }), sugarSec.sele,
  '…et le pont n’y change rien (la molécule entière y est déjà)');

/* ══ 5. LE GARDE-FOU : LE PONT EST DEMANDÉ, JAMAIS SUBI ═════════════════════════
   Un ruban · une plaque · une rangée cachée ne dessine pas ses atomes un par un :
   elle n'a donc rien à recoller, et sa sélection ne bouge pas (`anchoredPartSele`
   rend la part seule, vérifié en §1). C'est le RENDU qui décide, dans
   buildSectionReps — et c'est la seule chose que ces cinq assertions regardent. */
has('const anchorParts = ATOM_DRAW_STYLES.includes(look.style);',
  'le rendu ne demande le pont que pour une rangée dessinée en ATOMES');
has(': sectionRowSele(structure, sec, spec.sub, { anchorSideChains, backboneLosesCa, anchorParts });',
  '…et les trois drapeaux de la rangée lui sont passés ensemble');
has('const anchored = !!opts.anchorParts;', 'la sélection de rangée lit le drapeau du pont une seule fois');
has('const backboneLosesCa = anchorSideChains',
  'le squelette ne cède ses CA que s’il est dessiné en ATOMES lui aussi');
has('(opts.backboneLosesCa ? `${base} and backbone and not .CA` : `${base} and backbone`)',
  '…donc un squelette en RUBAN garde les siens : la spline de NGL passe par les CA');
has('(opts.anchorSideChains ? `${base} and (sidechain or .CA)` : `${base} and sidechain`)',
  'les chaînes latérales, elles, prennent le CA dès qu’elles sont dessinées en ATOMES');

console.log(`_viewer_row_bridges_test.mjs — ${passed} assertions OK`);

