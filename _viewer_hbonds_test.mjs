/* =========================================================================
   _viewer_hbonds_test.mjs — LES DEUX DEMANDES DE CETTE SESSION :

     « in the section analysis of the viewer, add a button to display H-bonds. »
     « when hovering on an atom display not only the name but also the charge. »

   Ce que cette suite mesure, et pourquoi elle EXÉCUTE au lieu de relire :

     1. LA RÈGLE DES PONTS HYDROGÈNE EST PURE (utils/hydrogenBonds.js) et elle est
        EXÉCUTÉE sur des géométries construites à la main : un N–H···O linéaire est
        un pont, le même à 3,5 Å n'en est plus un, un donneur couché (angle < 120°)
        non plus ; une paire déjà liée (1-2), une paire 1-3 (le N–CA–C=O d'un
        peptide) et deux atomes d'un même résidu sont écartés — mais un atome SANS
        résidu garde ses ponts (le piège d'une clé « undefined|undefined| ») ; le
        solvant est laissé de côté (et rendu sur demande) ; SANS hydrogène la règle
        retombe sur la distance des lourds (D···A ≤ 3,5 Å), sans jamais compter un
        couple deux fois ; un couple donneur/accepteur n'apparaît qu'une fois même
        quand le donneur porte deux hydrogènes ; et le plafond du dessin tronque en
        gardant les distances les plus courtes.
     2. ELLE EST APPLIQUÉE À UNE VRAIE STRUCTURE, parsée par le NGL de la page
        (ngl 2.4, le même que le viewer) : le composant est lu comme dans l'appli
        (`{ structure }` comme la structure seule), le mode est dit, et la phrase du
        bouton (hydrogenBondNoteOf) raconte ce qui a été trouvé.
     3. LE BOUTON EXISTE DANS LA SECTION 📏 ANALYSIS et il DESSINE UNE SEULE
        représentation `distance` pour TOUS les ponts (jamais une par pont), étiquetée
        tant qu'ils sont peu nombreux ; il suit 📏 Measure jusqu'au bout —
        `clearHydrogenBonds()` accompagne CHAQUE `clearMeasurements()` du fichier,
        sinon une ligne survivrait à la molécule qu'elle relie.
     4. LE SURVOL DIT LA CHARGE, ET LA MÊME QUE LE ⚡ ESP : la mise en forme est
        pure (utils/viewerAtomReadout.js, exécutée), la charge vient de la table du
        ⚡ ESP (exécutée sur la même structure NGL), et une molécule dont RIEN ne
        décrit les charges n'écrit pas « 0 » — `atomHoverChargeOf` rend null là où
        `atomChargeOf` rend 0, parce que peindre en neutre et écrire « 0 » ne disent
        pas la même chose.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  hydrogenBondsOf, findHydrogenBonds, hydrogenBondRuleText, hydrogenBondNoteOf,
  HBOND_H_MAX, HBOND_DA_MAX, HBOND_ANGLE_MIN, HBOND_MAX_BONDS, HBOND_LABEL_MAX,
  WATER_RESNAMES, hydrogenBondElementOf,
} from './src/utils/hydrogenBonds.js';
import { atomChargeText, hoverAtomReadout, ATOM_CHARGE_DECIMALS } from './src/utils/viewerAtomReadout.js';

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

const SRC = new URL('./src/components/NMRMoleculeViewer.jsx', import.meta.url);
const VIEW = readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');
const has = (needle, what) => ok(VIEW.includes(needle), `${what}\n  introuvable : ${needle}`);

/* ── Extraction : les helpers PURS du viewer sont EXTRAITS puis EXÉCUTÉS, comme le
   fait _viewer_atom_charge_test.mjs (même comptage de profondeur sur un masque où
   les commentaires sont remplacés par des espaces). */
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

