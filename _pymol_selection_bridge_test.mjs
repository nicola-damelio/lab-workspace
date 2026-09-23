/* =========================================================================
   _pymol_selection_bridge_test.mjs — le pont PyMOL → NGL.

   Le rapport de l'utilisateur : « la scheda a sinistra non funziona, tutto
   rimane in spheres e gli hide non funzionano ». La cause n'était PAS l'ordre
   des commandes (déjà corrigé) : les expressions écrites par la macro en
   syntaxe PyMOL étaient lues par NGL comme du charabia SILENCIEUX. Mesuré sur
   ngl@2.4.0, celui que le viewer charge du CDN :

       'z>90'        → { resname: "Z>90" }                     → 0 atome
       'name CA'     → resname "NAME" or resname "CA"           → 0 atome
       'resn STIG*'  → { error: "resi must be an integer" }      → perdue
       'ECL*' / '.H*'→ NGL n'a AUCUN joker (comparaison exacte)  → 0 atome

   Résultat : `hide spheres, membrane and z>90` ne retirait RIEN (sélection
   vide) et `show spheres, upper_headgroups` dessinait des RÉSIDUS ENTIERS
   (chaque `name …` lu comme un nom de résidu) — « tout est en sphères ».

   Ce fichier EXÉCUTE le pont extrait du viewer sur une structure SIMULÉE, et
   vérifie en plus que TOUT ce qu'il produit est accepté par le vrai NGL
   (aucun `.error`) : c'est le seul moyen d'attraper un silence.
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
const slice = (from, to) => {
  const i = VIEW.indexOf(from);
  assert.ok(i >= 0, `ancre introuvable : ${from}`);
  const j = VIEW.indexOf(to, i + from.length);
  assert.ok(j > i, `fin introuvable : ${to}`);
  return VIEW.slice(i, j);
};
const CODE = slice('const PYMOL_PREDICATES = {', '\nconst normalizeStructureSource');

/* Le pont NE dépend que de sa `ctx` : on lui donne une structure SIMULÉE (le
   vocabulaire, les coordonnées, `byres`) — exactement ce que le viewer fournit
   depuis la vraie structure. `isLipidResname` / `lipidGroupOf` sont les deux
   seuls collaborateurs de la détection de membrane : ils sont remplacés ici par
   leur version simple, pour que le test ne dépende pas du classement complet. */
const buildBridge = (cfg = {}) => new Function(
  'cfg',
  `${CODE}
   const isLipidResname = (n) => /^(POPC|POPS|PSM|CHL1|ECL2)$/.test(String(n || '').toUpperCase());
   const lipidGroupOf = (name) => (/^(P|O13|O14|N|HN1|O3|HO3)$/.test(String(name || '')) ? 'head' : 'acyl');
   const warned = [];
   const atoms = cfg.atoms || [];
   const ctx = {
     named: new Map(cfg.named || []),
     overrides: cfg.overrides ? new Map(cfg.overrides) : undefined,
     resnames: cfg.resnames || [],
     atomnames: cfg.atomnames || [],
     onWarn: (m) => warned.push(m),
     coord: cfg.atoms ? (axis, op, value) => {
       const lim = parseFloat(value);
       const idx = atoms.filter((a) => {
         const v = axis === 'x' ? a.x : axis === 'y' ? a.y : a.z;
         return op === '>' ? v > lim : op === '<' ? v < lim : op === '>=' ? v >= lim : v <= lim;
       }).map((a) => a.index);
       return idx.length ? '@' + idx.join(',') : 'none';
     } : undefined,
     byres: cfg.atoms ? (inner) => {
       if (!inner || inner === 'none') return 'none';
       const idx = atoms.filter((a) => a.hit).map((a) => a.index);
       return idx.length ? '@' + idx.join(',') : 'none';
     } : undefined,
   };
   return {
     toNgl: (raw) => pymolSeleToNgl(raw, ctx),
     warned,
     tokenize: tokenizePymolSele,
     membrane: membraneLeafletsOf,
     ranges: resnoRangesClause,
   };`,
)(cfg);

const STRUCT = {
  resnames: ['POPC', 'POPS', 'POPE', 'PSM', 'CHL1', 'ECL2', 'TIP3', 'ALA', 'LYS', 'STIG', 'SITO'],
  atomnames: ['P', 'O13', 'O14', 'N', 'HN1', 'C12', 'H12A', 'C1', 'C2', 'CB', 'CA', 'HA', 'H1', 'O3', 'HO3', 'CB1', 'HB1'],
  atoms: [
    { index: 0, x: 10, y: 10, z: 95, hit: true },
    { index: 1, x: 10, y: 10, z: 85, hit: false },
    { index: 7, x: 12, y: 10, z: 91, hit: true },
  ],
};
const B = buildBridge(STRUCT);
const W = buildBridge({});

