/* =========================================================================
   _viewer_heads_row_test.mjs — « HEADS (P · N · O) » : LA SOUS-CATÉGORIE DEMANDÉE.

   Le rapport de cette session, mot pour mot : « Nel viewer per i lipidi devi generare
   un'altra sottocategoria … che si chiama “heads” e che contiene solo il fosforo, l'azoto
   ed l'ossigeno degli headgroups. Il loro colore sarà definito nella setting wheel ed il
   loro stile sarà semplicemente sphere ma dovrò poter regolare la dimensione ed il
   materiale delle spheres. »

   Ce que cette suite mesure :

     §1 LA RANGÉE EXISTE, et elle est décrite comme les autres : une entrée `heads` du
        menu Lipids, la sphère POUR SEUL STYLE (`STYLES.heads`), la taille (R◯) et le
        matériau venant des contrôles que TOUTE rangée porte déjà ;
     §2 SES ATOMES SONT EXACTEMENT P, N ET O D'UNE TÊTE — exécuté sur un vrai POPC
        parsé par le vrai NGL : ni les carbones de la choline, ni le soufre d'un
        sulfolipide, ni les oxygènes du squelette ou des chaînes ;
     §3 LA RANGÉE DESSINE CES ATOMES, et rien d'autre : sans ancre c'est la part seule
        (octet pour octet), avec l'ancre la liaison à sa tête (le C3 du glycérol) est
        dessinée — la rangée est dans la liste des styles qui dessinent atome par atome ;
     §4 LA COULEUR VIENT DE LA ROUE ⚙ : le schéma de type lit la part de l'atome, et la
        rangée offre « Lipid type » (les pastilles de la roue) — la roue DIT, en clair,
        que la pastille H est aussi celle des têtes.

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
  sliceFn(VIEW, 'lipidSubSelections'),
  sliceDecl(VIEW, 'moleculeIndexCache'),
  sliceFn(VIEW, 'moleculeIndicesOf'),
  sliceDecl(VIEW, 'indexSele'),
  sliceFn(VIEW, 'bridgeAtomIndices'),
  sliceFn(VIEW, 'anchoredPartSele'),
  sliceFn(VIEW, 'sectionRowSele'),
  'return { sectionRowSele, lipidSubSelections, atomIndicesForSele, bridgeAtomIndices };',
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
const idx = (name) => {
  const hits = H.atomIndicesForSele(STRUCT, `[POPC] and .${name}`);
  assert.equal(hits.length, 1, `l'atome ${name} du POPC : trouvé ${hits.length} fois (attendu 1)`);
  return hits[0];
};
const list = (sele) => String(sele || '').replace(/^@/, '').split(',')
  .map((s) => s.trim()).filter(Boolean).map(Number).sort((a, b) => a - b);


/* ══ 1. LA RANGÉE EXISTE, ET ELLE EST DÉCRITE COMME LES AUTRES ══════════════════
   « un'altra sottocategoria … che si chiama “heads” » : une entrée du menu Lipids, à
   côté de la tête entière, des chaînes et du glycérol. */
has("{ sub: 'heads', label: 'Heads (P · N · O)', styles: STYLES.heads, colors: COLORS.lipidParts, def: { style: 'sphere', colorBy: 'lipidtype' }, sele: 'heads' },",
  'la rangée « Heads (P · N · O) » est décrite, avec la sélection `heads`');
has("  heads: ['hide', 'sphere'],",
  '« il loro stile sarà semplicemente sphere » : la SPHÈRE est le seul style de dessin offert (plus « Hide », comme partout)');
has("def: { style: 'sphere', colorBy: 'lipidtype' }", '…et la sphère est son style PAR DÉFAUT');
has("const ATOM_DRAW_STYLES = ['ball+stick', 'licorice', 'line', 'spacefill', 'sphere'];",
  'la sphère dessine ATOME PAR ATOME : la rangée est donc ancrée à sa tête (la liaison est dessinée)');
has("if (sub === 'heads') return anchoredPartSele(structure, parts.headsAtoms, within, anchored);",
  'la sélection de la rangée est le jeu « heads » de la marche des lipides');
// La taille (R◯) et le matériau viennent des contrôles que TOUTE rangée porte déjà.
has("const SECTION_LOOK_FIELDS = ['style', 'colorBy', 'solidColor', 'opacity', 'sphere', 'bond', 'material', 'roughness', 'metalness'];",
  'taille (sphere) et matériau (material · roughness · metalness) sont des champs de TOUTE rangée');
has('const SECTION_TINT_STEPS = [0.45, 0.62, 0.74, 0.84, 0.9];',
  'la gamme des fonds de la fenêtre compte CINQ marches : un lipide a cinq rangées');
has('• lipid          → general · phospholipid headgroups · heads (P · N · O) · acyl chains · glycerol',
  '…et la documentation des rangées nomme la nouvelle');

/* ══ 2. SES ATOMES SONT P · N · O D'UNE TÊTE — mesuré sur un vrai POPC ══════════ */
const parts = H.lipidSubSelections(STRUCT, '[POPC]');
ok(parts.named, 'le nommage du POPC d’essai est reconnu (CHARMM), donc les trois parts sont classées par NOM');
eq(list(parts.heads), ['O11', 'P', 'O13', 'O14', 'O12', 'N'].map(idx),
  'heads = EXACTEMENT le phosphore, l’azote et les oxygènes de la tête');
