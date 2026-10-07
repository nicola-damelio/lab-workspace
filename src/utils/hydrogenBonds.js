/* =========================================================================
   src/utils/hydrogenBonds.js
   💧 « H-bonds » — LES LIAISONS HYDROGÈNE LUES SUR LA GÉOMÉTRIE DE L'ÉCRAN.

   La demande : « in the section analysis of the viewer, add a button to display
   H-bonds. » Ce module EST la règle de ce bouton ; le viewer ne fait que la
   dessiner (UNE seule représentation NGL `distance`, une ligne par pont — voir
   `toggleHydrogenBonds` dans NMRMoleculeViewer.jsx). Comme tous les utils de la
   maison, le cœur est PUR — `hydrogenBondsOf` travaille sur des tableaux d'atomes
   et de liaisons DÉJÀ LUS, donc un test peut le faire tourner sans NGL — et
   `findHydrogenBonds` n'est que l'enveloppe qui lit un composant NGL, exactement
   comme les trois règles voisines (utils/hydrogenBondRule.js,
   utils/proteinBondRule.js, utils/disulfideBonds.js).

   CE QU'UN PONT VAUT ICI — deux modes, parce qu'un fichier n'est pas l'autre :

   * LA STRUCTURE PORTE SES HYDROGÈNES (un modèle bâti par la page, un PDB avec H
     — le cas de l'écran après ⚗️ Rebuild H). Donneur = N · O · S qui porte au
     moins un H ; accepteur = N · O · S qui n'en porte AUCUN — un groupe qui a
     gardé son hydrogène DONNE, il n'accepte pas. Critères : r(H···A) ≤ 2,5 Å ET
     angle D–H···A ≥ 120°.

   * LA STRUCTURE N'EN PORTE AUCUN (un PDB de rayons X, un ligand nu) : il n'y a
     pas d'hydrogène à mesurer. Donneurs et accepteurs sont donc TOUS les N · O · S
     et le critère retombe sur la distance des lourds, r(D···A) ≤ 3,5 Å — le repli
     classique, et le même esprit que DSSP, qui reconstruit l'amide N–H qu'il n'a
     pas avant de juger (MDSecondaryStructure.js). Le mode retenu est RENDU avec le
     résultat (`mode`), donc le bouton peut dire à l'écran ce qu'il a jugé.

   Ce qui n'est JAMAIS un pont, dans les deux modes :
     · un atome avec lui-même ;
     · une paire déjà liée (1-2) — la liaison covalente ;
     · une paire 1-3 (les deux liées au MÊME atome) : le N–CA–C=O d'une liaison
       peptidique est à 2,4 Å et n'est pas un pont ;
     · deux atomes du MÊME résidu, sauf demande explicite (`includeSameResidue`) :
       les ponts qui comptent relient des résidus différents ;
     · le SOLVANT (HOH · WAT · TIP3 · SPC …), sauf demande explicite
       (`excludeWater: false`) : une seule coquille d'eau fait plus de ponts que
       toute la protéine, et le bouton doit montrer la protéine.
   Un couple donneur/accepteur n'apparaît qu'UNE fois : un oxygène d'eau porte deux
   hydrogènes et deux angles, on garde le MEILLEUR (le plus court r(H···A)).

   DESSIN ET PLAFOND. Le bouton dessine la ligne D···A — le pont tel qu'on le
   regarde dans PyMOL — et la trie par distance croissante ; au-delà de
   HBOND_MAX_BONDS (600, un frame très solvaté peut en compter des milliers) seuls
   les plus courts sont dessinés et `capped` le dit. Les nombres restent lisibles :
   chaque ligne est étiquetée de sa distance tant qu'il y en a peu
   (HBOND_LABEL_MAX), au-delà les lignes seules — un mur de chiffres cacherait la
   structure qu'on est venu regarder.

   RIEN N'EST MODIFIÉ : ce module LIT (il rend des indices d'atomes) ; ni le texte
   PDB, ni le graphe de liaisons, ni un style ne sont touchés — c'est la différence
   avec les trois règles voisines, qui retirent des liaisons du graphe avant que
   NGL ne les dessine.
   ========================================================================= */

