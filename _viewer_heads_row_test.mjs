/* =========================================================================
   _viewer_heads_row_test.mjs — « HEADS (P · N · O) » : LA SOUS-CATÉGORIE DEMANDÉE.

   Le rapport de cette session, mot pour mot : « Nel viewer per i lipidi devi generare
   un'altra sottocategoria … che si chiama “heads” e che contiene solo il fosforo, l'azoto
   ed l'ossigeno degli headgroups. Il loro colore sarà definito nella setting wheel ed il
   loro stile sarà semplicemente sphere ma dovrò poter regolare la dimensione ed il
   materiale delle spheres. »

   …ET LA DÉFINITION DE « heads » A ÉTÉ REVUE DEPUIS, mot pour mot : « tra gli atomi che
   definiscono gli head groups deve contenere solo il fosforo (che deve essere del colore
   definito per il fosforo nel setting wheel), gli atomi di azoto e gli ossigeni ad
   eccezione degli ossigeni legati al fosforo. Non deve contenere carboni come invece
   adesso contiene. » Un POPC n'a donc que DEUX heads — son phosphore et son azote —, ses
   quatre oxygènes de phosphate restant à la tête entière, et la rangée ne prend AUCUN
   carbone (ni le C3 du glycérol, ni ceux de la choline).

   Ce que cette suite mesure :

     §1 LA RANGÉE EXISTE, et elle est décrite comme les autres : une entrée `heads` du
        menu Lipids, la sphère POUR SEUL STYLE (`STYLES.heads`), la taille (R◯) et le
        matériau venant des contrôles que TOUTE rangée porte déjà ;
     §2 SES ATOMES SONT LE PHOSPHORE, L'AZOTE ET LES OXYGÈNES QUI NE PENDENT PAS D'UN
        PHOSPHORE — exécuté sur un vrai POPC parsé par le vrai NGL : les quatre oxygènes
        du phosphate en SORTENT (leurs liaisons au P sont lues dans le graphe), ni les
        carbones de la choline, ni le soufre d'un sulfolipide, ni les oxygènes du
        squelette ou des chaînes n'y entrent ;
     §3 LA RANGÉE DESSINE CES ATOMES, et rien d'autre : elle n'est JAMAIS ancrée (le pont
        d'une rangée lui ajoutait le C3 du glycérol et les carbones de la choline — des
        CARBONES), d'autant qu'une sphère ne dessine aucun bâton à rattacher ;
     §4 LA COULEUR VIENT DE LA ROUE ⚙ : la rangée se peint par « Atom type » — la table
        « Atom types (element colours) » de la roue, où le PHOSPHORE a son propre galet —
        et la roue DIT, en clair, que le galet du P est la couleur des sphères de
        phosphore des heads.

   VIEWER_SRC rejoue la suite sur une version d'avant : elle doit alors ÊTRE ROUGE.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const NGL = require('ngl');

let passed = 0;
const ok = (c, what) => { assert.ok(c, what); passed += 1; };
const eq = (a, b, what) => {
  assert.deepEqual(a, b, `${what}\n  attendu : ${JSON.stringify(b)}\n  ottenu   : ${JSON.stringify(a)}`);
  passed += 1;
};

const SRC = process.env.VIEWER_SRC || new URL('./src/components/NMRMoleculeViewer.jsx', import.meta.url);
const VIEW = readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');
const has = (needle, what) => ok(VIEW.includes(needle), `${what}\n  introuvable : ${needle}`);
const gone = (needle, what) => ok(!VIEW.includes(needle), `${what}\n  encore présent : ${needle}`);

/* ── L'extraction : les déclarations du viewer, tranchées sur un MASQUE où les
   commentaires sont remplacés par des espaces (leur prose est pleine de parenthèses). */
const MASK = VIEW
  .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
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


/* ── Le banc : la marche des lipides + la sélection d'une rangée, EXÉCUTÉES sur un vrai
   NGL (chaque structure est réellement parsée, et les liaisons sont déclarées CONECT). */