/* ══ 1. LA RÈGLE — PURE ET EXÉCUTÉE ═══════════════════════════════════════════ */
const atom = (element, pos, { resno = 1, resname = 'ALA', chain = 'A', name = element } = {}) => ({
  element, name, resname, resno, chain, pos,
});
// N–H···O linéaire : N (0,0,0) → H (1.01,0,0) → O (3.06,0,0), deux résidus.
const DONOR = atom('N', [0, 0, 0], { resno: 1 });
const HYDRO = atom('H', [1.01, 0, 0], { resno: 1 });
const ACCEPT = atom('O', [3.06, 0, 0], { resno: 2, resname: 'LIG' });
const linear = hydrogenBondsOf([DONOR, HYDRO, ACCEPT], [[0, 1]]);
eq(linear.bonds.length, 1, 'un N–H···O linéaire (r(H···A) = 2,05 Å) EST un pont hydrogène');
eq(linear.mode, 'explicit', '…et le mode est celui des structures qui portent leurs hydrogènes');
eq(linear.bonds[0].donor, 0, 'le donneur est l’azote');
eq(linear.bonds[0].hydrogen, 1, '…par l’intermédiaire de son hydrogène');
eq(linear.bonds[0].acceptor, 2, '…et l’accepteur est l’oxygène');
ok(Math.abs(linear.bonds[0].hDistance - 2.05) < 1e-9, 'la distance jugée est r(H···A) = 2,05 Å');
ok(Math.abs(linear.bonds[0].daDistance - 3.06) < 1e-9, '…et r(D···A) = 3,06 Å est rendue avec elle');
ok(Math.abs(linear.bonds[0].angle - 180) < 1e-6, 'l’angle D–H···A vaut 180°');
eq(linear.bonds[0].distance, linear.bonds[0].hDistance, 'la distance de tri est celle qui est jugée');
ok(HBOND_H_MAX === 2.5 && HBOND_DA_MAX === 3.5 && HBOND_ANGLE_MIN === 120,
  'les trois seuils de la règle sont ceux annoncés par le bouton (2,5 Å · 3,5 Å · 120°)');