/** Les trois éléments qui donnent et qui acceptent, en biologie : N · O · S. */
export const HBOND_ELEMENTS = ['N', 'O', 'S'];

/** r(H···A) maximum, en Å — le critère du mode « avec hydrogènes ». */
export const HBOND_H_MAX = 2.5;
/** r(D···A) maximum, en Å — le critère du mode « sans hydrogène ». */
export const HBOND_DA_MAX = 3.5;
/** L'angle D–H···A minimal, en degrés — un donneur couché n'est pas un pont. */
export const HBOND_ANGLE_MIN = 120;
/** Le plafond du dessin : au-delà, seules les distances les plus courtes restent. */
export const HBOND_MAX_BONDS = 600;
/** Jusqu'à ce nombre de ponts, chaque ligne porte sa distance (voir le viewer). */
export const HBOND_LABEL_MAX = 40;

/** Les dénominations du solvant selon les fichiers (PDB · GROMACS · CHARMM · SPC). */
export const WATER_RESNAMES = [
  'HOH', 'WAT', 'H2O', 'DOD', 'D2O', 'SOL', 'TIP', 'TIP3', 'TIP4', 'T3P', 'T4P',
  'SPC', 'SPCE', 'W', 'OH2',
];

/** L'élément d'un atome : le champ `element` de NGL d'abord, sinon la première
 *  lettre du nom — la même lecture que utils/hydrogenBondRule.js. */
export const hydrogenBondElementOf = (atom) => {
  const e = String((atom && atom.element != null ? atom.element : '') || '')
    .replace(/[^A-Za-z]/g, '').toUpperCase();
  if (e) return e;
  const name = String((atom && (atom.name != null ? atom.name : atom.atomname)) || '');
  const m = /[A-Za-z]/.exec(name);
  return m ? m[0].toUpperCase() : '';
};

const isHydrogenElement = (e) => e === 'H' || e === 'D';

/** La position d'un atome : `pos` ([x, y, z]) ou les trois champs `x` · `y` · `z`. */
const posOf = (atom) => {
  if (Array.isArray(atom && atom.pos)) return atom.pos;
  return [atom && atom.x, atom && atom.y, atom && atom.z];
};

const dist3 = (a, b) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);

/** L'angle a-b̂-c en degrés (le sommet est b), ou null quand il est indéfini. */
const angleAt = (a, b, c) => {
  const v1 = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const v2 = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
  const n1 = Math.sqrt(v1[0] ** 2 + v1[1] ** 2 + v1[2] ** 2);
  const n2 = Math.sqrt(v2[0] ** 2 + v2[1] ** 2 + v2[2] ** 2);
  if (!(n1 > 1e-6) || !(n2 > 1e-6)) return null;
  const cos = (v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]) / (n1 * n2);
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
};

/** La clé d'un résidu — VIDE quand l'atome n'en porte pas : deux atomes sans
 *  résidu ne sont jamais « du même résidu » (un ligand nu garde ses ponts). */
const residueKeyOf = (atom) => {
  const resno = atom && atom.resno;
  if (resno === null || resno === undefined || resno === '') return '';
  const chain = atom.chain != null ? atom.chain : (atom.chainname != null ? atom.chainname : '');
  return `${chain}|${resno}|${(atom && atom.icode) || ''}`;
};

const resnameOf = (atom) => String((atom && atom.resname) || '').trim().toUpperCase();

const isWaterResname = (name) => WATER_RESNAMES.includes(name);

/** Deux ensembles ont-ils un voisin commun (une paire 1-3) ? On parcourt le plus
 *  petit des deux : un carbone en a quatre, un ion parfois un seul. */
const sharesANeighbour = (a, b) => {
  if (!a || !b || a.size === 0 || b.size === 0) return false;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const k of small) if (big.has(k)) return true;
  return false;
};