/* ── 1. Les mots PyMOL que NGL ne connaît pas ────────────────────────────── */
eq(B.toNgl('resn POPC'), 'POPC', 'une seule resname courte s’écrit nue (NGL la comprend)');
eq(B.toNgl('resn POPC+POPS+PSM'), '[POPC,POPS,PSM]', '…et un `+` devient la LISTE de resnames de NGL');
eq(B.toNgl('resn STIG*'), 'STIG', 'un joker de resname est DÉVELOPPÉ contre la structure (NGL n’a pas de joker)');
eq(B.toNgl('resn ECL*'), 'ECL2', '…même quand le joker désigne un nom que la macro écrit en clair (ECL* → ECL2)');
eq(W.toNgl('resn ECL*'), 'none', 'sans structure, un joker ne peut pas être développé : rien, jamais du charabia');
ok(W.warned.some((m) => /no residue name matches/.test(m)), '…et l’utilisateur est PRÉVENU (plus de sélection vide silencieuse)');
eq(B.toNgl('name CA'), '.CA', '`name` devient la syntaxe NGL `.CA` (sinon NGL lisait resname "CA")');
eq(B.toNgl('name P+O13'), '(.P or .O13)', 'une liste de noms d’atomes devient une union de `.NOM`');
eq(B.toNgl('name H12A'), '.H12A', 'un nom d’atome de 4 caractères passe aussi');
ok(/^\(\.H1 or \.HA or \.HB1.*\)$/.test(B.toNgl('name H*')) || /^\(.*\.H1.*\)$/.test(B.toNgl('name H*')),
  `un joker de nom d’atome est développé en union de noms réels (obtenu : ${B.toNgl('name H*')})`);
eq(B.toNgl('name H*').includes('*'), false, '…et aucun joker ne survit dans l’expression NGL');
eq(B.toNgl('resi 1-10'), '1-10', '`resi 1-10` devient la plage NGL');
eq(B.toNgl('resi 3+7'), '(3 or 7)', '`resi 3+7` devient une union de numéros');
eq(B.toNgl('chain A'), ':A', '`chain A` devient `:A`');
eq(B.toNgl('elem C'), '_C', '`elem C` devient `_C`');
eq(B.toNgl('polymer.protein'), 'protein', '`polymer.protein` → `protein`');
eq(B.toNgl('hetatm and not water'), '(hetero and not (water))', 'les mots connus passent tels quels, entre parenthèses explicites');
eq(B.toNgl(''), 'all', 'une expression vide vaut tout (comme PyMOL)');

/* ── 2. Les coordonnées : ce que NGL ne sait pas faire ───────────────────── */
/* `z>90` est lu par NGL comme un nom de résidu « Z>90 », donc ne sélectionne
   RIEN : c’est la cause exacte des « hide qui ne cachent rien ». */
eq(B.toNgl('z>90'), '@0,7', '`z>90` devient la LISTE d’indices que NGL comprend');
eq(B.toNgl('z<90'), '@1', '`z<90` aussi');
eq(B.toNgl('z >= 95'), '@0', '…y compris avec un opérateur séparé par des espaces');
eq(W.toNgl('z>90'), 'none', 'sans structure, une coordonnée ne peut pas être résolue');
ok(W.warned.some((m) => /needs a loaded structure/.test(m)), '…et c’est DIT, pas silencieux');

/* ── 3. La précédence de PyMOL : `+` lie plus fort que `and` ─────────────── */
eq(B.toNgl('resn POPC+POPS and z>90'), '([POPC,POPS] and @0,7)',
  '`A+B and C` est `(A or B) and C`, comme PyMOL (NGL lit les espaces comme un OR)');
eq(B.toNgl('not resn POPC'), 'not (POPC)', '`not` est conservé');
eq(B.toNgl('(resn POPC or resn POPS) and resi 1-10'), '((POPC or POPS) and 1-10)', 'les parenthèses de la macro survivent');

/* ── 4. `byres`, les sélections nommées, les noms réservés ───────────────── */
eq(B.toNgl('byres z>90'), '@0,7', '`byres` élargit aux résidus touchés (calculé, plus ignoré)');
eq(buildBridge({ ...STRUCT, named: [['peptide', 'polymer.protein']] }).toNgl('peptide'), 'protein',
  'une sélection NOMMÉE par la macro est inlinée (comme les sets de PyMOL)');
eq(buildBridge({ ...STRUCT, named: [['membrane', 'resn POPC+POPS']] }).toNgl('membrane and z>90'), '([POPC,POPS] and @0,7)',
  '…même imbriquée dans une expression');
eq(buildBridge({ ...STRUCT, overrides: [['upper_leaflet', '(1-10) and ([POPC])']] }).toNgl('upper_leaflet'),
  '(1-10) and ([POPC])', 'un nom RÉSERVÉ (feuillet mesuré) gagne sur tout le reste');
eq(B.toNgl('upper_headgroups'), 'none', 'sans nom réservé ni définition, un mot inconnu ne vaut RIEN');
ok(B.warned.some((m) => /not defined by the script/.test(m)), '…et il est signalé (jamais d’union silencieuse avec tout)');

/* ── 6. Les FEUILLETS, mesurés au lieu de `z>90` ─────────────────────────── */
/* L’utilisateur : « z était un moyen de distinguer l’upper du lower leaflet ;
   si tu peux les distinguer, z n’est pas nécessaire ». membraneLeafletsOf le
   fait par la GÉOMÉTRIE : l’axe le plus FIN des lipides est la normale, les deux
   amas de têtes donnent le plan médian, et les têtes sont classées par le même
   classificateur que le menu Lipids (lipidGroupOf). */
