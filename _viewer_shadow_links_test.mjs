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
     3. L'ANCIEN DÉFAUT, REPRODUIT : le même peptide SANS topologie déclarée (le
        repli) remplit des liens qui ne sont pas des liaisons et laisse les deux
        liaisons peptidiques ouvertes — les blobs séparés du rapport. C'est
        pourquoi le graphe est lu, et pourquoi le repli ne concerne QUE les
        structures qui ne déclarent aucun graphe ;
     4. LES DOUBLONS : un fichier qui porte des CONECT ET se fait inférer ses
        liaisons donne la même paire deux fois (mesuré : 17 liaisons pour 15
        réelles) — elle n'est remplie qu'une fois ;
     5. LE BANC DU MODULE RESTE VRAI : une trace CA seule porte elle aussi ses
        liaisons (l'ancien banc des ombres est « 30 CA d'un tube de 0,5 Å »).
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
const stageOf = ({ bonds, declare }) => ({
  compList: [{
    structure: {
      atomCount: POS.length,
      getAtomData: () => ({ position: POSITION, radius: RADIUS }),
      // La topologie : `bondCount` ET `eachBond`, exactement comme une structure
      // NGL réelle. Sans elle, le module retombe sur la règle des voisins.
      ...(declare
        ? { bondCount: bonds.length, eachBond: (cb) => bonds.forEach(([a, b]) => cb({ atomIndex1: a, atomIndex2: b })) }
        : {}),
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
const audit = ({ bonds, declare }) => {
  const res = atomsFromStage(stageOf({ bonds, declare }), 1e5);
  const fills = [];
  let atoms = 0;
  for (let k = 0; k < res.count; k += 1) {
    const p = [res.positions[k * 3], res.positions[k * 3 + 1], res.positions[k * 3 + 2]];
    if (POS.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 1e-4)) atoms += 1;
    else fills.push(p);
  }
  const perBond = bonds.map(([a, b]) => fills.filter((p) => distToSegment(p, POS[a], POS[b]) < 0.02).length);
  const onBond = (p) => bonds.some(([a, b]) => distToSegment(p, POS[a], POS[b]) < 0.02);
  return {
    atoms,
    filled: res.filled,
    count: res.count,
    fills: fills.length,
    phantom: fills.filter((p) => !onBond(p)).length,
    missing: bonds.filter((_, i) => perBond[i] === 0).map(([a, b]) => bondName(a, b)),
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

/* ── 3. L'ANCIEN DÉFAUT, REPRODUIT (LE REPLI) ────────────────────────────────
   Le MÊME peptide, la MÊME représentation, et une seule différence : la structure
   ne déclare AUCUNE topologie (c'est le cas `inferBonds: 'none'`, une structure
   fabriquée à la main). Le module retombe alors sur la règle historique — le
   suivant de la liste — et le défaut du rapport réapparaît : c'est à la fois la
   preuve que la règle historique était bien la cause, et la démonstration que le
   repli ne concerne QUE les structures sans graphe (une structure qui déclare son
   graphe n'y retombe jamais, même si ses atomes dessinés ne sont pas liés). */
const legacy = audit({ bonds: REAL_BONDS, declare: false });
ok(legacy.phantom >= 10,
  `sans graphe, « l’atome suivant de la liste » remplit des liens qui NE SONT PAS des liaisons (${legacy.phantom} fantômes ici)`);
ok(legacy.missing.includes('C1-N2') && legacy.missing.includes('C2-N3'),
  '…et il laisse les DEUX liaisons peptidiques ouvertes : un amas par résidu, aucun pont — les blobs du rapport');
ok(legacy.missing.length > real.missing.length,
  `…soit ${legacy.missing.length} liaisons non remplies contre ${real.missing.length} avec le graphe`);
eq(legacy.fills, legacy.filled, '…et le compte annoncé reste celui qui est émis (le budget suit les remplissages)');

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
ok(MODULE.includes("typeof structure.eachBond !== 'function'"),
  'le repli est décidé par la TOPOLOGIE déclarée…');
ok(MODULE.includes('Number.isFinite(declared) && declared > 0'),
  '…(`bondCount` : un graphe déclaré mais vide ne fait PAS retomber sur la liste des atomes)');
ok(MODULE.includes('if (links[a] !== 1 || links[b] !== 1) return;'),
  '…et une liaison n’est un lien que si les DEUX atomes sont dessinés par un trait');
ok(!MODULE.includes('if (e + 1 < lay.len && lay.wlink[e] && lay.wlink[e + 1])'),
  'l’ancienne marche « l’atome suivant de la liste » a disparu du remplissage');
ok(MODULE.includes('alone leaves holes ångströms wide that no ray can hit'),
  '…sans perdre le banc mesuré du module (0 pixel ombré sans remplissage, 3160 sans les trous)');
ok(MODULE.includes('THAT is the graph of the'),
  '…et le module dit POURQUOI c’est le graphe qui est suivi, et pas la liste des atomes');

/* ── Bilan ─────────────────────────────────────────────────────────────────── */
console.log(`_viewer_shadow_links_test.mjs — ${passed} assertions OK (les liens que l'ombre remplit)`);