/**
 * LES PONTS D'UN JEU D'ATOMES ET DE LIAISONS — le cœur de la règle, PUR.
 *
 * @param {Array<object>} atoms par indice : `{ element?, name?, atomname?, resname?,
 *        resno?, chain?, chainname?, icode?, pos? | x·y·z }`
 * @param {Array<[number, number, number?]>} bonds paires d'indices (+ ordre)
 * @param {{ includeSameResidue?: boolean, excludeWater?: boolean, maxBonds?: number }} [opts]
 * @returns {{ bonds: object[], mode: 'explicit'|'heavy', capped: boolean, total: number,
 *             options: object }} — chaque pont : `{ donor, acceptor, hydrogen,
 *          hDistance, daDistance, distance, angle }` ; `hydrogen` / `hDistance` /
 *          `angle` valent null sans hydrogène, et `distance` est LA distance jugée
 *          (r(H···A) en mode explicite, r(D···A) en mode lourds).
 */
export const hydrogenBondsOf = (atoms, bonds, {
  includeSameResidue = false,
  excludeWater = true,
  maxBonds = HBOND_MAX_BONDS,
} = {}) => {
  const list = Array.isArray(atoms) ? atoms : [];
  const n = list.length;
  const options = { includeSameResidue, excludeWater, maxBonds };
  if (!n) return { bonds: [], mode: 'heavy', capped: false, total: 0, options };

  // 1) LE GRAPHE : un ensemble de voisins par atome — jamais un indice hors
  //    bornes, jamais un atome lié à lui-même.
  const neigh = new Array(n);
  for (let i = 0; i < n; i += 1) neigh[i] = null;
  const pairs = [];
  (Array.isArray(bonds) ? bonds : []).forEach((bond) => {
    const i = bond && bond[0];
    const j = bond && bond[1];
    if (!Number.isInteger(i) || !Number.isInteger(j) || i === j) return;
    if (i < 0 || j < 0 || i >= n || j >= n) return;
    if (!neigh[i]) neigh[i] = new Set();
    if (!neigh[j]) neigh[j] = new Set();
    neigh[i].add(j);
    neigh[j].add(i);
    pairs.push([i, j]);
  });

  // 2) LES ÉLÉMENTS, ET LA QUESTION QUI DÉCIDE DU MODE : cette structure
  //    porte-t-elle un seul hydrogène ? Les H ne sont lus que si oui — sur un
  //    PDB de rayons X il n'y a rien à lire, et rien à croire.
  const element = new Array(n);
  const hydrogensOf = new Array(n);
  let hasHydrogen = false;
  for (let i = 0; i < n; i += 1) {
    element[i] = hydrogenBondElementOf(list[i]);
    hydrogensOf[i] = [];
    if (isHydrogenElement(element[i])) hasHydrogen = true;
  }
  if (hasHydrogen) {
    pairs.forEach(([i, j]) => {
      if (isHydrogenElement(element[i])) hydrogensOf[j].push(i);
      if (isHydrogenElement(element[j])) hydrogensOf[i].push(j);
    });
  }

  const mode = hasHydrogen ? 'explicit' : 'heavy';
  // Un N/O/S qui PORTE un hydrogène donne ; celui qui n'en porte aucun accepte.
  const isDonor = (i) => HBOND_ELEMENTS.includes(element[i])
    && (!hasHydrogen || hydrogensOf[i].length > 0);
  const isAcceptor = (i) => HBOND_ELEMENTS.includes(element[i])
    && (!hasHydrogen || hydrogensOf[i].length === 0);

  // 3) LES PONTS, puis UN SEUL PAR COUPLE donneur/accepteur (le meilleur : le
  //    plus court r(H···A) — un oxygène d'eau porte deux hydrogènes et deux
  //    angles, il ne compte pourtant qu'un pont avec le même accepteur).
  const best = new Map();
  const keep = (entry) => {
    const key = `${entry.donor}|${entry.acceptor}`;
    const prev = best.get(key);
    if (!prev || entry.distance < prev.distance) best.set(key, entry);
  };

  // 4) LES ACCEPTEURS, RANGÉS DANS UNE GRILLE DE 3,5 Å — puis le balayage
  //    donneur × accepteur, mais seulement sur les VRAIS voisins : un donneur ne
  //    compare qu'aux 27 cellules autour de lui, et toute paire à moins du critère
  //    y tombe forcément. Sans cette grille, un système solvaté ou une membrane —
  //    des milliers de N·O·S — ferait un balayage QUADRATIQUE, soit plusieurs
  //    secondes d'arrêt au clic. Les indices d'une cellule sont lus dans l'ordre
  //    croissant, donc le résultat est celui du balayage complet, au pont près.
  const CELL = HBOND_DA_MAX;
  const cellKey = (x, y, z) => `${x}|${y}|${z}`;
  const grid = new Map();
  for (let i = 0; i < n; i += 1) {
    if (!isAcceptor(i)) continue;
    if (excludeWater && isWaterResname(resnameOf(list[i]))) continue;
    const p = posOf(list[i]);
    const k = cellKey(Math.floor(p[0] / CELL), Math.floor(p[1] / CELL), Math.floor(p[2] / CELL));
    const bucket = grid.get(k);
    if (bucket) bucket.push(i);
    else grid.set(k, [i]);
  }
  const acceptorsAround = (p) => {
    const cx = Math.floor(p[0] / CELL);
    const cy = Math.floor(p[1] / CELL);
    const cz = Math.floor(p[2] / CELL);
    const out = [];
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          const bucket = grid.get(cellKey(cx + dx, cy + dy, cz + dz));
          if (bucket) bucket.forEach((i) => out.push(i));
        }
      }
    }
    return out.sort((p1, p2) => p1 - p2);   // l'ordre du balayage complet
  };

  for (let d = 0; d < n; d += 1) {
    if (!isDonor(d)) continue;
    if (excludeWater && isWaterResname(resnameOf(list[d]))) continue;
    const dPos = posOf(list[d]);
    const dRes = residueKeyOf(list[d]);
    const neighboursOfDonor = neigh[d];
    const hydrogens = hasHydrogen ? hydrogensOf[d] : [null];
    acceptorsAround(dPos).forEach((a) => {
      if (a === d) return;
      if (neighboursOfDonor && neighboursOfDonor.has(a)) return;   // 1-2 : la liaison covalente
      if (sharesANeighbour(neighboursOfDonor, neigh[a])) return;   // 1-3 : le N–CA–C=O d'un peptide
      // Sans hydrogène, donneur et accepteur sont la MÊME liste : le couple
      // {X, Y} se présenterait deux fois (X→Y et Y→X) pour un seul pont. On ne
      // garde qu'un sens — le pont dessiné est de toute façon le même segment.
      if (!hasHydrogen && a < d) return;
      if (!includeSameResidue && dRes !== '' && residueKeyOf(list[a]) === dRes) return;
      const aPos = posOf(list[a]);
      const daDistance = dist3(dPos, aPos);
      if (!hasHydrogen) {
        // Mode lourds : la seule chose que cette géométrie dit vraiment.
        if (!(daDistance <= HBOND_DA_MAX)) return;
        keep({
          donor: d, acceptor: a, hydrogen: null, hDistance: null, daDistance, distance: daDistance, angle: null,
        });
        return;
      }
      hydrogens.forEach((h) => {
        if (h === null || h === a) return;
        const hDistance = dist3(posOf(list[h]), aPos);
        if (!(hDistance <= HBOND_H_MAX)) return;
        const angle = angleAt(dPos, posOf(list[h]), aPos);
        if (angle === null || !(angle >= HBOND_ANGLE_MIN)) return;
        keep({ donor: d, acceptor: a, hydrogen: h, hDistance, daDistance, distance: hDistance, angle });
      });
    });
  }

  // 5) DU PLUS COURT AU PLUS LONG (puis par indices, pour que le dessin soit le
  //    même à chaque clic), et le plafond du dessin.
  const found = [...best.values()].sort((p, q) => p.distance - q.distance
    || p.donor - q.donor || p.acceptor - q.acceptor);
  const capped = found.length > maxBonds;
  return {
    bonds: capped ? found.slice(0, maxBonds) : found,
    mode,
    capped,
    total: found.length,
    options,
  };
};

