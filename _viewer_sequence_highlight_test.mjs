/* =========================================================================
   _viewer_sequence_highlight_test.mjs — LA SÉLECTION VA DANS LES DEUX SENS.

   Le rapport : « selected residues in the sequence inside the viewer 3D have to
   highlight the corresponding parts of the molecule. At present is only the
   reverse : if I click on an atom the sequence is highlighted, but it should be
   also the reverse. »

   La moitié « 3D → séquence » marchait (l'atome cliqué pose `selectedAtomKeys`,
   le bandeau s'allume). La moitié « séquence → 3D » était MUETTE, pour deux
   raisons cumulées dans la clause NGL du tick cliqué :

     `:${t.chainid}`   NGL garde l'INDEX de chaîne dans `residue.chainid`
                       (« 1 », « 2 » …) tandis que le `:` de sa grammaire
                       sélectionne `chainname` (la LETTRE du PDB) : `:1`
                       n'allume RIEN.
     `and resn ALA`    `resn` n'est pas un mot-clé de NGL 2.4 : le morceau est lu
                       comme le NOM D'UN RÉSIDU (« RESN »), donc la clause
                       entière = chaîne « 1 » ET resno ET resname 'RESN' ET
                       'ALA' = le vide. `resname ALA` (5 lettres) fait même
                       jeter le parseur (une erreur de parse rend « tout »).

   Ce banc exécute le VRAI NGL 2.4 — parsé en Node, comme le fait la page — sur
   un complexe protéine + ADN + eau, et vérifie :

     • `residueTickClause(tick)` n'allume QUE les atomes de ce résidu : le compte
       est comparé aux lignes ATOM du fichier qui portent cette chaîne et ce
       numéro ;
     • deux chaînes qui portent le MÊME résidu (même resno, même nom) restent
       séparées par la LETTRE de chaîne, et une eau au même numéro reste dehors
       par le NOM du résidu ;
     • la forme d'hier (`:${chainid} and ${resno} and resn ${resname}`) allume
       0 atome — le rapport, épinglé pour de bon ;
     • l'autre sens reste vert : les clés d'un atome cliqué (`mapAtomToNmrKeys` →
       `buildNglSele`, la vraie chaîne de la 3D → bandeau) allument bien l'atome,
       et le bandeau s'allume sur le même `resno - 1` ;
     • le viewer lui-même : l'effet du surlignage ambre passe par la clause
       partagée, et l'ancienne écriture (`resn`) n'est plus nulle part.
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

const VIEW = readFileSync(new URL('./src/components/NMRMoleculeViewer.jsx', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n');
const has = (needle, what) => ok(VIEW.includes(needle), `${what}\n  introuvable : ${needle}`);
const gone = (needle, what) => ok(!VIEW.includes(needle), `${what}\n  encore présent : ${needle}`);

/* ── Extraction des helpers du viewer (mêmes règles que les autres bancs) ─── */
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
  throw new Error(`${name} : objet non terminé`);
};
/* `const nom = (…) => expression;` — une ligne, pas de corps en bloc. */
const sliceLine = (src, name) => {
  const start = src.indexOf(`const ${name} = `);
  assert.ok(start >= 0, `ligne ${name} introuvable`);
  return src.slice(start, src.indexOf('\n', start)).trim();
};
/* `const NMR_TO_PDB_NAMES = (() => { … })();` — le tableau construit une fois. */
const sliceIife = (src, name) => {
  const start = src.indexOf(`const ${name} = `);
  assert.ok(start >= 0, `IIFE ${name} introuvable`);
  const end = src.indexOf('})();', start);
  assert.ok(end > start, `IIFE ${name} non terminée`);
  return `${src.slice(start, end + 5)};`;
};

/* ── Le fichier de travail : protéine + ADN + eau, chaînes et doublons ────── */
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const templateLines = (file) => read(`./public/structures/${file}`).split('\n').filter((l) => l.startsWith('ATOM'));
const recast = (lines, { resname, chain, resno, serial0 }) => lines.map((l, i) => (
  `ATOM  ${String(serial0 + i).padStart(5)} ${l.slice(12, 16)} ${(resname || l.slice(17, 20)).trim().padStart(3)} ${chain}${String(resno).padStart(4)}${l.slice(26)}`
));
const water = 'ATOM    901  O   HOH C   1      20.000   0.000   0.000  1.00  0.00           O';