ok(!list(parts.heads).includes(idx('C11')) && !list(parts.heads).includes(idx('C12')),
  '…ni les carbones de la choline (ils sont dans la TÊTE, pas dans les heads)');
ok(!list(parts.heads).includes(idx('S1')),
  '…ni le soufre d’un sulfolipide : la demande dit P · N · O, et rien d’autre');
ok(!list(parts.heads).includes(idx('O21')) && !list(parts.heads).includes(idx('O31')),
  '…ni les oxygènes du GLYCÉROL (O21 · O31), qui pendent pourtant du phosphate');
ok(!list(parts.heads).includes(idx('O22')) && !list(parts.heads).includes(idx('O32')),
  '…ni les carbonyles des CHAÎNES (O22 · O32)');
ok(list(parts.heads).every((i) => parts.headAtoms.has(i)),
  'heads ⊂ head : la sous-catégorie ne peut pas inventer un atome hors de la tête');
ok(parts.headAtoms.has(idx('C11')) && parts.headAtoms.has(idx('S1')) && parts.headAtoms.has(idx('C12')),
  '…et la TÊTE entière garde tout son monde (la rangée « Phospholipid headgroups » ne bouge pas)');
eq(list(parts.heads).length, 6, 'six atomes polaires dans cette tête (1 P · 1 N · 4 O)');

/* ══ 3. LA RANGÉE DESSINE CES ATOMES — ET L'ANCRE DE LA MAISON ══════════════════
   `parts.heads` (ce que la sous-catégorie EST) ne contient que P · N · O. La SÉLECTION
   d'une rangée qui dessine des atomes est, elle, ancrée comme celle de toutes les autres
   (voir sectionRowSele · anchoredPartSele) : elle prend les atomes voisins auxquels ses
   atomes pendent, sinon les billes flotteraient — c'est la convention du fichier (le CA
   des chaînes latérales, le C3 de la tête, le C1' d'un sucre). Ici ce sont les trois
   atomes dont pendent P · N · O : le C3 du glycérol, et les deux carbones de la choline. */
const lipidSec = { kind: 'lipid', sele: '[POPC]' };
eq(H.sectionRowSele(STRUCT, lipidSec, 'heads'), parts.heads,
  'sans ancre, la rangée est EXACTEMENT la part (octet pour octet, comme les autres)');
const anchored = list(H.sectionRowSele(STRUCT, lipidSec, 'heads', { anchorParts: true }));
eq(anchored, ['O11', 'P', 'O13', 'O14', 'O12', 'N', 'C3', 'C11', 'C12'].map(idx).sort((a, b) => a - b),
  'avec l’ancre (la sphère la demande), la rangée ajoute les trois atomes de raccord — et RIEN d’autre');
ok(anchored.includes(idx('C3')),
  '…le C3 du glycérol dont pend le phosphate : la bille du P est attachée au squelette');
ok(anchored.every((i) => list(parts.heads).includes(i) || parts.headAtoms.has(i) || parts.glycerolAtoms.has(i)),
  '…et chacun de ces raccords appartient à la TÊTE ou au SQUELETTE (jamais une chaîne)');
eq(list(H.sectionRowSele(STRUCT, lipidSec, 'tail')).length, 6,
  'la rangée des chaînes acyles, elle, ne bouge pas d’un atome (aucune régression)');
eq(list(H.sectionRowSele(STRUCT, lipidSec, 'head')).length, 9,
  '…et la rangée de la tête entière garde ses neuf atomes (la sous-catégorie heads ne lui prend rien)');
eq(list(H.sectionRowSele(STRUCT, lipidSec, 'head', { anchorParts: true })).length, 10,
  '…plus son propre raccord (le C3 du glycérol) quand elle dessine des atomes');

/* ══ 4. LA COULEUR VIENT DE LA ROUE ⚙ ══════════════════════════════════════════
   « Il loro colore sarà definito nella setting wheel » : la rangée offre « Lipid type »,
   qui peint la PART de l'atome, et les pastilles de la roue sont celles de l'utilisateur. */
has("{ sub: 'heads', label: 'Heads (P · N · O)', styles: STYLES.heads, colors: COLORS.lipidParts,",
  'la rangée lit les MÊMES modes de coloration que les trois parts (Solid · Atom type · Lipid type)');
has('The <b>H</b> swatch is also the colour of the « Heads (P · N · O) » row of the Lipids menu',
  '…et la roue DIT que la pastille H est celle des heads (une règle invisible est une règle qu’on croit fausse)');
has('headgroup — also the colour of the « Heads (P · N · O) » row',
  '…jusque dans l’infobulle de la pastille H');
gone("const HEAD_ELEMENTS = new Set(['N', 'P', 'O', 'S'])",
  'le soufre n’est PAS un élément de tête (la demande dit P · N · O)');

console.log(`_viewer_heads_row_test.mjs — ${passed} assertions OK`);