/* -------------------------------------------------------------------------
   L'ENVELOPPE — lire un composant NGL (ou sa structure) et lui appliquer la
   règle. La lecture du bond store est la jumelle de celle de
   utils/disulfideBonds.js (même champ `bondStore`, même `getAtomProxy`) : NGL
   n'expose pas les liaisons autrement, et l'application compacte déjà ce store
   pour ses deux autres règles.
   ------------------------------------------------------------------------- */
const readHbondGraph = (componentOrStructure) => {
  const structure = componentOrStructure && componentOrStructure.structure
    ? componentOrStructure.structure
    : componentOrStructure;
  const store = structure && structure.bondStore;
  const atomCount = (structure && structure.atomCount) || 0;
  if (!structure || !store || !atomCount || typeof structure.getAtomProxy !== 'function') return null;
  const ap = structure.getAtomProxy();
  const atoms = [];
  for (let i = 0; i < atomCount; i += 1) {
    ap.index = i;
    atoms.push({
      element: ap.element,
      name: ap.atomname,
      resname: ap.resname,
      resno: ap.resno,
      icode: ap.icode,
      chain: ap.chainname != null ? ap.chainname : ap.chain,
      pos: [ap.x, ap.y, ap.z],
    });
  }
  const bondCount = store.count || 0;
  const bonds = [];
  for (let k = 0; k < bondCount; k += 1) bonds.push([store.atomIndex1[k], store.atomIndex2[k]]);
  return { atoms, bonds };
};

