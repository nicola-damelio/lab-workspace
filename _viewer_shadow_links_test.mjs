/* =========================================================================
   _viewer_shadow_links_test.mjs — LES LIENS QUE L'OMBRE REMPLIT.

   Le rapport : « les ombres de la molécule sont une suite de blobs ronds séparés,
   environ un par résidu, et il y a un disque noir plein là où l'un d'eux regarde
   le long de la lumière ».

   LA CAUSE, dans src/utils/viewerRayShadows.js : le proxy de l'ombre ne remplit
   que des LIAISONS, et il les prenait DANS L'ORDRE DE LA LISTE DES ATOMES (« cet
   atome, puis le suivant de la liste »). Cette liste est celle que le tube ET le
   licorice dessinent — la MÊME sélection, donc tous les atomes de la protéine,
   chaînes latérales comprises. L'atome qui suit un oxygène de squelette y est donc
   un carbone de chaîne latérale, et la liaison peptidique C(i)–N(i+1) — le seul
   lien qui rend le ruban continu, celui que l'œil voit — tombe entre deux atomes
   qui ne sont JAMAIS voisins dans cette liste. Chaque résidu remplissait son propre
   petit amas (un blob rond et net) et rien ne reliait un résidu au suivant ; le
   « disque noir » est un lien fantôme (une chaîne latérale reliée au squelette du
   résidu suivant) qui, vu bout par bout, sature le masque.

   LA RÉPARATION : le remplissage suit le GRAPHE DE LIAISONS DE LA STRUCTURE
   (`structure.eachBond` → `atomIndex1` / `atomIndex2`, que NGL 2.4 construit à
   partir des modèles de résidus ET de la liaison peptidique vérifiée par distance)
   — ce que le reste de l'application utilise déjà (`ensureGlycanBonds` de
   NMRMoleculeViewer.jsx écrit ses branchements de sucres dans ce même graphe).

   CE QUI EST VÉRIFIÉ ICI :

     1. LE FAIT NGL, sur la bibliothèque INSTALLÉE (2.4.0, exactement le CDN que la
        page charge) : un peptide de 3 résidus avec ses chaînes latérales porte 15
        liaisons, dont C1–N2 et C2–N3 (les deux liaisons peptidiques) et la
        ramification CB2–CG1 / CB2–CG2 (un V, pas une chaîne) ;
     2. LA RÉPARATION, EXÉCUTÉE sur ce graphe : le proxy ne remplit QUE des
        liaisons réelles (aucun fantôme) et remplit TOUTES les liaisons dessinées,
        liaisons peptidiques comprises ;
      3. L'ANCIEN DÉFAUT, REPRODUIT : le même peptide SANS topologie déclarée
         remplissait des liens qui ne sont pas des liaisons et laissait les deux
         liaisons peptidiques ouvertes — les blobs séparés du rapport. C'est
         pourquoi la règle « l'atome suivant de la liste » a été RETIRÉE : sans
         graphe, le module ne remplit plus rien, et le seul repli qui reste est la
         TRACE DES POLYMÈRES (l'atome de trace de résidus CONSÉCUTIFS), mesurée ici
         avec le fait NGL qui la nourrit ;
      4. LES DOUBLONS : un fichier qui porte des CONECT ET se fait inférer ses
         liaisons donne la même paire deux fois (mesuré : 17 liaisons pour 15
         réelles) — elle n'est remplie qu'une fois ;
      5. LE BANC DU MODULE RESTE VRAI : une trace CA seule porte elle aussi ses
         liaisons (l'ancien banc des ombres est « 30 CA d'un tube de 0,5 Å ») ;
      6. LE GRAPHE, ET RIEN QUE LUI : c'est `eachBond` qui décide, jamais un compte
         (`bondCount` / `bondStore.count` ne sont plus lus du tout). Une structure
         qui n'a QUE le magasin — un objet reconstruit, un montage à la main — est
         remplie par son graphe, et un magasin VIDE dont `eachBond` rend les
         liaisons l'est aussi.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

/* LE MODULE ÉPROUVÉ. SHADOW_MODULE permet de rejouer cette suite sur une version
   d'AVANT le correctif — elle doit alors ÊTRE ROUGE, c'est ainsi que chaque défaut
   a été reproduit (même idiome que VIEWER_SRC dans _viewer_report_fixes_test.mjs) :
     git show <avant>:src/utils/viewerRayShadows.js > avant.js
     SHADOW_MODULE=./avant.js node _viewer_shadow_links_test.mjs
   Mesuré sur l'ancienne version : 49 remplissages fantômes et 5 liaisons réelles
   laissées ouvertes (CA1-CB1, CA2-CB2, CB2-CG2, C1-N2, C2-N3), contre 0 et 0 ici. */