const PDB = [
  ...recast(templateLines('template_amino_acid.pdb'), { chain: 'A', resno: 1, serial0: 1 }),    // A · ALA 1
  ...recast(templateLines('template_amino_acid.pdb'), { resname: 'GLY', chain: 'A', resno: 2, serial0: 101 }),
  ...recast(templateLines('template_amino_acid.pdb'), { chain: 'B', resno: 1, serial0: 201 }),    // B · ALA 1 — MÊME résidu
  // C · HOH 1 — même numéro que les deux ALA 1 : seul le NOM du résidu l'exclut.
  water,
  ...recast(templateLines('template_nucleotide_dna.pdb'), { chain: 'D', resno: 7, serial0: 301 }),
  'END',
].join('\n');

const atomsOf = (chain, resno) => PDB.split('\n')
  .filter((l) => l.startsWith('ATOM') && l.slice(21, 22) === chain && parseInt(l.slice(22, 26), 10) === resno)
  .length;

/* NGL lit un Blob à travers FileReader : le navigateur l'a, node non. */
globalThis.FileReader = class {
  readAsText(blob) {
    Promise.resolve(blob.text()).then((t) => {
      this.result = t;
      if (typeof this.onload === 'function') this.onload({ target: this });
    });
  }
};

const structure = await NGL.autoLoad(new Blob([PDB], { type: 'text/plain' }), { ext: 'pdb' });
ok(structure && structure.atomCount === PDB.split('\n').filter((l) => l.startsWith('ATOM')).length,
  'le complexe est parsé par le VRAI NGL (protéine + eau + ADN)');

const countAtoms = (sele) => structure.getAtomIndices(new NGL.Selection(sele)).length;

/* ── Le viewer, exécuté : ticks + clause + clés d'atome ───────────────────── */
const H = new Function([
  sliceObject(VIEW, 'AA3_TO_1'),
  sliceObject(VIEW, 'NUCLEIC_1_BY_NAME'),
  sliceObject(VIEW, 'PDB_TO_NMR'),
  sliceObject(VIEW, 'GREEK_MAP'),
  sliceObject(VIEW, 'REVERSE_GREEK'),
  sliceIife(VIEW, 'NMR_TO_PDB_NAMES'),
  sliceLine(VIEW, 'NUCLEIC_NMR_ALIASES'),
  `const SEQUENCE_NATURES = ['protein', 'dna', 'rna'];`,
  sliceFn(VIEW, 'atomNameSet'),
  sliceLine(VIEW, 'hasSugarRing'),
  sliceLine(VIEW, 'hasPhosphateLink'),
  sliceFn(VIEW, 'residueNatureOf'),
  sliceFn(VIEW, 'collectResidueTicks'),
  sliceFn(VIEW, 'residueTickClause'),
  sliceFn(VIEW, 'stripHighlightClauses'),
  sliceFn(VIEW, 'getCarbonName'),
  sliceFn(VIEW, 'buildKeys'),
  sliceFn(VIEW, 'mapPdbAtomToNmrKeys'),
  sliceFn(VIEW, 'mapAtomToNmrKeys'),
  sliceFn(VIEW, 'buildNglSele'),
  `return { AA3_TO_1, residueNatureOf, collectResidueTicks, residueTickClause,
    stripHighlightClauses, mapPdbAtomToNmrKeys, mapAtomToNmrKeys, buildNglSele };`,
].join('\n'))();

const ticks = H.collectResidueTicks({ structure });
const poly = ticks.filter((t) => t.polymer);
eq(ticks.length, 5, 'cinq résidus dans le fichier (2 ALA · 2 GLY · 1 eau · 1 ADN → quatre polymères + l’eau)');
eq(poly.map((t) => `${t.chainname}${t.resno}${t.resname}`), ['A1ALA', 'A2GLY', 'B1ALA', 'D7DA'],
  'le bandeau montre les polymères, dans l’ordre du fichier, nommés par la LETTRE de chaîne du PDB');