const H = new Function('NGL', [
  'const window = { NGL };',
  sliceDecl(VIEW, 'LIPID_RESNAMES'),
  sliceFn(VIEW, 'isLipidResname'),
  sliceDecl(VIEW, 'LIPID_GLYCEROL_NAMES'),
  sliceDecl(VIEW, 'LIPID_ACYL_RE'),
  sliceDecl(VIEW, 'LIPID_POLAR_ELEMENTS'),
  sliceDecl(VIEW, 'LIPID_NAMED_PROBE'),
  sliceDecl(VIEW, 'LIPID_CHAIN_PROBE_RE'),
  sliceDecl(VIEW, 'LIPID_ESTER_PROBE_RE'),
  sliceFn(VIEW, 'lipidNamingKnown'),
  sliceDecl(VIEW, 'LIPID_COVALENT_RADII'),
  sliceFn(VIEW, 'lipidBondCutoff'),
  sliceFn(VIEW, 'atomElement'),
  sliceFn(VIEW, 'atomIndicesForSele'),
  sliceFn(VIEW, 'lipidGroupOf'),
  sliceDecl(VIEW, 'lipidPartIndexStore'),
  sliceDecl(VIEW, 'lipidSubCache'),
  // Les OXYGÈNES DU PHOSPHATE, lus dans le graphe de liaisons (la révision de la
  // définition de « heads » : ils n'en font plus partie).
  sliceFn(VIEW, 'phosphateOxygenIndices'),
  sliceFn(VIEW, 'lipidSubSelections'),
  sliceDecl(VIEW, 'moleculeIndexCache'),
  sliceFn(VIEW, 'moleculeIndicesOf'),
  sliceDecl(VIEW, 'indexSele'),
  sliceFn(VIEW, 'bridgeAtomIndices'),
  sliceFn(VIEW, 'anchoredPartSele'),
  sliceFn(VIEW, 'sectionRowSele'),
  'return { sectionRowSele, lipidSubSelections, phosphateOxygenIndices, atomIndicesForSele, bridgeAtomIndices };',
].join('\n'))(NGL);

/* ── Le fichier d'essai : un POPC au nommage du rapport (C1 · C2 · C3 · O21 · O31 pour le
   squelette, C21… / O22 et C31… / O32 pour les chaînes, le phosphate et la choline pour la
   tête), PLUS un soufre d'allure sulfolipide : les trois éléments demandés sont P · N · O,
   donc le soufre doit rester à la TÊTE ENTIÈRE et ne jamais devenir une « head ». ──── */
const pdbAtomLine = (serial, name, element, x, y, z) => (
  `ATOM  ${String(serial).padStart(5)} ${name.length >= 4 ? name : ` ${name.padEnd(3)}`}`
  + ` POPC${'A'}${String(1).padStart(4)}    `
  + `${x.toFixed(3).padStart(8)}${y.toFixed(3).padStart(8)}${z.toFixed(3).padStart(8)}`
  + `  1.00  0.00          ${element.padStart(2)}`
);
const pdbOf = (atoms, bonds) => {
  const serialOf = new Map(atoms.map(([n], i) => [n, i + 1]));
  const lines = atoms.map(([n, e], i) => pdbAtomLine(i + 1, n, e, 3.0 * i, 0, 0));
  const byAtom = new Map();
  bonds.forEach(([a, b]) => {
    const i = serialOf.get(a); const j = serialOf.get(b);
    assert.ok(i && j, `liaison ${a}–${b} : atome inconnu du jeu d'essai`);
    if (!byAtom.has(i)) byAtom.set(i, []);
    if (!byAtom.has(j)) byAtom.set(j, []);
    byAtom.get(i).push(j); byAtom.get(j).push(i);
  });
  [...byAtom.keys()].sort((x, y) => x - y).forEach((i) => {
    const partners = [...byAtom.get(i)].sort((x, y) => x - y);
    for (let k = 0; k < partners.length; k += 4) {
      lines.push(`CONECT${String(i).padStart(5)}${partners.slice(k, k + 4).map((p) => String(p).padStart(5)).join('')}`);
    }
  });
  lines.push('END');
  return lines.join('\n');
};
const HEAD_ATOMS = [['O11', 'O'], ['P', 'P'], ['O13', 'O'], ['O14', 'O'], ['O12', 'O'],
  ['C11', 'C'], ['C12', 'C'], ['N', 'N'], ['S1', 'S']];