// Trop loin : r(H···A) = 3,49 Å.
const far = hydrogenBondsOf([DONOR, HYDRO, atom('O', [4.5, 0, 0], { resno: 2 })], [[0, 1]]);
eq(far.bonds.length, 0, 'un H à 3,49 Å de l’accepteur n’est plus un pont (au-delà de 2,5 Å)');
// Donneur couché : r(H···A) = 2,00 Å mais angle 100°.
const bent = hydrogenBondsOf([DONOR, HYDRO, atom('O', [1.357, 1.9696, 0], { resno: 2 })], [[0, 1]]);
ok(Math.abs(Math.hypot(1.357 - 1.01, 1.9696) - 2) < 0.01, 'la sonde couchée est bien à 2,0 Å du H');
eq(bent.bonds.length, 0, '…et un angle de 100° la rejette : un donneur couché n’est pas un pont');
// 1-2 : l’accepteur est lié au donneur.
const bonded = hydrogenBondsOf([DONOR, HYDRO, atom('O', [1.2, 0, 0], { resno: 2 })], [[0, 1], [0, 2]]);
eq(bonded.bonds.length, 0, 'une paire 1-2 (déjà liée) n’est pas un pont hydrogène');
// 1-3 : N–C–…–O partagent un voisin (le motif du peptide) — mesuré en mode lourds.
const oneThree = hydrogenBondsOf(
  [atom('N', [0, 0, 0], { resno: 1 }), atom('C', [1.0, 0, 0], { resno: 1 }), atom('O', [0.5, 0.9, 0], { resno: 2 })],
  [[0, 1], [1, 2]], { includeSameResidue: true },
);
eq(oneThree.bonds.length, 0, 'une paire 1-3 (les deux liées au même atome) n’est pas un pont');
const spaced = hydrogenBondsOf(
  [atom('N', [0, 0, 0], { resno: 1 }), atom('O', [3.0, 0, 0], { resno: 2 })], [],
);
eq(spaced.bonds.length, 1, '…mais deux lourds à 3,0 Å sans voisin commun en sont un (mode lourds)');
// La grille des accepteurs est une OPTIMISATION : un couple à cheval sur une
// frontière de cellule (3,5 Å) doit être trouvé comme les autres.
const acrossCells = hydrogenBondsOf([
  atom('N', [3.2, 0, 0], { resno: 1 }), atom('H', [4.21, 0, 0], { resno: 1 }),
  atom('O', [6.26, 0, 0], { resno: 2 }),
], [[0, 1]]);
eq(acrossCells.bonds.length, 1, 'un pont à cheval sur deux cellules de la grille est trouvé (frontière à 3,5 Å)');
// …et elle doit rendre EXACTEMENT la même liste qu'un balayage exhaustif : on le
// vérifie sur 600 atomes tirés par un générateur DÉTERMINISTE (aucune liaison, donc
// aucune exclusion 1-2 / 1-3 à reproduire dans l’oracle).
{
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const crowd = [];
  const crowdBonds = [];
  const donors = [];
  const acceptors = [];
  for (let i = 0; i < 200; i += 1) {
    const p = [rnd() * 40, rnd() * 40, rnd() * 40];
    const n = crowd.length;
    crowd.push(atom('N', p, { resno: i * 2 + 1, resname: 'LIG' }));
    crowd.push(atom('H', [p[0] + 1.01, p[1], p[2]], { resno: i * 2 + 1, resname: 'LIG' }));
    crowdBonds.push([n, n + 1]);
    donors.push({ donor: n, hydrogen: n + 1 });
    const q = [rnd() * 40, rnd() * 40, rnd() * 40];
    acceptors.push(crowd.length);
    crowd.push(atom('O', q, { resno: i * 2 + 2, resname: 'LIG' }));
  }
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const angle = (a, b, c) => {
    const v1 = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const v2 = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
    const n1 = Math.hypot(...v1);
    const n2 = Math.hypot(...v2);
    return Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]) / (n1 * n2)))) * 180 / Math.PI;
  };
  const oracle = new Set();
  donors.forEach(({ donor, hydrogen }) => {
    acceptors.forEach((a) => {
      if (dist(crowd[hydrogen].pos, crowd[a].pos) > HBOND_H_MAX) return;
      if (angle(crowd[donor].pos, crowd[hydrogen].pos, crowd[a].pos) < HBOND_ANGLE_MIN) return;
      oracle.add(`${donor}|${a}`);
    });
  });
  const found600 = hydrogenBondsOf(crowd, crowdBonds);
  ok(found600.bonds.length > 5, `le tirage contient de vrais ponts (${found600.bonds.length}) — la comparaison mesure quelque chose`);
  eq(found600.bonds.map((b) => `${b.donor}|${b.acceptor}`).sort(), [...oracle].sort(),
    'la grille rend EXACTEMENT la liste du balayage exhaustif sur 600 atomes (mêmes ponts, ni plus ni moins)');
}
// Deux atomes du MÊME résidu : écartés par défaut, rendus sur demande.
const sameRes = [DONOR, HYDRO, atom('O', [3.06, 0, 0], { resno: 1 })];
eq(hydrogenBondsOf(sameRes, [[0, 1]]).bonds.length, 0, 'deux atomes du même résidu ne comptent pas par défaut');
eq(hydrogenBondsOf(sameRes, [[0, 1]], { includeSameResidue: true }).bonds.length, 1,
  '…et `includeSameResidue` les rend (le réglage existe, la règle est dite)');
// Deux atomes SANS résidu ne sont jamais « du même résidu » : le piège d’une clé
// « undefined|undefined| » qui avalerait tous les ponts d’un ligand nu.
const noRes = [
  { element: 'N', name: 'N', pos: [0, 0, 0] }, { element: 'H', name: 'H', pos: [1.01, 0, 0] },
  { element: 'O', name: 'O', pos: [3.06, 0, 0] },
];
eq(hydrogenBondsOf(noRes, [[0, 1]]).bonds.length, 1,
  'deux atomes sans numéro de résidu gardent leur pont (aucun résidu n’est inventé)');
