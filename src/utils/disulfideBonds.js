/* ============================================================================
   src/utils/disulfideBonds.js
   ⚭ « Disulfides: shown / hidden » — LA RÈGLE QUI RETIRE LE PONT DU DESSIN.

   Ce que le bouton du viewer demande, et ce que ce module fait : LIRE les ponts
   disulfure qu'une structure DESSINE et, quand on les cache, les RETIRER de son
   graphe de liaisons — donc des Sticks / Ball+stick / Lines, qui lisent ce
   graphe au moment où ils sont construits.

   Pourquoi le graphe, et pas le texte PDB : ngl@2.4.0 n'a AUCUNE visibilité par
   liaison. Un CONECT est fondu dans le bond store de la structure au chargement,
   une représentation ne sait filtrer que des ATOMES, il n'existe pas même un
   « removeBond » — et retirer le CONECT du texte ne suffirait pas : la passe de
   distances de NGL (inferBonds:'all', le défaut du parseur PDB) REDESSINERAIT le
   pont dès que les deux Sγ sont dans la fenêtre covalente. En revanche le store
   est un tableau plat de paires d'indices que l'application compacte DÉJÀ pour
   ses propres règles (utils/hydrogenBondRule.js retire ainsi les liaisons
   impossibles d'un hydrogène, utils/proteinBondRule.js les cycles impossibles
   d'une protéine) : retirer un pont disulfure est exactement le même geste, au
   même endroit — AVANT qu'une seule représentation ne lise le graphe.

   Ce qui n'est donc JAMAIS touché : le fichier PDB, le texte servi par la page,
   le 📥 Download, la copie Drive, la définition des paires dans « Cysteine
   states ». Cacher le pont est une question de DESSIN, pas de contenu — et un
   lecteur qui recharge le modèle retrouve ses ponts intacts.

   Ce que la règle appelle un pont : une liaison entre DEUX atomes nommés SG
   appartenant à DEUX RÉSIDUS DIFFÉRENTS. Ni la distance ni l'origine de la
   liaison ne comptent : le pont écrit par la page (le CONECT SG–SG de
   proteinSequenceToPdbText, NMRSections.jsx) et celui qu'une passe de distances a
   deviné dans un vrai PDB sont la MÊME chose à l'écran — c'est cette chose-là que
   l'interrupteur cache. La distance Sγ–Sγ RÉELLE est rendue avec chaque pont : le
   bouton la dit au spectateur (2.05 Å « bonded », 18.4 Å « stretched ») ; il ne
   la juge pas ici, la fenêtre de liaison restant celle de utils/disulfideFold.js
   (SS_BOND_LENGTH / SS_BOND_TOLERANCE) — une seule définition de « pont fermé ».

   Module PUR (aucun import, comme tous les utils) : le cœur testable
   (`disulfideBondIndices`) travaille sur des tableaux d'atomes et de liaisons
   déjà lus ; `applyDisulfideDisplay` n'est que l'enveloppe qui lit et écrit un
   bond store NGL, comme les deux règles voisines.
   ========================================================================= */

export const SG_ATOM_NAME = 'SG';

// Un atome de soufre de chaîne latérale : le nom d'atome PDB d'une cystéine
// (CYS comme CYX, et le SG de tout fichier qui en porte un).
const isSg = (atom) => !!atom && String(
  atom.name != null ? atom.name : (atom.atomname != null ? atom.atomname : ''),
).trim().toUpperCase() === SG_ATOM_NAME;

// Deux atomes appartiennent au même résidu quand chaîne + numéro + code
// d'insertion coïncident — la même lecture que le reste de l'application.
const residueKey = (atom) => `${atom.chain != null ? atom.chain : (atom.chainname != null ? atom.chainname : '')}|${atom.resno}|${atom.icode || ''}`;

const dist3 = (a, b) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);

/**
 * LES LIAISONS QUI DESSINENT UN PONT DISULFURE — le cœur de la règle, testable
 * sur de simples tableaux.
 *
 * @param {Array<{name?:string,atomname?:string,resno:number,chain?:string,chainname?:string,icode?:string}>} atoms
 * @param {Array<[number,number]>} bonds paires d'INDICES d'atomes
 * @returns {number[]} les indices (dans `bonds`) des liaisons Sγ–Sγ inter-résidus
 */
export const disulfideBondIndices = (atoms, bonds) => {
  const out = [];
  (Array.isArray(bonds) ? bonds : []).forEach((bond, k) => {
    const i = bond && bond[0];
    const j = bond && bond[1];
    const a = atoms ? atoms[i] : null;
    const b = atoms ? atoms[j] : null;
    if (!isSg(a) || !isSg(b)) return;                 // pas deux Sγ : pas un pont
    if (residueKey(a) === residueKey(b)) return;      // deux SG du MÊME résidu : pas un pont
    out.push(k);
  });
  return out;
};