const MODULE_PATH = process.env.SHADOW_MODULE || './src/utils/viewerRayShadows.js';
const { atomsFromStage } = await import(MODULE_PATH);

const require = createRequire(import.meta.url);
const NGL = require('ngl');   // le paquet installé : 2.4.0, exactement celui de la page
// NGL lit un Blob à travers FileReader : le navigateur l'a, node non.
globalThis.FileReader = class {
  readAsText(blob) {
    Promise.resolve(blob.text()).then((t) => {
      this.result = t;
      if (typeof this.onload === 'function') this.onload({ target: this });
    });
  }
};

let passed = 0;
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};
const eq = (a, b, what) => {
  assert.deepEqual(a, b, `${what}\n  attendu : ${JSON.stringify(b)}\n  obtenu  : ${JSON.stringify(a)}`);
  passed += 1;
};

const MODULE = readFileSync(new URL(MODULE_PATH, import.meta.url), 'utf8');


/* ── LE JEU D'ESSAI : un peptide de 3 résidus, chaînes latérales comprises ─────
   N–CA, CA–C, C=O, CA–CB, CB–CG1 / CB–CG2 (une ramification), et les liaisons
   peptidiques C(i)–N(i+1). C'est le motif du rapport : du squelette ET des
   chaînes latérales, donc l'ordre des indices n'est PAS l'ordre du dessin. */
const PEPTIDE_ATOMS = [
  [1, 'N', 'ALA', 0.0, 0.0, 0.0],
  [1, 'CA', 'ALA', 1.46, 0.0, 0.0],
  [1, 'C', 'ALA', 2.0, 1.4, 0.0],
  [1, 'O', 'ALA', 1.6, 2.5, 0.0],
  [1, 'CB', 'ALA', 2.0, -1.4, 0.6],
  [2, 'N', 'ILE', 3.3, 1.5, 0.0],
  [2, 'CA', 'ILE', 4.0, 0.1, 0.4],
  [2, 'C', 'ILE', 5.4, 0.6, 0.4],
  [2, 'O', 'ILE', 5.9, 1.7, 0.5],
  [2, 'CB', 'ILE', 4.3, -1.2, -0.5],
  [2, 'CG1', 'ILE', 3.5, -2.3, -0.9],
  [2, 'CG2', 'ILE', 5.4, -1.6, -1.4],
  [3, 'N', 'GLY', 6.7, 0.2, 0.4],
  [3, 'CA', 'GLY', 7.4, 1.3, 0.2],
  [3, 'C', 'GLY', 8.8, 1.0, 0.3],
  [3, 'O', 'GLY', 9.4, 0.2, 0.3],
];
const pdbLine = (index, [resno, name, resname, x, y, z]) =>
  `ATOM  ${String(index).padStart(5)} ${name.padEnd(4)} ${resname} A${String(resno).padStart(4)}`
  + `    ${x.toFixed(3).padStart(8)}${y.toFixed(3).padStart(8)}${z.toFixed(3).padStart(8)}`
  + `  1.00  0.00          ${name[0]}`;
const pdbOf = (rows) => `${rows.map((r, i) => pdbLine(i + 1, r)).join('\n')}\nEND\n`;
const PDB = pdbOf(PEPTIDE_ATOMS);
const PDB_CA_ONLY = pdbOf(PEPTIDE_ATOMS.filter((r) => r[1] === 'CA'));