// Le solvant : trois orthographes du même oxygène d’eau.
WATER_RESNAMES.slice(0, 3).forEach((resname) => {
  const wet = [DONOR, HYDRO, atom('O', [3.06, 0, 0], { resno: 2, resname })];
  eq(hydrogenBondsOf(wet, [[0, 1]]).bonds.length, 0, `l’eau (${resname}) est laissée de côté par défaut`);
  eq(hydrogenBondsOf(wet, [[0, 1]], { excludeWater: false }).bonds.length, 1,
    `…et rendue par \`excludeWater: false\` (${resname})`);
});
const wetDonor = [{ ...DONOR, resname: 'HOH' }, HYDRO, atom('O', [3.06, 0, 0], { resno: 2 })];
eq(hydrogenBondsOf(wetDonor, [[0, 1]]).bonds.length, 0, 'une eau qui DONNE est écartée elle aussi');
// Sans hydrogène : la distance des lourds, et un seul pont par couple.
const heavy = hydrogenBondsOf([DONOR, atom('O', [3.0, 0, 0], { resno: 2 })], []);
eq(heavy.mode, 'heavy', 'une structure sans aucun hydrogène passe en mode « lourds »');
eq(heavy.bonds.length, 1, '…le couple N···O est compté UNE fois (X→Y et Y→X sont le même pont)');
eq(heavy.bonds[0].hydrogen, null, '…sans hydrogène : rien n’est inventé');
eq(heavy.bonds[0].angle, null, '…ni aucun angle');
eq(hydrogenBondsOf([DONOR, atom('O', [3.6, 0, 0], { resno: 2 })], []).bonds.length, 0,
  'au-delà de 3,5 Å entre lourds, il n’y a plus de pont');
// Un carbone n’est ni donneur ni accepteur, même couvert d’hydrogènes.
eq(hydrogenBondsOf([
  atom('C', [0, 0, 0], { resno: 1 }), atom('H', [1.09, 0, 0], { resno: 1 }),
  atom('H', [-0.36, 1.03, 0], { resno: 1 }), atom('O', [3.06, 0, 0], { resno: 2 }),
], [[0, 1], [0, 2]]).bonds.length, 0, 'un carbone (même porteur d’hydrogènes) n’est jamais un donneur');
// Un donneur à DEUX hydrogènes ne compte qu’un pont avec le même accepteur.
const twoHsAtoms = (h2) => [
  atom('O', [0, 0, 0], { resno: 1, resname: 'HOH' }),
  atom('H', [0.96, 0, 0], { resno: 1, resname: 'HOH' }),
  atom('H', h2, { resno: 1, resname: 'HOH' }),
  atom('O', [3.01, 0, 0], { resno: 2, resname: 'LIG' }),
];
const twoHs = hydrogenBondsOf(twoHsAtoms([-0.33, 0.9, 0]), [[0, 1], [0, 2]], { excludeWater: false });
eq(twoHs.bonds.length, 1, 'un donneur à deux hydrogènes ne compte qu’UN pont pour un accepteur donné');
eq(twoHs.bonds[0].hydrogen, 1, '…c’est l’hydrogène qui pointe vers lui (le second est à 3,5 Å, il est rejeté)');
// Le doublon pur : deux hydrogènes portés par le même donneur ET dans la même
// direction (le cas limite) — l’invariant « un couple donneur/accepteur = un pont »
// tient quand même, et c’est ce que la table des ponts dessinés exige.
eq(hydrogenBondsOf(twoHsAtoms([0.96, 0, 0]), [[0, 1], [0, 2]], { excludeWater: false }).bonds.length, 1,
  'deux hydrogènes jumeaux sur le même donneur : toujours un seul pont avec cet accepteur');

// Le plafond, et l’ordre : du plus court au plus long.
const many = [];
const manyBonds = [];
for (let i = 0; i < 5; i += 1) {
  const n = i * 3;                                    // l’indice du premier atome du groupe i
  many.push(atom('N', [0, 0, i * 10], { resno: i * 2 + 1 }));
  many.push(atom('H', [1.01, 0, i * 10], { resno: i * 2 + 1 }));
  many.push(atom('O', [3.06 + i * 0.05, 0, i * 10], { resno: i * 2 + 2 }));
  manyBonds.push([n, n + 1]);
}
const capped = hydrogenBondsOf(many, manyBonds, { maxBonds: 2 });
eq(capped.bonds.length, 2, 'le plafond du dessin tronque la liste');
eq(capped.total, 5, '…et `total` dit combien de ponts existaient vraiment');
eq(capped.capped, true, '…`capped` le dit aussi');
ok(capped.bonds[0].distance <= capped.bonds[1].distance, 'les ponts gardés sont les plus courts (tri croissant)');
const allFive = hydrogenBondsOf(many, manyBonds);
eq(allFive.capped, false, 'sous le plafond, rien n’est tronqué');
ok(allFive.bonds.every((b, i) => i === 0 || allFive.bonds[i - 1].distance <= b.distance),
  'la liste entière est triée par distance croissante');