eq(poly.map((t) => t.chainname), ['A', 'A', 'B', 'D'], 'les quatre ticks portent la LETTRE du PDB');
ok(poly.every((t) => t.chainid !== t.chainname),
  'NGL rend bien un INDEX dans `chainid` (« 1 », « 1 », « 2 », « 4 ») et la LETTRE dans `chainname`');
/* ══ 1. SÉQUENCE → 3D : le tick cliqué allume SON résidu, et lui seul ═══════ */
poly.forEach((t) => {
  const clause = H.residueTickClause(t);
  const expected = atomsOf(t.chainname, t.resno);
  eq(countAtoms(clause), expected,
    `la clause du tick ${t.chainname}·${t.resname}${t.resno} allume exactement ses ${expected} atomes`);
  ok(clause.includes(`:${t.chainname}`), `…« ${clause} » : la chaîne est la LETTRE du PDB`);
  ok(!/:\d/.test(clause) && !/\bresn\b/.test(clause),
    `…« ${clause} » : ni l’INDEX de chaîne de NGL, ni « resn » (aucun des deux n’est lu)`);
});
eq(H.residueTickClause(poly[0]), ':A and 1 and ALA', 'la clause d’un tick est « :chaîne and resno and NOM »');
eq(H.residueTickClause(poly[2]), ':B and 1 and ALA', '…et le tick de la chaîne B porte SA lettre');
eq(countAtoms(':B and 1 and ALA'), atomsOf('B', 1), 'la chaîne B n’allume que ses propres atomes');
eq(countAtoms(':A and 1 and ALA'), atomsOf('A', 1), 'les DEUX ALA 1 du fichier sont dans deux chaînes : la chaîne les sépare');
eq(countAtoms('1 and ALA'), atomsOf('A', 1) + atomsOf('B', 1),
  '…sans la chaîne, les deux résidus homonymes s’allument ensemble : elle est indispensable');
eq(countAtoms(':C and 1 and HOH'), 1, 'l’eau au même numéro reste dehors : le NOM du résidu la nomme');
eq(countAtoms(':C and 1'), 1, '…et elle porte bien le numéro 1 dans la chaîne C (le piège est réel)');
const dna = H.residueTickClause(poly[3]);
eq(countAtoms(dna), atomsOf('D', 7), `l’ADN aussi marche (« ${dna} »)`);

/* La forme d'hier : exactement le rapport — la clause allumait ZÉRO atome. */
const oldClause = (t) => `${t.chainid ? `:${t.chainid}` : ''} and ${t.resno} and resn ${t.resname}`;
poly.forEach((t) => {
  eq(countAtoms(oldClause(t)), 0,
    `l’ancienne clause « ${oldClause(t)} » n’allumait rien : c’est le bug rapporté`);
});
eq(countAtoms(`:${poly[2].chainid} and 1 and ALA`), 0,
  '…et pour le tick de la chaîne B non plus : « :2 » n’est pas une chaîne, c’est un index');

/* Les deux jokers de la clause : un nom de résidu > 4 lettres → la liste NGL. */
eq(H.residueTickClause({ chainname: 'A', resno: 3, resname: 'ALDOSE' }), ':A and 3 and [ALDOSE]',
  'un nom de résidu de plus de quatre lettres passe par la liste entre crochets de NGL');
eq(H.residueTickClause({ chainname: '', chainid: '', resno: 4, resname: '' }), '4',
  'un résidu sans chaîne ni nom ne laisse pas un « and » orphelin (le parseur jetait)');
eq(H.residueTickClause(null), '', 'aucun tick : aucune clause (jamais «  and  »)');

/* ── 1bis. Le `sele` EXACT que le viewer passe à NGL pour un tick cliqué ──── */
/* Les clés du bandeau sont « resno - 1 » (elles n'ont pas de chaîne : elles
   nourrissent aussi les spectres), donc un clic couvre TOUS les ticks polymères
   de ce préfixe — exactement ceux que le bandeau allume. */