// Le graphe d'une structure CHARGÉE, lu comme les deux règles voisines : les
// atomes par getAtomProxy, les liaisons par le bond store (un tableau plat).
const readGraph = (componentOrStructure) => {
  const structure = componentOrStructure && componentOrStructure.structure
    ? componentOrStructure.structure
    : componentOrStructure;
  if (!structure || !structure.bondStore) return null;
  const store = structure.bondStore;
  const bondCount = store.count || 0;
  const atomCount = structure.atomCount || 0;
  if (!bondCount || !atomCount || typeof structure.getAtomProxy !== 'function') {
    return { structure, store, atoms: [], bonds: [], empty: true };
  }
  const ap = structure.getAtomProxy();
  const atoms = [];
  for (let i = 0; i < atomCount; i++) {
    ap.index = i;
    atoms.push({
      name: ap.atomname,
      element: ap.element,
      resname: ap.resname,
      resno: ap.resno,
      icode: ap.icode,
      chain: ap.chainname != null ? ap.chainname : ap.chain,
      pos: [ap.x, ap.y, ap.z],
    });
  }
  const bonds = [];
  for (let k = 0; k < bondCount; k++) bonds.push([store.atomIndex1[k], store.atomIndex2[k]]);
  return { structure, store, atoms, bonds, empty: false };
};

// Un pont, tel que le bouton le raconte : les deux résidus et la distance Sγ–Sγ
// RÉELLE de la géométrie servie (null quand un Sγ n'a pas de coordonnées).
const bridgeOf = (atoms, bonds, k) => {
  const i1 = bonds[k][0];
  const i2 = bonds[k][1];
  const a = atoms[i1] || {};
  const b = atoms[i2] || {};
  const finite = Array.isArray(a.pos) && Array.isArray(b.pos)
    && a.pos.every(Number.isFinite) && b.pos.every(Number.isFinite);
  return {
    atomIndex1: i1,
    atomIndex2: i2,
    resno1: a.resno,
    resno2: b.resno,
    chain1: a.chain || '',
    chain2: b.chain || '',
    resname1: a.resname || '',
    resname2: b.resname || '',
    distance: finite ? dist3(a.pos, b.pos) : null,
  };
};

/**
 * LA RÈGLE, appliquée à un composant NGL (ou à sa structure) chargé.
 *
 * Rend `{ bonds, removed }` : les ponts que la structure DESSINE (l'objet du
 * bouton, avec la distance Sγ–Sγ de l'écran) et combien ont été sortis du graphe
 * quand `hidden` est vrai. `removed: 0` veut toujours dire « le graphe est
 * intact » — cacher ne modifie rien d'autre, et rien du tout quand il n'y a pas
 * de pont à cacher.
 *
 * La compaction est celle de utils/hydrogenBondRule.js : le bond store est un
 * tableau plat (atomIndex1 / atomIndex2 / bondOrder + count), donc retirer les
 * entrées et baisser le compte EST l'édition complète ; `finalizeBonds()` remet
 * ensuite le bond set et le hash d'aplomb pour les lecteurs qui passent par eux
 * (eachBondedAtom, les sélections « bonded », la découpe CONECT en molécules).
 *
 * @param {object} componentOrStructure un NGL.Component, ou sa structure
 * @param {{ hidden?: boolean }} [options] hidden = les ponts ne sont plus dessinés
 * @returns {{ bonds: object[], removed: number }}
 */
export const applyDisulfideDisplay = (componentOrStructure, { hidden = false } = {}) => {
  const graph = readGraph(componentOrStructure);
  if (!graph || graph.empty) return { bonds: [], removed: 0 };
  const { structure, store, atoms, bonds } = graph;
  const indices = disulfideBondIndices(atoms, bonds);
  const found = indices.map((k) => bridgeOf(atoms, bonds, k));
  if (!hidden || indices.length === 0) return { bonds: found, removed: 0 };

  const drop = new Set(indices);
  let w = 0;
  bonds.forEach((bond, k) => {
    if (drop.has(k)) return;
    store.atomIndex1[w] = bond[0];
    store.atomIndex2[w] = bond[1];
    if (store.bondOrder) store.bondOrder[w] = store.bondOrder[k];
    w += 1;
  });
  store.count = w;
  try { structure.bondCount = w; } catch { /* le store lui-même est ce qu'un lecteur voit */ }
  if (typeof structure.finalizeBonds === 'function') structure.finalizeBonds();
  return { bonds: found, removed: indices.length };
};