eq(HBOND_MAX_BONDS, 600, 'le plafond annoncé par l’infobulle est bien celui du module');
ok(HBOND_LABEL_MAX === 40, 'le seuil d’étiquetage des lignes est écrit, lui aussi');
// Rien de tout cela ne jette, même sur du vide ou du bricolage.
eq(hydrogenBondsOf([], []).bonds.length, 0, 'aucun atome : aucun pont, aucune exception');
eq(hydrogenBondsOf(null, null).bonds.length, 0, 'aucun argument : aucun pont, aucune exception');
eq(hydrogenBondsOf([DONOR, HYDRO], [[0, 1], [0, 99], [-1, 1], [1, 1]]).bonds.length, 0,
  'une liaison hors bornes ou un atome lié à lui-même est ignoré, jamais compté');
eq(hydrogenBondElementOf({ element: 'SE' }), 'SE', 'l’élément du bond store est lu tel quel');
eq(hydrogenBondElementOf({ atomname: 'CD1' }), 'C', '…et à défaut, la première lettre du nom d’atome');
// La phrase du bouton : elle dit la règle appliquée.
ok(hydrogenBondRuleText('explicit').includes('2.5') && hydrogenBondRuleText('explicit').includes('120°'),
  'la règle « avec hydrogènes » s’écrit avec ses deux seuils');
ok(hydrogenBondRuleText('heavy').includes('3.5'), 'la règle « lourds » s’écrit avec le sien');
ok(hydrogenBondRuleText('none').includes('no structure'), 'sans structure, la phrase le dit');
const note = hydrogenBondNoteOf('main', linear);
ok(note.includes('1 H-bond') && note.includes('main'), `la note compte les ponts et nomme la molécule (« ${note} »)`);
ok(note.includes('solvent left out'), '…et dit que le solvant a été laissé de côté');
ok(hydrogenBondNoteOf('main', { ...linear, options: { ...linear.options, excludeWater: false } }).includes('solvent included'),
  '…ou qu’il a été inclus, quand il l’a été');
ok(hydrogenBondNoteOf('main', capped).includes('2 shortest only'), 'un dessin tronqué le dit aussi');
ok(hydrogenBondNoteOf('main', { bonds: [], mode: 'explicit', options: {} }).includes('no H-bond found'),
  'aucun pont trouvé : la phrase le dit au lieu de ne rien dire');

/* ══ 2. LA MÊME RÈGLE SUR UNE VRAIE STRUCTURE NGL ═══════════════════════════
   Un petit PDB écrit colonne par colonne (l’en-tête PDB : nom 1-6, série 7-11,
   atome 13-16, résidu 17-20, chaîne 22, numéro 23-26, x·y·z 31-54, élément 77-78)
   et parsé par le NGL installé, celui de la page : N–H···O linéaire à 2,05 Å. */
globalThis.FileReader = class {
  readAsText(blob) {
    Promise.resolve(blob.text()).then((t) => {
      this.result = t;
      if (typeof this.onload === 'function') this.onload({ target: this });
    });
  }
};
const pdbAtom = (rec, serial, name, resname, chain, resno, [x, y, z], element) => (
  `${rec.padEnd(6)}${String(serial).padStart(5)} ${name.padStart(4)} ${resname.padEnd(3)} ${chain}${String(resno).padStart(4)}    `
  + `${x.toFixed(3).padStart(8)}${y.toFixed(3).padStart(8)}${z.toFixed(3).padStart(8)}`
  + `  1.00  0.00          ${element.padStart(2)}`
);
const hbondPdb = (acceptorName, resname, withH) => [
  pdbAtom('ATOM', 1, 'N', 'ALA', 'A', 1, [0, 0, 0], 'N'),
  ...(withH ? [pdbAtom('ATOM', 2, 'H', 'ALA', 'A', 1, [1.01, 0, 0], 'H')] : []),
  pdbAtom('HETATM', 3, 'C1', 'LIG', 'A', 2, [4.29, 0, 0], 'C'),
  pdbAtom('HETATM', 4, acceptorName, resname, 'A', 2, [3.06, 0, 0], 'O'),
  'CONECT    1    2',
  'CONECT    3    4',
  'END',
].join('\n');
const parsePdb = (text) => NGL.autoLoad(new Blob([text], { type: 'text/plain' }), { ext: 'pdb' });