const BODY_ATOMS = [['C1', 'C'], ['C2', 'C'], ['C3', 'C'], ['O21', 'O'], ['O31', 'O'],
  ['C21', 'C'], ['O22', 'O'], ['C22', 'C'], ['C31', 'C'], ['O32', 'O'], ['C32', 'C']];
const ATOMS = [...HEAD_ATOMS, ...BODY_ATOMS];
const BONDS = [['C1', 'C2'], ['C2', 'C3'],
  ['C1', 'O21'], ['O21', 'C21'], ['C21', 'O22'], ['C21', 'C22'],
  ['C2', 'O31'], ['O31', 'C31'], ['C31', 'O32'], ['C31', 'C32'],
  ['C3', 'O11'], ['O11', 'P'], ['P', 'O13'], ['P', 'O14'], ['P', 'O12'],
  ['O12', 'C11'], ['C11', 'C12'], ['C12', 'N'], ['C12', 'S1']];
const PDB = pdbOf(ATOMS, BONDS);
// NGL lit un Blob à travers FileReader : le navigateur l'a, node non.
globalThis.FileReader = class {
  readAsText(blob) {
    Promise.resolve(blob.text()).then((t) => {
      this.result = t;
      if (typeof this.onload === 'function') this.onload({ target: this });
    });
  }
};
const STRUCT = await NGL.autoLoad(new Blob([PDB], { type: 'text/plain' }), { ext: 'pdb' });
const idxIn = (structure, name) => {
  const hits = H.atomIndicesForSele(structure, `[POPC] and .${name}`);
  assert.equal(hits.length, 1, `l'atome ${name} du POPC : trouvé ${hits.length} fois (attendu 1)`);
  return hits[0];
};
const idx = (name) => idxIn(STRUCT, name);
const list = (sele) => String(sele || '').replace(/^@/, '').split(',')
  .map((s) => s.trim()).filter(Boolean).map(Number).sort((a, b) => a - b);


/* ══ 1. LA RANGÉE EXISTE, ET ELLE EST DÉCRITE COMME LES AUTRES ══════════════════
   « un'altra sottocategoria … che si chiama “heads” » : une entrée du menu Lipids, à
   côté de la tête entière, des chaînes et du glycérol. */
has("{ sub: 'heads', label: 'Heads (P · N · O)', styles: STYLES.heads, colors: COLORS.lipidParts, def: { style: 'sphere', colorBy: 'element' }, sele: 'heads' },",
  'la rangée « Heads (P · N · O) » est décrite, avec la sélection `heads`');
has("  heads: ['hide', 'sphere'],",
  '« il loro stile sarà semplicemente sphere » : la SPHÈRE est le seul style de dessin offert (plus « Hide », comme partout)');
has("def: { style: 'sphere', colorBy: 'element' }",
  '…et la sphère est son style PAR DÉFAUT, peinte par « Atom type » : le PHOSPHORE suit SA couleur (voir §4)');
has("const ATOM_DRAW_STYLES = ['ball+stick', 'licorice', 'line', 'spacefill', 'sphere'];",
  'la liste des styles qui dessinent atome par atome n’a pas bougé (les autres rangées gardent leur pont)');
has("if (sub === 'heads') return anchoredPartSele(structure, parts.headsAtoms, within, false);",
  'la sélection de la rangée est le jeu « heads » de la marche des lipides — et `false` : cette rangée-là n’est JAMAIS ancrée (aucun carbone, voir §3)');
// La taille (R◯) et le matériau viennent des contrôles que TOUTE rangée porte déjà.
has("const SECTION_LOOK_FIELDS = ['style', 'colorBy', 'solidColor', 'opacity', 'sphere', 'bond', 'material', 'roughness', 'metalness'];",
  'taille (sphere) et matériau (material · roughness · metalness) sont des champs de TOUTE rangée');
has('const SECTION_TINT_STEPS = [0.45, 0.62, 0.74, 0.84, 0.9];',
  'la gamme des fonds de la fenêtre compte CINQ marches : un lipide a cinq rangées');
has('• lipid          → general · phospholipid headgroups · heads (P · N · O) · acyl chains · glycerol',
  '…et la documentation des rangées nomme la nouvelle');