const load = (text, params = {}) =>
  NGL.autoLoad(new Blob([text], { type: 'text/plain' }), { ext: 'pdb', ...params });

/* ── 1. LE FAIT NGL : LA STRUCTURE PORTE SON GRAPHE ───────────────────────── */
const peptide = await load(PDB);
eq(typeof peptide.eachBond, 'function', 'une structure NGL expose `eachBond` : le graphe de ses liaisons');
eq(peptide.atomCount, PEPTIDE_ATOMS.length, 'NGL a bien lu les 16 atomes du peptide');
eq(peptide.bondCount, 15, '…et il en a inféré 15 liaisons (aucun CONECT dans le fichier)');

/* NGL écrit ce compte à DEUX endroits, et c'est PAR LUI que le module décide s'il y
   a une topologie : le magasin des liaisons (`bondStore`, dont `count` est le
   compte vivant — mesuré aussi dans _viewer_structure_classes_test.mjs) et
   `bondCount`, la copie que `Structure.finalizeBonds` prend du magasin en fin de
   parsing (`this.bondCount = this.bondStore.count`). Une structure qui n'a pas
   encore pris cette copie — un objet reconstruit, un montage à la main — a donc un
   magasin PLEIN et pas de `bondCount` : lire le seul `bondCount` la déclarerait
   sans topologie, et le remplissage retomberait sur la liste des atomes, c'est-à-
   dire sur les blobs du rapport. Le repli doit donc lire le magasin aussi. */
eq(peptide.bondStore.count, 15, 'la structure porte son magasin de liaisons (`bondStore.count`)');
eq(peptide.bondStore.count, peptide.bondCount,
  '…et les deux comptes s’accordent : `bondCount` est la copie que `finalizeBonds` prend du magasin');

const nameOf = (structure, i) => {
  const a = structure.getAtomProxy(i);
  return `${String(a.atomname).trim()}${a.resno}`;
};
const bondPairs = (structure) => {
  const out = [];
  structure.eachBond((b) => out.push([b.atomIndex1, b.atomIndex2]));
  return out;
};
const bondKeys = (structure, pairs) => new Set(pairs.map(([a, b]) => `${nameOf(structure, a)}-${nameOf(structure, b)}`));
const REAL_BONDS = bondPairs(peptide);
const REAL_KEYS = bondKeys(peptide, REAL_BONDS);
ok(REAL_KEYS.has('C1-N2') && REAL_KEYS.has('C2-N3'),
  'le graphe contient les LIAISONS PEPTIDIQUES C(i)–N(i+1) : c’est ce que le ruban suit, résidu après résidu');
ok(REAL_KEYS.has('CB2-CG12') && REAL_KEYS.has('CB2-CG22') && !REAL_KEYS.has('CG12-CG22'),
  '…et la ramification de la chaîne latérale est un V (CG1 et CG2 pendent tous deux de CB2, pas l’un de l’autre)');
ok(REAL_KEYS.has('N1-CA1') && REAL_KEYS.has('CA1-C1') && REAL_KEYS.has('C1-O1'),
  '…avec le squelette et les doubles liaisons C=O');

/* …ET LA TRACE DES POLYMÈRES — le SEUL repli qui reste dans le module. Une
   structure NGL expose `eachPolymer`, chaque polymère son `residueCount` et son
   `eachResidue`, et chaque résidu son atome de trace (`traceAtomIndex` : le CA
   d'une protéine). C'est ce que le module parcourt quand AUCUN graphe n'est
   déclaré (voir drawnBondsOf). */