const st = await parsePdb(hbondPdb('O1', 'LIG', true));
const found = findHydrogenBonds({ structure: st }, { excludeWater: true });
eq(found.mode, 'explicit', 'une structure qui porte son hydrogène est lue en mode « avec hydrogènes »');
eq(found.bonds.length, 1, 'le N–H···O écrit dans le fichier EST trouvé sur la structure de NGL');
eq(found.atoms.length, st.atomCount, 'chaque atome de la structure est lu (les indices des ponts s’y rapportent)');
eq(found.atoms[0].name, 'N', '…le premier atome est bien l’azote (les colonnes du PDB sont lues)');
eq(found.atoms[0].element, 'N', '…avec son élément');
eq(found.atoms[0].resno, 1, '…et son numéro de résidu');
ok(Math.abs(found.atoms[3].pos[0] - 3.06) < 1e-6, '…et l’accepteur est bien à 3,06 Å sur x');
eq(found.atoms[3].name, 'O1', '…c’est bien l’oxygène du ligand');
eq(found.atoms[3].resname, 'LIG', '…dans son propre résidu');
eq(found.bonds[0].donor, 0, 'le pont trouvé part de l’azote');
eq(found.bonds[0].hydrogen, 1, '…par son hydrogène (la liaison N–H du fichier est lue)');
eq(found.bonds[0].acceptor, 3, '…vers l’oxygène du ligand');
eq(found.bonds[0].angle.toFixed(1), '180.0', 'l’angle D–H···A mesuré sur la vraie structure vaut 180°');
// La structure seule (le VIEWER passe le composant, un test la structure) : même lecture.
eq(findHydrogenBonds(st, { excludeWater: true }).bonds, found.bonds, 'la structure SEULE donne exactement les mêmes ponts');
eq(findHydrogenBonds({}, {}).mode, 'none', 'sans structure lisible, la règle le dit (`mode: none`) au lieu de jeter');
ok(hydrogenBondNoteOf('the test molecule', found).startsWith('1 H-bond on the test molecule'),
  `la phrase du bouton nomme la molécule (« ${hydrogenBondNoteOf('the test molecule', found)} »)`);
// Le même fichier SANS hydrogène (le PDB de rayons X) : le repli sur les lourds.
const stHeavy = await parsePdb(hbondPdb('O1', 'LIG', false));
const heavyFound = findHydrogenBonds({ structure: stHeavy }, {});
eq(heavyFound.mode, 'heavy', 'sans aucun hydrogène, la structure réelle est lue en mode « lourds »');
eq(heavyFound.bonds.length, 1, '…et le couple N···O à 3,06 Å y est un pont (D···A ≤ 3,5 Å)');
eq(heavyFound.bonds[0].hydrogen, null, '…sans qu’aucun hydrogène ne soit inventé');
// Le solvant, tel qu’il s’écrit vraiment dans un fichier : HOH.
const stWater = await parsePdb(hbondPdb('O', 'HOH', true));
eq(findHydrogenBonds({ structure: stWater }, {}).bonds.length, 0, 'une eau acceptrice (HOH) est laissée de côté');
eq(findHydrogenBonds({ structure: stWater }, { excludeWater: false }).bonds.length, 1,
  '…et rendue par `excludeWater: false`, sur la vraie structure aussi');

/* ══ 3. LE BOUTON DANS LA SECTION 📏 ANALYSIS ════════════════════════════════
   Le JSX est vérifié par ses marqueurs (comme les autres suites du viewer) et le
   GESTE est extrait : ce qui compte, c'est qu'il n'ajoute qu'UNE représentation
   pour tous les ponts — une par pont ferait une scène de milliers d'objets. */