/* ══ 2. SES ATOMES : LE PHOSPHORE, L'AZOTE ET LES OXYGÈNES QUI NE PENDENT PAS DU
   PHOSPHORE — mesuré sur un vrai POPC ══════════════════════════════════════════ */
const parts = H.lipidSubSelections(STRUCT, '[POPC]');
ok(parts.named, 'le nommage du POPC d’essai est reconnu (CHARMM), donc les trois parts sont classées par NOM');
eq(list(parts.heads), ['P', 'N'].map(idx),
  'heads = le PHOSPHORE et l’AZOTE : les quatre oxygènes du phosphate, qui pendent tous du P dans ce fichier, sont SORTIS de la sous-catégorie');
['O11', 'O12', 'O13', 'O14'].forEach((n) => ok(!list(parts.heads).includes(idx(n)),
  `…${n} pend du phosphore : il reste à la tête ENTIÈRE, jamais dans les heads`));
ok(!list(parts.heads).includes(idx('C11')) && !list(parts.heads).includes(idx('C12')),
  '…et AUCUN CARBONE : ni ceux de la choline (le rapport : « non deve contenere carboni »)');
ok(!list(parts.heads).includes(idx('S1')),
  '…ni le soufre d’un sulfolipide : la demande dit P · N · O, et rien d’autre');
ok(!list(parts.heads).includes(idx('O21')) && !list(parts.heads).includes(idx('O31')),
  '…ni les oxygènes du GLYCÉROL (O21 · O31)');
ok(!list(parts.heads).includes(idx('O22')) && !list(parts.heads).includes(idx('O32')),
  '…ni les carbonyles des CHAÎNES (O22 · O32)');
ok(list(parts.heads).every((i) => parts.headAtoms.has(i)),
  'heads ⊂ head : la sous-catégorie ne peut pas inventer un atome hors de la tête');
eq(list(parts.heads).length, 2, 'deux atomes dans cette tête-là : le P et le N — et rien de plus');
ok(parts.headAtoms.has(idx('O11')) && parts.headAtoms.has(idx('C11'))
   && parts.headAtoms.has(idx('S1')) && parts.headAtoms.has(idx('C12')),
  '…et la TÊTE entière garde tout son monde (la rangée « Phospholipid headgroups » ne bouge pas)');
eq(list(H.sectionRowSele(STRUCT, { kind: 'lipid', sele: '[POPC]' }, 'head')).length, 9,
  'les neuf atomes de la tête entière : O11 · P · O13 · O14 · O12 · C11 · C12 · N · S1');

/* …ET LA RÈGLE NE RETIRE RIEN SUR UN DOUTE : le MÊME POPC sans un seul record CONECT ne
   PROUVE aucune liaison — aucun oxygène n'est alors écarté, la tête polaire garde ses six
   atomes. Le fichier qui ne dit rien garde la règle d'avant. */
const BARE = await NGL.autoLoad(new Blob([pdbOf(ATOMS, [])], { type: 'text/plain' }), { ext: 'pdb' });
const bareParts = H.lipidSubSelections(BARE, '[POPC]');
eq(list(bareParts.heads), ['O11', 'P', 'O13', 'O14', 'O12', 'N'].map((n) => idxIn(BARE, n)),
  'sans graphe de liaisons, les quatre oxygènes restent des heads (aucun atome retiré sur un doute)');
ok(H.phosphateOxygenIndices(BARE, list(bareParts.heads)).size === 0,
  '…et la sonde des oxygènes du phosphate est VIDE : rien n’a été prouvé');

/* ══ 3. LA RANGÉE DESSINE CES ATOMES, ET EUX SEULS — AUCUN CARBONE ══════════════
   `parts.heads` (ce que la sous-catégorie EST) ne contient que le P, le N et les
   oxygènes « libres » de la tête. La SÉLECTION d'une rangée qui dessine des atomes est
   ancrée comme celle de toutes les autres (voir sectionRowSele · anchoredPartSele) :
   elle prend les atomes voisins auxquels ses atomes pendent. Ici, c'étaient donc le C3
   du glycérol et les deux carbones de la choline — des CARBONES dans une rangée qui n'en
   veut plus (« non deve contenere carboni come invece adesso contiene »). Cette rangée
   est donc la SEULE à refuser le pont : elle est EXACTEMENT `parts.heads`, et une sphère
   ne dessine aucun bâton à rattacher (son style est la sphère, `STYLES.heads`). */