const CA_TRACE = PEPTIDE_ATOMS.reduce((a, r, i) => (r[1] === 'CA' ? a.concat(i) : a), []);
const traceAtoms = [];
peptide.eachPolymer((p) => {
  /* ⚠ LE PIÈGE DU REPLI, mesuré ici : `getResidueProxy` est sur la STRUCTURE, pas
     sur le POLYMÈRE. Un repli qui l'appelait sur le polymère levait sur le premier
     résidu — et, avalé par son `catch`, ne remplissait RIEN. C'est `eachResidue`
     qui rend les résidus, et chacun porte son atome de trace. */
  eq(typeof p.getResidueProxy, 'undefined',
    'un polymère NGL n’expose PAS `getResidueProxy` : le repli doit passer par `eachResidue`');
  ok(typeof p.eachResidue === 'function' && p.residueCount === CA_TRACE.length,
    '…mais il porte bien `eachResidue` et `residueCount` : les 3 résidus du peptide');
  p.eachResidue((r) => traceAtoms.push(r.traceAtomIndex));
});
eq(traceAtoms.map((i) => nameOf(peptide, i)), ['CA1', 'CA2', 'CA3'],
  'la trace du peptide, telle que NGL la donne, ce sont ses CA — résidu après résidu');

/* ── 2. LA RÉPARATION, EXÉCUTÉE ───────────────────────────────────────────────
   Le stage est celui de l'application : le tube ET les bâtons partagent la même
   sélection (`reprList` d'une seule représentation qui dessine TOUS les atomes :
   le cas du viewer, où le tube et le licorice couvrent `sels.protein`), et les
   coordonnées sont celles du PDB, donc les indices sont ceux du graphe. */
const IDENT16 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const POS = PEPTIDE_ATOMS.map((r) => [r[3], r[4], r[5]]);
const POSITION = new Float32Array(POS.flat());
const RADIUS = new Float32Array(POS.length).fill(1.7);
const everyAtom = { getAtomIndices: () => Uint32Array.from(POS.map((_, i) => i)) };
const tubeRep = { type: 'tube', radiusType: 'size', radiusSize: 0.5, visible: true, structureView: everyAtom };
/* LA TOPOLOGIE QUE PORTE LE FAUX COMPOSANT — les deux endroits où NGL écrit le
   compte, tels quels : `true` est une structure complète (`bondCount` ET le
   magasin), 'store' en est une dont la copie de `finalizeBonds` n'a PAS été prise
   (seul le magasin la déclare), 'store-empty' un magasin déclaré mais vide, et
   `false` une structure sans aucune topologie. */
const topologyOf = (bonds, declare) => {
  if (!declare) return {};
  const eachBond = (cb) => bonds.forEach(([a, b]) => cb({ atomIndex1: a, atomIndex2: b }));
  return declare === 'store'
    ? { bondStore: { count: bonds.length }, eachBond }
    : declare === 'store-empty'
      ? { bondStore: { count: 0 }, eachBond }
      : declare === 'empty-graph'
        // Ce que `inferBonds: 'none'` laisse : le graphe EXISTE et ne rend RIEN.
        ? { bondStore: { count: 0 }, eachBond: () => {} }
        : { bondCount: bonds.length, eachBond };
};
/* LE POLYMÈRE D'UNE STRUCTURE RÉELLE, tel que le module le parcourt : un polymère,
   son `residueCount` et son `eachResidue` — l'API MESURÉE au §1 (un PolymerProxy
   n'a PAS `getResidueProxy`) — et L'ATOME DE TRACE de chacun de ses résidus. */
const polymerOf = (trace) => (cb) => cb({
  residueCount: trace.length,
  eachResidue: (visit) => trace.forEach((t) => visit({ traceAtomIndex: t })),
});
const stageOf = ({ bonds, declare, polymers = false }) => ({
  compList: [{
    structure: {
      atomCount: POS.length,
      getAtomData: () => ({ position: POSITION, radius: RADIUS }),
      // La topologie : le graphe que `eachBond` rend. Sans elle (et sans polymère),
      // RIEN ne se remplit — la règle « l'atome suivant de la liste » n'existe plus.
      ...topologyOf(bonds, declare),
      ...(polymers ? { eachPolymer: polymerOf(CA_TRACE) } : {}),
    },
    matrix: { elements: IDENT16 },
    reprList: [{ repr: tubeRep }],
  }],
});

/* L'AUDIT DU PROXY : chaque sphère émise est soit un ATOME (la position exacte
   d'un atome), soit un REMPLISSAGE. Un remplissage doit tomber SUR une liaison
   réelle — sinon c'est un lien FANTÔME, la tache noire du rapport — et chaque
   liaison réelle doit porter au moins un remplissage, sinon le trait est TROUÉ
   (et un trait troué ne projette rien : mesuré dans _viewer_ray_shadows_test.mjs). */