has("} from '../utils/hydrogenBonds';", 'le viewer importe la règle des ponts hydrogène');
has("import { hoverAtomReadout } from '../utils/viewerAtomReadout';", '…et la mise en forme du survol');
has('const toggleHydrogenBonds = () => {', 'le geste du bouton est nommé, donc testable');
has('onClick={toggleHydrogenBonds}', 'le bouton du groupe Analysis l’appelle');
has("{hbondsShown ? '💧 H-bonds: On' : '💧 H-bonds'}", '…et le bouton dit son état');
has("{hbondsShown ? 'bg-amber-100 border-amber-400 text-amber-900 ring-1 ring-amber-200'",
  '…il s’allume en ambre, la couleur des lignes qu’il dessine');
has("disabled={status !== 'ready'}", '…et il attend une structure (aucun pont ne se lit sur un viewer vide)');
has('{hbondMsg && (', 'le bouton dit AUSSI ce qu’il a trouvé, ou pourquoi il n’a rien trouvé');
has('const HBOND_READ_OPTS = { excludeWater: true };', 'le solvant est laissé de côté, et c’est écrit noir sur blanc');
has('atomPair: found.bonds.map((b) => [b.donor, b.acceptor])',
  'UNE seule représentation porte TOUS les ponts (jamais une par pont)');
has('labelVisible: found.bonds.length <= HBOND_LABEL_MAX',
  '…et elle n’écrit les distances que tant que les ponts sont peu nombreux');
has("const elem = comp.addRepresentation('distance', {",
  'le dessin est une représentation NGL `distance` — le même objet que 📏 Measure');