const clickedA = H.stripHighlightClauses(['0-Cα'], ticks);
eq(clickedA.parts, [':A and 1 and ALA', ':B and 1 and ALA'],
  'cliquer le premier résidu allume les DEUX ALA 1 du fichier, comme le bandeau allume les deux ticks');
eq(countAtoms(clickedA.parts.join(' or ')), atomsOf('A', 1) + atomsOf('B', 1),
  '…et le 3D en allume bien vingt atomes (dix par chaîne)');
eq(clickedA.atoms, 20, '…le compte d’atomes qui choisit sphères ou ball+stick suit');
eq(clickedA.parts.join(' ').includes('HOH'), false,
  'l’eau au même numéro n’est jamais du lot (le bandeau ne montre que les polymères)');
eq(H.stripHighlightClauses(['6-N'], ticks).parts, [':D and 7 and DA'], 'un tick d’ADN passe par la même route');
eq(countAtoms(H.stripHighlightClauses(['6-N'], ticks).parts.join(' or ')), atomsOf('D', 7),
  '…et n’allume que ses atomes');
eq(H.stripHighlightClauses([], ticks).parts, [], 'sans clé : aucune clause (rien n’est dessiné)');
eq(H.stripHighlightClauses(['9-X'], ticks).parts, [], 'un préfixe qu’aucun tick ne porte ne dessine rien');
eq(H.stripHighlightClauses(['0-Cα', '0-Cα'], ticks).parts.length, 2,
  'deux clés du même résidu ne dessinent pas deux fois le même résidu (dédoublonné)');

/* ══ 2. 3D → SÉQUENCE : l’autre sens reste vert ════════════════════════════ */
const seq = [
  { id: 'ALA1', char: 'A' }, { id: 'GLY2', char: 'G' }, { id: 'ALA1', char: 'A' },
  { id: 'HOH1', char: '' }, { id: 'DA7', char: 'A' },
];
const clicked = H.mapAtomToNmrKeys({ atomname: 'CA', resno: 2 }, seq, 'protein', 'nmr');
eq(clicked.keys, ['1-Cα'], 'cliquer un atome donne les clés « ri-atome » du viewer');
const backSele = H.buildNglSele(clicked.keys, structure, 'protein', 'nmr');
ok(countAtoms(backSele) > 0, `les clés d’un atome cliqué allument bien du 3D (« ${backSele} »)`);
const tickOfKey = (k) => poly.find((t) => t.resno - 1 === parseInt(String(k).split('-')[0], 10));
ok(!!tickOfKey(clicked.keys[0]), '…et le bandeau s’allume sur le même `resno - 1` (le tick existe)');

/* ══ 3. Le viewer lui-même : une seule écriture de clause ══════════════════ */
has('const { parts: selParts, atoms: approxAtoms } = stripHighlightClauses(sel, residueTicks);',
  'l’effet du surlignage ambre passe par la sélection partagée (pas une copie)');
gone('and resn ${',
  'plus une seule clause construite avec « resn » (le mot-clé que NGL ne lit pas)');
gone('`:${t.chainid}`', 'l’index de chaîne de NGL ne peut plus revenir dans une clause');
const CLAUSE_SRC = sliceFn(VIEW, 'residueTickClause');
ok(CLAUSE_SRC.includes('parts.push(`:${chain}`)'), 'la clause écrit la LETTRE de chaîne (`:A`)');
ok(CLAUSE_SRC.includes('tick.chainname || tick.chainid'),
  '…la lettre d’abord, l’index de NGL seulement si le fichier n’a pas de nom de chaîne');
ok(CLAUSE_SRC.includes('`[${resname}]`'),
  '…et le nom de résidu passe par la liste entre crochets quand NGL ne peut pas le lire nu');
has("const isSel = selectedKeys && selectedKeys.some((k) => parseInt(String(k).split('-')[0], 10) === r.resno - 1);",
  'le bandeau garde SON allumage (le sens 3D → séquence du rapport)');

console.log(`_viewer_sequence_highlight_test.mjs — ${passed} assertions OK (séquence ⇄ 3D, vrai NGL 2.4)`);