const distToSegment = (p, a, b) => {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const len2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
  const u = len2 > 0 ? (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / len2 : 0;
  if (u <= 0.001 || u >= 0.999) return Infinity;      // les bouts : ce sont les atomes
  const q = [a[0] + ab[0] * u, a[1] + ab[1] * u, a[2] + ab[2] * u];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};

const bondName = (a, b) => `${nameOf(peptide, a)}-${nameOf(peptide, b)}`;
const audit = ({ bonds, declare, polymers = false, ref = REAL_BONDS }) => {
  const res = atomsFromStage(stageOf({ bonds, declare, polymers }), 1e5);
  const fills = [];
  let atoms = 0;
  for (let k = 0; k < res.count; k += 1) {
    const p = [res.positions[k * 3], res.positions[k * 3 + 1], res.positions[k * 3 + 2]];
    if (POS.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 1e-4)) atoms += 1;
    else fills.push(p);
  }
  const perBond = ref.map(([a, b]) => fills.filter((p) => distToSegment(p, POS[a], POS[b]) < 0.02).length);
  const onBond = (p) => ref.some(([a, b]) => distToSegment(p, POS[a], POS[b]) < 0.02);
  return {
    atoms,
    filled: res.filled,
    count: res.count,
    fills: fills.length,
    points: fills,
    phantom: fills.filter((p) => !onBond(p)).length,
    missing: ref.filter((_, i) => perBond[i] === 0).map(([a, b]) => bondName(a, b)),
    perBond,
  };
};
const fillsOf = (report, key) => report.perBond[REAL_BONDS.findIndex(([a, b]) => bondName(a, b) === key)];

const real = audit({ bonds: REAL_BONDS, declare: true });
eq(real.atoms, PEPTIDE_ATOMS.length, 'les 16 atomes dessinés sont émis (le tube les dessine tous)');
ok(real.filled > 0, '`filled` compte bien les remplissages (…sans eux un trait fin ne projette RIEN)');
eq(real.phantom, 0,
  'AUCUN remplissage hors d’une liaison réelle : plus de lien fantôme (le « disque noir » du rapport)');
eq(real.missing, [],
  '…et TOUTES les liaisons dessinées sont remplies, sans trou : le ruban est une ligne, pas une poussière');
ok(fillsOf(real, 'C1-N2') > 0 && fillsOf(real, 'C2-N3') > 0,
  '…LIAISONS PEPTIDIQUES COMPRISES : c’est ce qui recolle un résidu au suivant (les blobs séparés du rapport)');
ok(fillsOf(real, 'CB2-CG12') > 0 && fillsOf(real, 'CB2-CG22') > 0,
  '…et les BRANCHES latérales aussi (le bâton d’une chaîne latérale projette sa ligne, pas juste sa bille)');

/* ── 2 bis. LE GRAPHE, MÊME SANS `bondCount` ─────────────────────────────────
   LE MÊME peptide, LE MÊME graphe, la MÊME représentation — et une seule
   différence : la structure ne porte QUE `bondStore.count`, pas la copie
   `bondCount` que `finalizeBonds` en prend. Le module ne lit AUCUN compte : c'est
   `eachBond` qui décide, donc le proxy est EXACTEMENT celui de la structure
   complète (mêmes remplissages, aucun fantôme, aucune liaison ouverte). */
const stored = audit({ bonds: REAL_BONDS, declare: 'store' });
eq([stored.filled, stored.count], [real.filled, real.count],
  'un graphe déclaré par le seul `bondStore.count` remplit exactement comme la structure complète');
eq([stored.phantom, stored.missing], [0, []],
  '…sans un seul fantôme et sans laisser une liaison ouverte : le repli ne se déclenche PAS');
ok(fillsOf(stored, 'C1-N2') > 0 && fillsOf(stored, 'C2-N3') > 0,
  '…liaisons peptidiques comprises (ce qui recolle un résidu au suivant)');