const membraneStructure = (spreadAxis) => {
  const atoms = [];
  let index = 0;
  const leaflet = (zPos, tailPos, resnoBase) => {
    for (let r = 0; r < 6; r += 1) {
      const resno = resnoBase + r;
      [['P', zPos], ['O13', zPos], ['N', zPos], ['C1', tailPos], ['C12', tailPos]].forEach(([name, z]) => {
        const wide = (index % 7) * 6;   // une membrane est LARGE en x et y
        const other = (index % 5) * 6;
        atoms.push({
          index,
          residueIndex: resno,
          resno,
          resname: 'POPC',
          atomname: name,
          element: name[0],
          x: spreadAxis === 'x' ? z : wide,
          y: spreadAxis === 'x' ? wide : other,
          z: spreadAxis === 'z' ? z : other,
        });
        index += 1;
      });
    }
  };
  leaflet(95, 91, 1);    // feuillet du HAUT (têtes en 95, queues vers 91)
  leaflet(85, 89, 101);  // feuillet du BAS
  return { eachAtom: (cb) => atoms.forEach(cb) };
};
const M = B.membrane(membraneStructure('z'));
ok(!!M, 'une bicouche est reconnue');
eq(M.axis, 'z', 'l’axe NORMAL est l’axe le plus FIN (ici z) — sans rien supposer du fichier');
ok(Math.abs(M.midplane - 90) < 1.5, `le plan médian est mesuré (obtenu ${M && M.midplane.toFixed(2)} Å, attendu ≈ 90)`);
ok(M.thickness > 5 && M.thickness < 20, `l’épaisseur tête-à-tête est mesurée (obtenu ${M && M.thickness.toFixed(2)} Å)`);
eq(M.upper.residues, 6, '6 lipides dans le feuillet du haut');
eq(M.lower.residues, 6, '6 dans celui du bas');
eq(M.upper.atoms, 30, '…et tous leurs atomes suivent (5 par POPC)');
eq(M.upper.headIndices.length, 18, 'les TÊTES du feuillet haut sont celles du classificateur des lipides (3 × 6)');
ok(/1-6/.test(M.upper.clause), `les numéros de résidus sont compressés en plages (obtenu ${M.upper.clause})`);
ok(M.upper.clause.includes('POPC'), '…et la clause rappelle les resnames (pour ne pas attraper l’eau au même numéro)');
const MR = B.membrane(membraneStructure('x'));
eq(MR.axis, 'x', 'une membrane ORIENTÉE EN X est reconnue pareil : c’est tout l’intérêt (z n’est plus nécessaire)');
eq(MR.upper.residues, 6, '…avec les mêmes feuillets');
eq(B.membrane({ eachAtom: (cb) => [{ index: 0, residueIndex: 0, resno: 1, resname: 'POPC', atomname: 'P', element: 'P', x: 0, y: 0, z: 0 }].forEach(cb) }),
  null, 'un seul lipide n’est pas une membrane');
eq(B.membrane(null), null, 'sans structure, aucune membrane');
let NGL = null;
try { NGL = (await import('ngl')).default; } catch { /* NGL absent : contrôle sauté */ }
if (NGL) {
  const CLAUSES = [
    B.toNgl('resn POPC+POPS+PSM'), B.toNgl('name CA'), B.toNgl('name P+O13'), B.toNgl('name H*'),
    B.toNgl('resi 1-10'), B.toNgl('resi 3+7'), B.toNgl('chain A'), B.toNgl('elem C'),
    B.toNgl('z>90'), B.toNgl('z<90 and (resn POPC or resn POPS)'), B.toNgl('not resn POPC'),
    B.toNgl('protein and not (water)'), B.toNgl('byres z>90'), B.toNgl('all'), B.toNgl('none'),
    B.toNgl('resn POPC+POPS and z>90'), B.toNgl('(resn POPC or resn POPS) and resi 1-10'),
  ];
  CLAUSES.forEach((clause) => {
    const sel = new NGL.Selection(clause);
    const broken = !sel.test || (sel.selection && sel.selection.error);
    ok(!broken, `NGL doit accepter « ${clause} » (erreur NGL : ${JSON.stringify(sel.selection && sel.selection.error)})`);
  });
  // Et la preuve du contraire : ce que la macro écrivait AVANT le pont.
  eq(new NGL.Selection('z>90').selection.rules, [{ resname: 'Z>90' }],
    'NGL 2.4 lit `z>90` comme un NOM DE RÉSIDU (0 atome) — la raison d’être du pont');
  eq(new NGL.Selection('name CA').selection.rules, [{ resname: 'NAME' }, { resname: 'CA' }],
    '…et `name CA` comme deux noms de résidus, donc 0 atome');
}

/* ── Bilan ──────────────────────────────────────────────────────────────── */
console.log(`_pymol_selection_bridge_test.mjs — ${passed} assertions OK`);