/**
 * LA RÈGLE, APPLIQUÉE À CE QUI EST À L'ÉCRAN.
 *
 * @param {object} componentOrStructure un NGL.Component (ou sa structure)
 * @param {{ includeSameResidue?: boolean, excludeWater?: boolean, maxBonds?: number }} [opts]
 * @returns {{ bonds: object[], atoms: object[], mode: 'explicit'|'heavy'|'none',
 *             capped: boolean, total: number, options: object }} — `atoms` est le
 *          jeu lu (les indices des ponts s'y rapportent) ; sans graphe lisible
 *          (`mode: 'none'`) : ni ponts ni atomes, jamais une exception.
 */
export const findHydrogenBonds = (componentOrStructure, opts = {}) => {
  const graph = readHbondGraph(componentOrStructure);
  if (!graph) {
    return { bonds: [], atoms: [], mode: 'none', capped: false, total: 0, options: {} };
  }
  const result = hydrogenBondsOf(graph.atoms, graph.bonds, opts);
  return { ...result, atoms: graph.atoms };
};

/** LA RÈGLE, DITE — la phrase que le bouton affiche, pour que le lecteur sache ce
 *  qu'il regarde (et pourquoi il y a peut-être moins de ponts qu'il n'en attend). */
export const hydrogenBondRuleText = (mode) => {
  if (mode === 'heavy') {
    return `no hydrogen in this structure, so the heavy atoms are judged by their distance (D···A ≤ ${HBOND_DA_MAX} Å)`;
  }
  if (mode === 'explicit') {
    return `donor N/O/S with its hydrogen: r(H···A) ≤ ${HBOND_H_MAX} Å and angle D–H···A ≥ ${HBOND_ANGLE_MIN}°`;
  }
  return 'nothing to read (no structure on screen)';
};

/**
 * LE COMPTE RENDU DU BOUTON, en une phrase : ce qu'il a trouvé, selon QUELLE
 * règle, et ce qu'il a laissé de côté.
 *
 * @param {string} name le nom de la molécule lue (celui de la barre « Molecules »)
 * @param {{ bonds?: object[], mode?: string, capped?: boolean, options?: object }} result
 * @returns {string}
 */
export const hydrogenBondNoteOf = (name, result) => {
  const res = result || {};
  const bonds = Array.isArray(res.bonds) ? res.bonds : [];
  const mode = res.mode || 'none';
  const opts = res.options || {};
  const what = String(name == null ? '' : name).trim() || 'this structure';
  const rule = hydrogenBondRuleText(mode);
  if (!bonds.length) return `no H-bond found on ${what} — ${rule}`;
  const n = bonds.length;
  return `${n} H-bond${n > 1 ? 's' : ''} on ${what} — ${rule}`
    + (opts.excludeWater === false ? ' · solvent included' : ' · solvent left out')
    + (res.capped ? ` · the ${opts.maxBonds || HBOND_MAX_BONDS} shortest only` : '');
};