/* ── 3. SANS GRAPHE : RIEN N'EST INVENTÉ, ET LE REPLI DE LA TRACE ────────────
   Le MÊME peptide, la MÊME représentation, et une seule différence : la structure
   ne déclare AUCUNE topologie (le cas `inferBonds: 'none'`, une structure fabriquée
   à la main). La règle « l'atome suivant de la liste », qui remplissait ces liens,
   a été RETIRÉE du module : c'est ELLE qui dessinait les liens fantômes du rapport
   (un atome de chaîne latérale relié au squelette du résidu suivant — mesuré sur
   l'ancienne version : 49 remplissages fantômes ET 5 liaisons réelles laissées
   ouvertes à la fois). Sans graphe, le module ne remplit donc plus rien par
   défaut : le repli sur la liste, c'était réinventer le défaut. */
const legacy = audit({ bonds: REAL_BONDS, declare: false });
eq([legacy.fills, legacy.phantom], [0, 0],
  'sans graphe ni polymère, le module ne remplit plus RIEN : zéro lien fantôme (la règle des voisins en donnait 49)');
eq(legacy.missing.length, REAL_BONDS.length,
  `…et les ${REAL_BONDS.length} liaisons restent ouvertes : rien n'est inventé (l'ancienne règle en laissait 5 ouvertes AVEC ses fantômes)`);
eq(legacy.atoms, PEPTIDE_ATOMS.length,
  '…les 16 atomes dessinés sont émis quand même : le dessin est là, seul le trait n’est pas bouché');

/* …ET LE SEUL REPLI QUI RESTE : LA TRACE DES POLYMÈRES. Une structure qui PORTE son
   graphe sans l'avoir rempli (c'est ce que `inferBonds: 'none'` laisse : `eachBond`
   existe et ne rend rien — un trace CA, un montage reconstruit) est remplie le long
   de sa TRACE : l'atome de trace de résidus CONSÉCUTIFS (voir drawnBondsOf). Les
   remplissages tombent donc sur CA(i)–CA(i+1), et jamais sur un lien de la LISTE :
   CB1–N2 (une chaîne latérale reliée au squelette du résidu suivant) est LE fantôme
   du rapport, et il n'existe pas.

   ⚠ LE REPLI VIT DANS LE CHEMIN « la structure SAIT dire ses liaisons » : sans
   `eachBond` du tout (le montage à la main du §3 ci-dessus, mesuré : 0 remplissage)
   il n'y a rien à interroger, et la trace n'est jamais lue. C'est ce que le module
   fait, et c'est ce que ces deux cas mesurent. */
const TRACE_BONDS = [[CA_TRACE[0], CA_TRACE[1]], [CA_TRACE[1], CA_TRACE[2]]];
const dist = (a, b) => Math.hypot(...[0, 1, 2].map((k) => POS[b][k] - POS[a][k]));
/* Le pas du module : la moitié du trait le plus fin (0,5 Å de tube → 0,25 Å),
   planché à LINK_STEP_MIN (0,3 Å) — donc 0,3 Å ici. */
const expectedTraceFills = TRACE_BONDS.reduce((a, [p, q]) => a + Math.max(0, Math.ceil(dist(p, q) / 0.3) - 1), 0);
const trace = audit({ bonds: [], declare: 'empty-graph', polymers: true, ref: TRACE_BONDS });
eq(trace.fills, expectedTraceFills,
  `la trace du polymère est bouchée (${expectedTraceFills} remplissages pour ses ${TRACE_BONDS.length} segments : ${TRACE_BONDS.map(([p, q]) => `${bondName(p, q)} à ${dist(p, q).toFixed(2)} Å`).join(', ')})`);
eq(trace.phantom, 0, '…AUCUN remplissage hors de la trace : ni CB1, ni aucun autre voisin de liste');
eq(trace.missing, [], '…et chacun des deux segments de trace porte au moins un remplissage');
const onTrace = (p) => TRACE_BONDS.some(([a, b]) => distToSegment(p, POS[a], POS[b]) < 0.05);
eq(trace.points.filter((p) => distToSegment(p, POS[4], POS[5]) < 0.02 && !onTrace(p)).length, 0,
  '…et le lien CB1–N2 de la LISTE (une chaîne latérale reliée au squelette du résidu suivant) n’est pas rempli : c’est le fantôme du rapport');