has('resolveMolComp(selectedMolKey)', '…sur la molécule CHOISIE dans la barre des Molecules, comme ⚡ ESP');
{
  const gesture = sliceFn(VIEW, 'toggleHydrogenBonds');
  eq((gesture.match(/addRepresentation\(/g) || []).length, 1, 'le geste n’ajoute qu’une représentation, jamais une par pont');
  ok(gesture.includes('hydrogenBondNoteOf(name, found)'), '…et sa phrase de compte rendu vient du module pur');
  ok(gesture.includes('hbondRepRef.current = { comp, elem }'),
    '…la représentation vivante est retenue pour pouvoir être retirée');
  ok(sliceFn(VIEW, 'clearHydrogenBonds').includes('hbondRepRef.current = null'),
    'le retrait oublie la référence (le bouton se rallume sans laisser de ligne orpheline)');
}
// LA VIE DES LIGNES : chaque `clearMeasurements()` du fichier est suivi du sien —
// sinon un pont survivrait à la molécule qu’il relie (nouveau chargement, PDB
// rangé, viewer vidé).
{
  const calls = [...VIEW.matchAll(/clearMeasurements\(\);/g)].map((m) => m.index);
  ok(calls.length >= 5, `les appels de clearMeasurements sont lus dans la source (${calls.length})`);
  calls.forEach((at, k) => ok(VIEW.slice(at, at + 260).includes('clearHydrogenBonds();'),
    `le ${k + 1}ᵉ clearMeasurements est suivi de clearHydrogenBonds (les lignes meurent avec leur molécule)`));
}
has('📏 Measure · 💧 H-bonds · 🟢 Assigned', 'le §2 annonce le nouveau bouton dans la ligne du groupe Analysis');

/* ══ 4. LE SURVOL DIT LA CHARGE — LA MÊME QUE LE ⚡ ESP ══════════════════════
   La mise en forme est PURE et exécutée ; la charge est lue par les helpers du
   viewer, EXTRAITS puis EXÉCUTÉS sur la même structure NGL que la section 2. */
eq(ATOM_CHARGE_DECIMALS, 3, 'la charge s’écrit au millième d’électron');
eq(atomChargeText(0.2564), '+0.256 e', 'une charge positive s’écrit avec son signe');
eq(atomChargeText(-0.834), `${String.fromCharCode(0x2212)}0.834 e`, '…une charge négative avec le VRAI signe moins (U+2212), jamais un tiret');
eq(atomChargeText(1), '+1.000 e', '…un sodium vaut +1.000 e, pas « 1 e »');
eq(atomChargeText(0), '0.000 e', 'le zéro ne porte AUCUN signe (un signe y serait du bruit)');
eq(atomChargeText(-0.0004), '0.000 e', '…et une charge qui arrondit à zéro n’écrit pas « −0.000 »');
[null, undefined, NaN, Infinity, 'x', {}].forEach((bad) => eq(atomChargeText(bad), '',
  `une charge absente ou illisible (${String(bad)}) ne s’écrit pas du tout`));
eq(hoverAtomReadout('ALA 1 CB', 0.2564), 'ALA 1 CB · q = +0.256 e',
  'le survol écrit le nom, puis ce que l’atome porte');
eq(hoverAtomReadout('ALA 1 CB', null), 'ALA 1 CB', 'sans charge connue la phrase s’arrête au nom — jamais « q = » sans nombre');
eq(hoverAtomReadout('  ', 1), 'q = +1.000 e', 'un nom vide ne laisse pas un séparateur orphelin');

const APP = new Function('NGL', [
  'const window = { NGL };   // le code extrait lit `window.NGL`, comme dans la page',
  sliceDecl(VIEW, 'ESP_MAX_RADIUS'),
  sliceDecl(VIEW, 'ESP_KCAL'),
  sliceDecl(VIEW, 'ESP_NEUTRAL_REFERENCE'),
  sliceDecl(VIEW, 'ESP_CHARGE_PER_UNIT'),
  sliceObject(VIEW, 'ESP_ELECTRONEGATIVITY'),
  sliceObject(VIEW, 'ESP_ION_CHARGES'),
  sliceFn(VIEW, 'espHeteroChargeOf'),
  sliceDecl(VIEW, 'espChargeCache'),
  sliceFn(VIEW, 'espChargesFor'),
  sliceFn(VIEW, 'atomChargeOf'),
  sliceFn(VIEW, 'atomHoverChargeOf'),
  'return { espChargesFor, atomChargeOf, atomHoverChargeOf };',
].join('\n'))(NGL);
const table = APP.espChargesFor(st);
ok(!!table, 'la table de charges du ⚡ ESP se calcule sur la structure de test');
eq(APP.atomHoverChargeOf({ index: 0 }, st), table.charges[0],
  'le survol lit EXACTEMENT la charge du ⚡ ESP (une seule table pour les deux)');
eq(APP.atomChargeOf({ index: 0 }, st), table.charges[0], '…la même valeur que celle de la coloration « Atom charge »');
eq(APP.atomHoverChargeOf(null, st), null, 'sans atome : rien à dire (null)');
eq(APP.atomHoverChargeOf({}, st), null, 'un atome sans index : rien à dire — jamais la charge de l’atome 0');
eq(APP.atomHoverChargeOf({ index: 0 }, null), null, 'sans structure : rien à dire');
eq(APP.atomChargeOf({ index: 0 }, null), 0,
  '…là où la lecture de PEINTURE rend 0 : le neutre est le bon repli d’une couleur, pas d’une phrase');
ok(hoverAtomReadout('ALA A 1 N', APP.atomHoverChargeOf({ index: 0 }, st)).startsWith('ALA A 1 N · q = '),
  'sur la vraie structure, le survol écrit le nom ET la charge, dans cet ordre');
// Le câblage du survol dans le viewer : le nom existait, la charge s’y ajoute.
has('const label = hoverAtomReadout(name, atomHoverChargeOf(atom, structure));',
  'le lecteur de survol du viewer passe par la fonction pure (nom + charge)');
has('const structure = (pickingProxy.component && pickingProxy.component.structure) || atom.structure || null;',
  '…la structure de l’atome survolé est celle du composant piqué');
has('const atomHoverChargeOf = (atom, structure) => {', 'la lecture « charge au survol » est nommée, donc testable');
has("{hoverInfo && status === 'ready' && (", 'la lecture ne s’affiche que sur une scène prête');

console.log(`_viewer_hbonds_test.mjs — ${passed} assertions OK`);