const lipidSec = { kind: 'lipid', sele: '[POPC]' };
eq(H.sectionRowSele(STRUCT, lipidSec, 'heads'), parts.heads,
  'la rangée est EXACTEMENT la part, octet pour octet (comme les autres)');
const anchored = list(H.sectionRowSele(STRUCT, lipidSec, 'heads', { anchorParts: true }));
eq(anchored, ['P', 'N'].map(idx).sort((a, b) => a - b),
  'même quand le rendu DEMANDE le pont (la sphère dessine des atomes), elle ne prend pas un atome de plus');
ok(!anchored.includes(idx('C3')) && !anchored.includes(idx('C11')) && !anchored.includes(idx('C12')),
  '…et surtout AUCUN CARBONE : ni le C3 du glycérol, ni les carbones de la choline');
eq(list(H.sectionRowSele(STRUCT, lipidSec, 'tail')).length, 6,
  'la rangée des chaînes acyles, elle, ne bouge pas d’un atome (aucune régression)');
eq(list(H.sectionRowSele(STRUCT, lipidSec, 'tail', { anchorParts: true })).length, 8,
  '…et son pont est intact (les deux oxygènes d’ester O21 · O31 que le rendu lui ajoute)');
eq(list(H.sectionRowSele(STRUCT, lipidSec, 'head')).length, 9,
  '…et la rangée de la tête entière garde ses neuf atomes (la sous-catégorie heads ne lui prend rien)');
eq(list(H.sectionRowSele(STRUCT, lipidSec, 'head', { anchorParts: true })).length, 10,
  '…plus son propre raccord (le C3 du glycérol) quand elle dessine des atomes');

/* ══ 4. LA COULEUR VIENT DE LA ROUE ⚙ — ET LE PHOSPHORE A LA SIENNE ═════════════
   « Il loro colore sarà definito nella setting wheel », puis, cette session : « il
   fosforo deve essere del colore definito per il fosforo nel setting wheel ». La rangée
   se peint donc par « Atom type » — SON DÉFAUT —, c'est-à-dire la table « Atom types
   (element colours) » de la roue, où le PHOSPHORE a son propre galet ; « Solid » et
   « Lipid type » (la pastille H d'une classe) restent offerts pour qui les veut. */
has("{ sub: 'heads', label: 'Heads (P · N · O)', styles: STYLES.heads, colors: COLORS.lipidParts,",
  'la rangée lit les MÊMES modes de coloration que les trois parts (Solid · Atom type · Lipid type)');
has('H: 0xe6e6e6, C: 0x9aa3ad, N: 0x2f61d9, O: 0xe23a3a, S: 0xd8c020, P: 0xe08a20,',
  'la roue ⚙ définit une couleur PAR ÉLÉMENT — le phosphore (P) comme les autres');
has('Atom types (element colours)', '…dans une section qui porte son nom');
has('The <b>P</b> swatch is, in particular, the colour of the <b>phosphorus</b> spheres of the « Heads (P · N · O) » row of the Lipids menu',
  '…et la roue DIT, en clair, que le galet du P est la couleur des sphères de phosphore des heads');
has('The « Heads (P · N · O) » row of the Lipids menu does NOT follow it: it is read by <b>Atom type</b>',
  '…tandis que la pastille H est rendue à la seule rangée « Phospholipid headgroups » (la règle a changé, la roue le dit)');
has('headgroup — the whole « Phospholipid headgroups » row of the Lipids menu',
  '…jusque dans l’infobulle de la pastille H');
gone('also the colour of the « Heads (P · N · O) » row',
  'aucun texte de la roue ne dit plus que la pastille H est celle des heads');
gone("const HEAD_ELEMENTS = new Set(['N', 'P', 'O', 'S'])",
  'le soufre n’est PAS un élément de tête (la demande dit P · N · O)');

console.log(`_viewer_heads_row_test.mjs — ${passed} assertions OK`);