/* LE COMPTE N'EST PLUS LU DU TOUT : ce qui décide, c'est ce que `eachBond` rend. Un
   magasin VIDE dont le graphe porte les liaisons est donc rempli exactement comme
   la structure complète, et aucune structure sans graphe ne l'est par un `count`. */
const storedEmpty = audit({ bonds: REAL_BONDS, declare: 'store-empty' });
eq([storedEmpty.filled, storedEmpty.count, storedEmpty.phantom], [real.filled, real.count, 0],
  'un magasin de liaisons VIDE ne fait plus rien retomber : `eachBond` rend les 15 liaisons, elles sont remplies');

/* ── 4. LES DOUBLONS DU GRAPHE ───────────────────────────────────────────────
   Un fichier qui PORTE ses CONECT et se fait inférer ses liaisons donne la même
   paire deux fois : mesuré ci-dessous sur le peptide réel. Une paire remplie deux
   fois ne changerait rien à l'image, mais dépenserait deux fois le budget. */
const conectOf = (pairs, atomCount) => {
  const byAtom = new Map();
  for (let i = 1; i <= atomCount; i += 1) byAtom.set(i, []);
  pairs.forEach(([a, b]) => { byAtom.get(a + 1).push(b + 1); byAtom.get(b + 1).push(a + 1); });
  return [...byAtom.keys()].filter((a) => byAtom.get(a).length)
    .map((a) => `CONECT${String(a).padStart(5)}${byAtom.get(a).sort((x, y) => x - y).map((b) => String(b).padStart(5)).join('')}`)
    .join('\n');
};
const pdbWithConect = `${PEPTIDE_ATOMS.map((r, i) => pdbLine(i + 1, r)).join('\n')}\n`
  + `${conectOf(REAL_BONDS, PEPTIDE_ATOMS.length)}\nEND\n`;
const peptideConect = await load(pdbWithConect);
eq(peptideConect.bondCount, 17,
  'un PDB qui porte ses CONECT ET reçoit ses liaisons inférées en donne 17 pour 15 réelles (2 doublons)');
const dupe = audit({ bonds: [...REAL_BONDS, REAL_BONDS[0], REAL_BONDS[13]], declare: true });
eq([dupe.filled, dupe.count], [real.filled, real.count],
  'la même paire donnée deux fois n’est remplie qu’une fois : le graphe est dédoublonné');
ok(MODULE.includes('seen.has(key)') && MODULE.includes('seen.add(key)'),
  '…par construction, avec l’ensemble des paires déjà lues');


/* ── 5. LE BANC DU MODULE RESTE VRAI (LA TRACE CA SEULE) ─────────────────────
   Le module a été écrit et mesuré sur « 30 CA d'un tube de 0,5 Å » : une trace CA
   seule. Ce n'est PAS une structure sans topologie — NGL infère aussi les liaisons
   d'une trace CA (vérifié ci-dessous), donc le remplissage suit le graphe et la
   ligne reste continue. Le lien qu'un modèle de résidu peut faire apparaître entre
   deux CA éloignés (CA1–CA3, plus long que LINK_MAX) reste ouvert : aucun proxy en
   travers de la molécule. */
const caOnly = await load(PDB_CA_ONLY);
eq(caOnly.atomCount, 3, 'la trace CA seule fait 3 atomes');
const caKeys = bondKeys(caOnly, bondPairs(caOnly));
ok(caKeys.has('CA1-CA2') && caKeys.has('CA2-CA3'),
  'NGL infère CA(i)–CA(i+1) : le remplissage du banc « 30 CA » suit le graphe et reste continu');
const CA_POS = PEPTIDE_ATOMS.filter((r) => r[1] === 'CA').map((r) => [r[3], r[4], r[5]]);
const caBonds = bondPairs(caOnly);
const caStageOf = (bonds) => ({
  compList: [{
    structure: {
      atomCount: CA_POS.length,
      getAtomData: () => ({
        position: new Float32Array(CA_POS.flat()),
        radius: new Float32Array(CA_POS.length).fill(1.7),
      }),
      bondCount: bonds.length,
      eachBond: (cb) => bonds.forEach(([a, b]) => cb({ atomIndex1: a, atomIndex2: b })),
    },
    matrix: { elements: IDENT16 },
    reprList: [{ repr: { ...tubeRep, structureView: { getAtomIndices: () => Uint32Array.from([0, 1, 2]) } } }],
  }],
});
const caDistance = ([a, b]) => Math.hypot(...[0, 1, 2].map((k) => CA_POS[b][k] - CA_POS[a][k]));
const caShort = caBonds.filter((p) => caDistance(p) <= 4.2);      // LINK_MAX du module
const caLong = caBonds.filter((p) => caDistance(p) > 4.2);
ok(caLong.length >= 1,
  'le graphe d’une trace CA porte un lien LONG (le modèle des résidus en fabrique un : CA1–CA3 ici)');
const caAtoms = atomsFromStage(caStageOf(caBonds), 1e5);
const caShortAtoms = atomsFromStage(caStageOf(caShort), 1e5);
eq(caAtoms.count - 3, caAtoms.filled, 'les 3 atomes sont émis d’abord, les remplissages ensuite');
ok(caAtoms.filled >= 2, '…au moins un remplissage par liaison de la trace');
eq([caAtoms.filled, caAtoms.count], [caShortAtoms.filled, caShortAtoms.count],
  'le lien long ne remplit RIEN (au-delà de LINK_MAX) : le proxy est exactement celui des liaisons courtes');

/* ── 6. LA RÈGLE, DANS LE MODULE ───────────────────────────────────────────── */
ok(MODULE.includes('structure.eachBond('),
  'le module des ombres lit CE graphe (`structure.eachBond` → atomIndex1 / atomIndex2)');
ok(MODULE.includes('const drawnBondsOf = (structure, links, n) => {'),
  'le graphe est lu par une fonction à part, donc lisible et testable');
ok(MODULE.includes("typeof structure.eachBond !== 'function') return [];"),
  'sans `eachBond` il n’y a aucun lien à suivre : `[]`, et NON un repli sur la liste des atomes');
ok(MODULE.includes("typeof structure.eachPolymer === 'function'") && MODULE.includes('eachResidue') && MODULE.includes('r.traceAtomIndex'),
  '…le SEUL repli qui reste est la TRACE des polymères (`residueCount`, `eachResidue` → `traceAtomIndex`)');
ok(MODULE.includes('if (out.length === 0) {'),
  '…et il ne se déclenche que si le graphe n’a rien donné : une trace n’écrase jamais un vrai graphe');
ok(MODULE.includes('if (links[a] !== 1 || links[b] !== 1) return;'),
  '…et une liaison n’est un lien que si les DEUX atomes sont dessinés par un trait');
ok(MODULE.includes('const maxPairs = part.bonds ? part.bonds.length / 2 : 0;'),
  '…le calque ne fabrique plus de paires « voisins de la liste » quand la structure ne déclare rien');
ok(!MODULE.includes('Math.max(0, e - 1)') && !MODULE.includes('for (let s = 0; s + 1 < e; s += 1)'),
  'l’ancienne marche « l’atome suivant de la liste » a disparu du calque');
ok(!MODULE.includes('Number.isFinite(declared)'),
  '…et le compte déclaré n’est plus lu du tout : c’est `eachBond` qui décide, jamais `bondCount`');
ok(MODULE.includes('alone leaves holes ångströms wide that no ray can hit'),
  '…sans perdre le banc mesuré du module (0 pixel ombré sans remplissage, 3160 sans les trous)');
ok(MODULE.includes('THAT is the graph of the'),
  '…et le module dit POURQUOI c’est le graphe qui est suivi, et pas la liste des atomes');

/* ── Bilan ─────────────────────────────────────────────────────────────────── */
console.log(`_viewer_shadow_links_test.mjs — ${passed} assertions OK (les liens que l'ombre remplit)`);

