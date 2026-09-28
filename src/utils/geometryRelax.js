/* ============================================================================
   src/utils/geometryRelax.js
   ⚒ MODEL BUILD — DONNER À UNE MOLÉCULE LA GÉOMÉTRIE QUE SES LIAISONS IMPOSENT.

   La demande, mot pour mot :

     « In HyperChem there was a function “model build” that created a chemically
       valid model after the bonds had been specified ; that is what I was looking
       for after specifying the disulphide bridges. Changing the dihedral angles by
       hand is useful but it is a lot of work. Better still would be an energy
       minimisation in which the energy is a TARGET FUNCTION — the sum of the
       deviations of the distances and angles from the normal distances and angles
       of molecules (sp3 carbon with tetrahedral angles, sp2 with 120° and sp with
       180°, and the typical C–C, C–N, C–H, C–O bond lengths). The user defines the
       distance between two atoms and the program starts moving the two atoms
       towards each other, step by step, moving the atoms that no longer respect
       their angles and bonds, until the molecule has moved enough to bring the
       atoms that must be close together. »

   Ce que ce module est — un objectif et sa dérivée, rien d'autre :

         E = Σ_bonds w_b (d − d₀)²  +  Σ_angles w_a (θ − θ₀)²
           + Σ_pairs w_p (d − d₀)²  +  w_t Σ |r − r₀|²

     • les liaisons et les angles viennent du GRAPHE DE LIAISONS de la molécule
       (les éléments de ses atomes, l'ordre de liaison quand le fichier le
       déclare) — jamais d'une distance devinée ici ;
     • les cibles d₀ et θ₀ sont celles des tables ci-dessous : C–C 1.54, C–N 1.47,
       C–O 1.43, C–H 1.09 Å, S–S 2.05 Å… et 109.47° (sp3) · 120° (sp2) · 180° (sp) ;
     • les termes `pairs` sont ceux que l'UTILISATEUR impose : « amène ces deux
       atomes à cette distance » — c'est la contrainte qui pilote le geste, et elle
       pèse plus lourd que la géométrie sans jamais l'écraser ;
     • le dernier terme (une longe, `tether`) garde le changement LOCAL : le
       minimum trouvé est celui qui déplace le moins possible la molécule qu'on
       lui a donnée — « la molécule s'est déplacée juste assez ».

   COMMENT ELLE DESCEND. Un gradient ANALYTIQUE (aucune différence finie : la
   descente doit être reproductible et assez rapide pour un clic), une direction de
   plus grande pente, et une recherche linéaire par dichotomie du pas — le pas est
   divisé par deux jusqu'à ce que l'énergie baisse, et le déplacement d'un atome
   est PLAFONNÉ (RELAX_MAX_ATOM_STEP) pour qu'un gradient énorme ne fasse pas
   exploser la molécule en un pas. Rien d'aléatoire ici, contrairement à la
   recherche de rotamères de utils/disulfideFold.js : le MÊME modèle donne
   toujours le MÊME construit.

   ⚠ CE QUE CE N'EST PAS, et le rapport le redit :
     • ce n'est PAS un champ de forces : aucune charge, aucun van der Waals, aucun
       solvant, aucune entropie, aucun hydrogène ajouté. Les longueurs et les angles
       sont des cibles IDÉALISÉES, donc le résultat est un modèle géométriquement
       valide (« chemically valid » au sens de la demande), jamais une énergie en
       kcal/mol ;
     • la descente est LOCALE : une structure dont les atomes devraient franchir une
       barrière ne se fermera pas. Le rapport dit alors `converged: false` et la
       distance RÉELLEMENT obtenue, il n'invente jamais un pont ;
     • seuls les atomes de `movable` bougent. Tout le reste est rendu BIT À BIT
       (l'ancrage d'une fenêtre est ce qui permet de refermer une boucle sans
       déplacer la protéine entière) ;
     • aucune fonction d'ici ne modifie ses arguments.

   Module PUR (aucun import) : la géométrie et le graphe sont INJECTÉS, donc une
   sonde peut les remplacer par une molécule jouet et la page par le vrai lecteur
   NGL. Voir _geometry_relax_test.mjs (le gradient vérifié par différences
   finies, une chaîne étirée qui revient à 1.54 Å / 109.47°, un PDB réel relu
   après écriture).
   ========================================================================= */

/* ── 1 · LES CHIFFRES DE LA CHIMIE ───────────────────────────────────────────
   Trois tables, et leur seule prétention : être les valeurs NORMALES qu'un
   chimiste écrit au tableau. Elles ne dépendent d'aucun fichier. */

/** L'angle d'une hybridation, en degrés — le tétraèdre, le triangle, la ligne. */
export const HYBRID_ANGLES = { sp3: 109.47, sp2: 120, sp: 180 };

/** Les longueurs des liaisons SIMPLES typiques, par couple d'éléments (Å). La
 *  clé s'écrit dans l'ordre du tableau ou dans l'ordre inverse (`bondLengthTarget`
 *  essaie les deux), donc « C-H » et « H-C » sont la même liaison. */
export const IDEAL_BOND_LENGTHS = {
  'C-C': 1.54, 'C-N': 1.47, 'C-O': 1.43, 'C-S': 1.82, 'C-P': 1.84, 'C-H': 1.09,
  'C-F': 1.35, 'C-CL': 1.77, 'C-BR': 1.94, 'C-I': 2.14,
  'N-N': 1.45, 'N-O': 1.40, 'N-S': 1.70, 'N-P': 1.70, 'N-H': 1.01,
  'O-O': 1.48, 'O-P': 1.60, 'O-S': 1.60, 'O-H': 0.96,
  'S-S': 2.05, 'S-P': 2.10, 'S-H': 1.34,
  'P-P': 2.21, 'P-H': 1.42, 'H-H': 0.74,
};

/** Ce qu'un ordre de liaison RETIRE à la longueur simple (Å) : C–C 1.54 → C=C
 *  1.34 → C≡C 1.20, et de même C–O 1.43 → C=O 1.23, C–N 1.47 → C=N 1.27. Un
 *  ordre non déclaré (le cas d'un PDB, qui n'en écrit aucun) vaut 1. */
export const BOND_ORDER_SHORTENING = { 1: 0, 2: 0.2, 3: 0.34 };

/** Un cycle de cinq ou six atomes est le seul qui puisse être PLAN (le benzène,
 *  les bases des acides nucléiques) ; un cycle de trois ou quatre est coudé, un
 *  macrocycle est souple. C'est le premier des deux indices d'aromaticité. */
export const PLANAR_RING_SIZES = new Set([5, 6]);

/** Le second indice : la LONGUEUR des liaisons du cycle, lue dans la géométrie
 *  reçue. Un cycle dont les liaisons mesurent ≤ 1.45 Å est plan (benzène 1.39) ;
 *  un cyclohexane (1.53) ou un sucre (1.52) ne l'est pas. Le fichier parle donc
 *  lui-même : sans cette mesure, six C–C d'ordre 1 seraient pris pour du
 *  cyclohexane — ou pire, tout cycle de six pour du benzène. */
export const PLANAR_RING_MAX_BOND = 1.45;

/** La longueur d'un C–C aromatique : le benzène, 1.39 Å — une liaison SIMPLE par
 *  son ordre (un PDB n'écrit pas les ordres d'un cycle) mais pas par sa géométrie. */
export const AROMATIC_CC_LENGTH = 1.39;

/* ── 2 · LES POIDS ET LES BORNES ─────────────────────────────────────────────
   Les unités sont celles du rapport : des ångströms et des degrés. Un écart de
   0.1 Å sur une longueur coûte 2, un écart de 10° sur un angle coûte 20 — les deux
   familles se tiennent donc de près, comme dans un champ de forces où une liaison
   est une dizaine de fois plus raide qu'un angle (mesuré : avec un poids d'angle
   de 0.02, dix fois plus faible, la descente satisfaisait une distance lointaine
   en ÉCRASANT des angles de 45° — un modèle chimiquement faux ; à 0.2 elle préfère
   ne pas atteindre la cible et le DIRE). La distance DEMANDÉE par l'utilisateur
   pèse un quart d'une liaison : elle pilote le geste sans jamais avoir le droit de
   détruire la géométrie, et la longe garde le changement local. */

export const RELAX_WEIGHTS = { bond: 200, angle: 0.2, pair: 50, tether: 0.5 };

/** Le nombre de pas de la descente, le déplacement maximal d'un atome par pas, et
 *  les deux seuils d'arrêt (gradient devenu négligeable, énergie qui ne baisse plus). */
export const RELAX_MAX_STEPS = 400;
export const RELAX_MAX_ATOM_STEP = 0.25;
export const RELAX_GRADIENT_TOLERANCE = 1e-9;
export const RELAX_ENERGY_TOLERANCE = 1e-6;

/** La fenêtre relâchée : combien de LIAISONS autour des deux atomes choisis.
 *  Au-delà d'une douzaine de liaisons, la fenêtre serait la molécule entière et le
 *  clic n'aurait plus de sens ; le nombre d'atomes bougés est plafonné lui aussi. */
export const RELAX_DEFAULT_RADIUS = 6;
export const RELAX_MAX_RADIUS = 12;
export const RELAX_MAX_MOVABLE_ATOMS = 240;

/** LES TROIS TOLÉRANCES dont le rapport se sert pour DIRE que c'est fait : « la
 *  liaison est à sa longueur », « l'angle est respecté », « la distance demandée
 *  est atteinte ». */
export const RELAX_BOND_TOLERANCE = 0.05;   // Å
export const RELAX_ANGLE_TOLERANCE = 2;     // degrés
export const RELAX_PAIR_TOLERANCE = 0.05;   // Å

/* ── 3 · L'ARITHMÉTIQUE ──────────────────────────────────────────────────────
   Six lignes de géométrie, comme dans utils/torsionDrive.js : un point, une
   distance, un produit scalaire. Aucune bibliothèque. */

const element = (x) => String(x == null ? '' : x).trim().toUpperCase();
const isIndex = (x) => Number.isInteger(x) && x >= 0;

/** Une coordonnée, ou null : trois nombres finis (une copie, jamais la référence). */
const point3 = (p) => (
  Array.isArray(p) && p.length >= 3 && [p[0], p[1], p[2]].every((n) => Number.isFinite(Number(n)))
    ? [Number(p[0]), Number(p[1]), Number(p[2])]
    : null
);
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Trois nombres par atome, dans l'ordre des atomes — la forme que le viewer lit
 *  et écrit (`positionFromArray`). Rend une COPIE : les arguments ne sont jamais
 *  touchés. Accepte aussi un tableau de triplets. */
export const flatPositions = (positions) => {
  if (!positions || typeof positions === 'string' || typeof positions.length !== 'number') return null;
  const list = Array.from(positions);
  if (!list.length) return null;
  let flat = null;
  if (Array.isArray(list[0])) {
    flat = [];
    for (const p of list) {
      const q = point3(p);
      if (!q) return null;
      flat.push(q[0], q[1], q[2]);
    }
  } else {
    if (list.length % 3 !== 0) return null;
    flat = list.map((n) => Number(n));
    if (!flat.every(Number.isFinite)) return null;
  }
  return flat.length ? { flat, count: flat.length / 3 } : null;
};

/* ── 4 · CE QUE LA MOLÉCULE DIT D'ELLE-MÊME ──────────────────────────────────
   Rien n'est deviné : le couple d'éléments, l'ordre déclaré, et le graphe. La
   seule lecture qui demande la géométrie est celle d'un CYCLE (voir
   PLANAR_RING_MAX_BOND) — et elle est optionnelle. */

const tableLookup = (table, a, b) => {
  const v = table[`${a}-${b}`];
  if (v != null) return v;
  const w = table[`${b}-${a}`];
  return w == null ? null : w;
};

/**
 * LA LONGUEUR CIBLE D'UNE LIAISON — le couple d'éléments et l'ordre déclaré.
 * Rend `null` quand la table ne connaît pas ce couple (un métal, un élément
 * exotique) : aucune longueur n'est inventée pour si peu, la liaison est
 * simplement laissée hors de la fonction cible et l'appelant la COMPTE
 * (`terms.unknownBonds`) plutôt que de la croire.
 */
export const bondLengthTarget = (elA, elB, order = 1) => {
  const a = element(elA); const b = element(elB);
  if (!a || !b) return null;
  const base = tableLookup(IDEAL_BOND_LENGTHS, a, b);
  if (!Number.isFinite(base)) return null;
  const shrink = BOND_ORDER_SHORTENING[Number(order)] || 0;
  return Number((base - shrink).toFixed(4));
};

/** LE PLUS COURT CHEMIN ENTRE DEUX ATOMES, d'au plus `cap` liaisons, sans passer
 *  par `avoid` (le pivot du cycle). Rend sa LONGUEUR (nombre de liaisons), ou 0. */
const shortestPath = ({ neighbours, from, to, avoid, cap }) => {
  if (from === to) return 0;
  const seen = new Set([from]);
  if (isIndex(avoid)) seen.add(avoid);
  let frontier = [from];
  for (let depth = 1; depth <= cap; depth += 1) {
    const next = [];
    for (const cur of frontier) {
      let list = [];
      try { list = neighbours(cur) || []; } catch { list = []; }
      for (const raw of list) {
        const i = Number(raw);
        if (!isIndex(i) || seen.has(i)) continue;
        if (i === to) return depth;
        seen.add(i);
        next.push(i);
      }
    }
    if (!next.length) return 0;
    frontier = next;
  }
  return 0;
};

/**
 * LA TAILLE DU PLUS PETIT CYCLE QUI TRAVERSE UN ATOME (0 = aucun).
 * La méthode est celle d'un chimiste : pour chaque couple de voisins (i, k) de
 * l'atome `j`, on cherche le plus court chemin i → k SANS passer par j ; le cycle
 * vaut ce chemin PLUS les deux liaisons j–i et j–k. La recherche est PLAFONNÉE
 * (`cap`, 6 par défaut) — au-delà, le cycle n'est plus « plan » de toute façon, et
 * chercher plus loin coûterait un parcours de la molécule entière pour rien.
 */
export const ringSizeThrough = ({ neighbours, atom, cap = 6 }) => {
  if (typeof neighbours !== 'function' || !isIndex(atom)) return 0;
  let list = [];
  try { list = neighbours(atom) || []; } catch { list = []; }
  const nb = list.map(Number).filter((i) => isIndex(i) && i !== atom);
  if (nb.length < 2) return 0;
  const limit = Math.max(1, (Number(cap) || 6) - 2);
  let best = 0;
  for (let a = 0; a < nb.length; a += 1) {
    for (let b = a + 1; b < nb.length; b += 1) {
      const path = shortestPath({ neighbours, from: nb[a], to: nb[b], avoid: atom, cap: limit });
      if (path > 0) {
        const size = path + 2;
        if (!best || size < best) best = size;
      }
    }
  }
  return best;
};

/**
 * L'HYBRIDATION D'UN ATOME — lue sur ses liaisons, jamais sur son nom :
 *   · un ordre 3 déclaré                                     → sp  (180°)
 *   · un ordre 2 déclaré                                     → sp2 (120°)
 *   · deux voisins, dans un cycle de 5 ou 6 dont les liaisons mesurent ≤ 1.45 Å
 *                                                            → sp2 (120°) : le benzène
 *   · tout le reste (trois voisins et plus, ou deux voisins d'une chaîne saturée)
 *                                                            → sp3 (109.47°)
 *   · un seul voisin (ou aucun), ou un hydrogène             → null : pas d'angle
 *
 * `ringBondMean` est la longueur MOYENNE des liaisons de l'atome (lues dans la
 * géométrie reçue) : c'est le second indice d'aromaticité, celui qui distingue le
 * benzène (1.39 Å) du cyclohexane (1.53 Å) et d'un sucre (1.52 Å). Sans géométrie
 * (`ringBondMean` absent), un cycle n'est JAMAIS déclaré plan : mieux vaut un
 * 109.47° prudent qu'un 120° inventé.
 */
export const hybridOf = ({ element: el, degree, maxOrder = 1, ringSize = 0, ringBondMean = null }) => {
  const d = Number(degree) || 0;
  const o = Number(maxOrder) || 1;
  const e = element(el);
  if (d < 2 || e === 'H' || e === 'D') return null;
  if (o >= 3) return 'sp';
  if (o === 2) return 'sp2';
  const ring = Number(ringSize) || 0;
  const mean = Number(ringBondMean);
  if (d === 2 && PLANAR_RING_SIZES.has(ring)
    && ringBondMean != null && Number.isFinite(mean) && mean > 0 && mean <= PLANAR_RING_MAX_BOND) {
    return 'sp2';
  }
  return 'sp3';
};

/** L'angle cible d'une hybridation, en degrés — `null` quand il n'y en a pas. */
export const angleTargetOf = (hybrid) => (HYBRID_ANGLES[hybrid] != null ? HYBRID_ANGLES[hybrid] : null);

/* ── 5 · LES TERMES DE LA FONCTION CIBLE ─────────────────────────────────────
   Trois listes, et rien d'autre : les liaisons (avec leur longueur cible), les
   angles (avec leur angle cible), et les distances DEMANDÉES. `positions` est
   optionnel — il ne sert qu'à juger si un cycle est plan (PLANAR_RING_MAX_BOND) ;
   sans lui, aucune liaison n'est déclarée aromatique. */

/**
 * LE GRAPHE D'UNE MOLÉCULE, tel que le fichier le déclare : la liste des liaisons
 * (deux indices et un ordre) et une fonction d'adjacence. Les liaisons illisibles,
 * les doublons et les indices hors molécule sont écartés ICI, une fois pour
 * toutes — `buildRelaxTerms` et `relaxWindow` lisent donc exactement le même
 * graphe, et une liaison ne peut pas exister pour l'un et pas pour l'autre.
 *
 * `bonds` accepte [[i, j]], [[i, j, ordre]] et [{i, j, order}] ; un ordre absent,
 * nul ou absurde vaut 1 (c'est ce qu'un PDB dit de toutes ses liaisons).
 */
export const bondGraphOf = ({ bonds = [], atomCount = 0 } = {}) => {
  const list = [];
  const adj = new Map();
  const seen = new Set();
  const link = (i, j) => { const l = adj.get(i); if (l) l.push(j); else adj.set(i, [j]); };
  for (const raw of Array.from(bonds || [])) {
    const b = Array.isArray(raw) ? { i: raw[0], j: raw[1], order: raw[2] } : (raw || {});
    const i = Number(b.i); const j = Number(b.j);
    const order = [1, 2, 3].includes(Number(b.order)) ? Number(b.order) : 1;
    if (!isIndex(i) || !isIndex(j) || i === j) continue;
    if (atomCount && (i >= atomCount || j >= atomCount)) continue;
    const key = i < j ? `${i}-${j}` : `${j}-${i}`;
    if (seen.has(key)) continue;
    seen.add(key);
    list.push({ i, j, order });
    link(i, j); link(j, i);
  }
  return { list, neighbours: (i) => adj.get(i) || [], count: list.length };
};

/**
 * @param {{elements?:any[], bonds?:any[], pairs?:any[], weights?:object, positions?:any}} spec
 *   `bonds` : [[i, j]] ou [[i, j, ordre]] ou [{i, j, order}] — l'ordre par défaut est 1.
 *   `pairs`  : [[i, j, d]] ou [{i, j, target}] — la distance que l'UTILISATEUR impose.
 * @returns {{count:number, bonds:object[], angles:object[], pairs:object[],
 *            hybrids:any[], ringSizes:number[], ringMeans:any[],
 *            bondCount:number, unknownBonds:number, aromaticBonds:number}}
 */
export const buildRelaxTerms = ({
  elements = [], bonds = [], pairs = [], weights = RELAX_WEIGHTS, positions = null,
} = {}) => {
  const els = Array.from(elements || []).map((e) => element(e));
  const count = els.length;
  const read = flatPositions(positions);
  const x = read && (!count || read.count === count) ? read.flat : null;
  const pt = (i) => [x[i * 3], x[i * 3 + 1], x[i * 3 + 2]];

  /* LE GRAPHE — lu par le même bondGraphOf que la fenêtre relâchée, donc une
     liaison ne peut pas exister pour l'un et pas pour l'autre. */
  const graph = bondGraphOf({ bonds, atomCount: count });
  const bondsList = graph.list;
  const neighbours = graph.neighbours;

  /* L'HYBRIDATION de chaque atome, et la taille du cycle où il se trouve. Le cycle
     ne se cherche que pour un atome de degré 2 (le seul cas où il change quelque
     chose) : sur une protéine, cela ne concerne qu'une poignée d'atomes de cycles. */
  const hybrids = new Array(count).fill(null);
  const ringSizes = new Array(count).fill(0);
  const ringMeans = new Array(count).fill(null);
  const maxOrders = new Array(count).fill(1);
  for (const { i, j, order } of bondsList) {
    if (order > maxOrders[i]) maxOrders[i] = order;
    if (order > maxOrders[j]) maxOrders[j] = order;
  }
  for (let a = 0; a < count; a += 1) {
    const nbs = neighbours(a);
    if (nbs.length === 2) {
      ringSizes[a] = ringSizeThrough({ neighbours, atom: a });
      if (x) ringMeans[a] = (dist3(pt(a), pt(nbs[0])) + dist3(pt(a), pt(nbs[1]))) / 2;
    }
    hybrids[a] = hybridOf({
      element: els[a], degree: nbs.length, maxOrder: maxOrders[a],
      ringSize: ringSizes[a], ringBondMean: ringMeans[a],
    });
  }

  /* LES LIAISONS. Un cycle de cinq ou six atomes dont les liaisons mesurent ≤ 1.45 Å
     et dont les DEUX atomes sont sp2 porte un C–C de benzène (1.39 Å), pas un C–C
     simple de 1.54 : c'est la seule liaison dont la cible ne vient pas de l'ordre. */
  const bondTerms = [];
  let unknownBonds = 0; let aromaticBonds = 0;
  for (const { i, j, order } of bondsList) {
    const aromatic = order === 1 && els[i] === 'C' && els[j] === 'C'
      && hybrids[i] === 'sp2' && hybrids[j] === 'sp2'
      && PLANAR_RING_SIZES.has(ringSizes[i]) && PLANAR_RING_SIZES.has(ringSizes[j]);
    const target = aromatic ? AROMATIC_CC_LENGTH : bondLengthTarget(els[i], els[j], order);
    if (!Number.isFinite(target)) { unknownBonds += 1; continue; }
    if (aromatic) aromaticBonds += 1;
    bondTerms.push({ i, j, target, weight: Number(weights.bond) || 0, order });
  }

  /* LES ANGLES — tous les triplets i–j–k du graphe, à la cible de l'hybridation
     du sommet j. Un atome sans hybridation (un hydrogène, un atome seul) n'en
     porte aucun : la fonction cible ne parle que de ce qu'elle sait. */
  const angleTerms = [];
  for (let j = 0; j < count; j += 1) {
    const target = angleTargetOf(hybrids[j]);
    const nbs = neighbours(j);
    if (!Number.isFinite(target) || nbs.length < 2) continue;
    for (let a = 0; a < nbs.length; a += 1) {
      for (let b = a + 1; b < nbs.length; b += 1) {
        angleTerms.push({ i: nbs[a], j, k: nbs[b], target, weight: Number(weights.angle) || 0 });
      }
    }
  }

  /* LES DISTANCES DEMANDÉES — celles de l'utilisateur, telles quelles. */
  const pairTerms = [];
  for (const raw of Array.from(pairs || [])) {
    const p = Array.isArray(raw) ? { i: raw[0], j: raw[1], target: raw[2] } : (raw || {});
    const i = Number(p.i); const j = Number(p.j);
    const target = Number(p.target != null ? p.target : p.distance);
    if (!isIndex(i) || !isIndex(j) || i === j) continue;
    if (count && (i >= count || j >= count)) continue;
    if (!Number.isFinite(target) || target <= 0) continue;
    pairTerms.push({ i, j, target, weight: Number(p.weight) || Number(weights.pair) || 0 });
  }

  return {
    count, bonds: bondTerms, angles: angleTerms, pairs: pairTerms,
    hybrids, ringSizes, ringMeans,
    bondCount: bondsList.length, unknownBonds, aromaticBonds,
  };
};

/* ── 6 · L'ÉNERGIE, SON GRADIENT, ET CE QU'ELLE A DEVENU ───────────────────── */

const DEG = 180 / Math.PI;

/** Une perpendiculaire UNITAIRE à un vecteur — DÉTERMINISTE (jamais un tirage) :
 *  l'axe de référence est le plus « plat » des trois, donc la perpendiculaire
 *  existe toujours, même pour une liaison exactement selon un axe de coordonnées.
 *  Elle sert au seul cas où un gradient d'angle n'existe pas : l'angle PLAT. */
const perpendicularTo = (x, y, z) => {
  const ax = Math.abs(x); const ay = Math.abs(y); const az = Math.abs(z);
  const ref = (ax <= ay && ax <= az) ? [1, 0, 0] : (ay <= az ? [0, 1, 0] : [0, 0, 1]);
  const px = y * ref[2] - z * ref[1];
  const py = z * ref[0] - x * ref[2];
  const pz = x * ref[1] - y * ref[0];
  const n = Math.hypot(px, py, pz);
  if (!(n > 1e-12)) return null;
  return [px / n, py / n, pz / n];
};

/** LE COUP DE POUCE D'UN ANGLE EXACTEMENT PLAT (Å). À 180.000°, le gradient d'un
 *  angle est nul dans TOUTE direction (sin θ = 0 ET v̂ + û = 0) : une chaîne
 *  parfaitement alignée est un col, et une descente y resterait pour toujours.
 *  Avant de descendre, chaque angle plat est donc écarté de 0,01 Å le long d'une
 *  perpendiculaire DÉTERMINISTE (aucun tirage) — un centième d'ångström, que le
 *  rapport annonce (`terms.unstuck`), et le col est franchi. */
export const UNSTICK_STEP = 0.01;
const FLAT_SIN = 1e-3;          // sin θ en dessous duquel un angle est « plat »
const FLAT_DEV = 0.5;           // …et dont l'écart à sa cible mérite le coup de pouce

/**
 * LA FONCTION CIBLE, ET SA DÉRIVÉE — le cœur du module.
 *
 * Trois familles de termes (voir l'en-tête) et une longe. Le gradient est
 * ANALYTIQUE, et il n'y a aucune différence finie nulle part :
 *
 *   · une distance        d = |rᵢ − rⱼ|,  E = w(d − d₀)²
 *        ∂E/∂rᵢ = 2w(d − d₀)·(rᵢ − rⱼ)/d        (et l'opposé pour rⱼ)
 *   · un angle            cos θ = (u·v)/(|u||v|) avec u = rᵢ − rⱼ, v = r_k − rⱼ,
 *                         E = w(θ − θ₀)², θ en DEGRÉS (les chiffres qu'on lit)
 *        ∂E/∂u = 2w(θ − θ₀)·(−180/π / sin θ)·(v̂ − cos θ·û)/|u|
 *        ∂E/∂v = 2w(θ − θ₀)·(−180/π / sin θ)·(û − cos θ·v̂)/|v|
 *        et ∂E/∂rⱼ = −(∂E/∂u + ∂E/∂v)   — le sommet encaisse la somme des deux.
 *        Un angle EXACTEMENT plat (sin θ = 0) n'a aucune dérivée : le terme est
 *        alors sauté. C'est le seul cas que la descente ne sait pas franchir seule,
 *        et `relaxGeometry` le traite AVANT de descendre (UNSTICK_STEP).
 *   · la longe            E = w_t |r − r₀|²   →  ∂E/∂r = 2w_t (r − r₀), seulement
 *        sur les atomes qui ont le droit de bouger.
 *
 * `hess`, quand il est demandé, reçoit la DIAGONALE de la matrice de Gauss-Newton
 * de la fonction cible — Σ 2w·(∂terme/∂coordonnée)², terme par terme. C'est le
 * préconditionneur de la descente : sans lui, un poids de 100 sur les longueurs et
 * de 0.02 sur les angles donnent un paysage si mal conditionné que la descente
 * oscille et s'arrête loin du but (mesuré : énergie 11 au lieu de 0.01). Avec lui,
 * chaque coordonnée se déplace de « son propre » pas, comme dans un champ de
 * forces où chaque terme a sa raideur.
 *
 * La sonde vérifie ce gradient par DIFFÉRENCES FINIES (_geometry_relax_test.mjs) :
 * une dérivée écrite à la main ne vaut rien tant qu'on ne l'a pas mesurée.
 *
 * @returns {{total:number, bond:number, angle:number, pair:number, tether:number,
 *            bondRms:number, angleRms:number, worstBond:object|null, worstAngle:object|null}}
 */
export const energyOf = (terms, x, {
  grad = null, hess = null, ref = null, tether = 0, movable = null,
} = {}) => {
  const out = {
    total: 0, bond: 0, angle: 0, pair: 0, tether: 0,
    bondRms: 0, angleRms: 0, worstBond: null, worstAngle: null,
  };
  if (grad) grad.fill(0);
  if (hess) hess.fill(0);
  let nBonds = 0; let sumBonds = 0; let nAngles = 0; let sumAngles = 0;

  const distanceTerm = (t, bucket) => {
    const i = t.i; const j = t.j;
    const dx = x[i * 3] - x[j * 3];
    const dy = x[i * 3 + 1] - x[j * 3 + 1];
    const dz = x[i * 3 + 2] - x[j * 3 + 2];
    const d = Math.hypot(dx, dy, dz) || 1e-12;
    const dev = d - t.target;
    out[bucket] += t.weight * dev * dev;
    if (bucket === 'bond') {
      nBonds += 1; sumBonds += dev * dev;
      if (!out.worstBond || Math.abs(dev) > Math.abs(out.worstBond.dev)) {
        out.worstBond = { i, j, distance: d, target: t.target, dev };
      }
    }
    if (hess) {
      const k = 2 * t.weight;
      const ux = (dx / d) * (dx / d); const uy = (dy / d) * (dy / d); const uz = (dz / d) * (dz / d);
      hess[i * 3] += k * ux; hess[i * 3 + 1] += k * uy; hess[i * 3 + 2] += k * uz;
      hess[j * 3] += k * ux; hess[j * 3 + 1] += k * uy; hess[j * 3 + 2] += k * uz;
    }
    if (!grad) return;
    const k = (2 * t.weight * dev) / d;
    const gx = k * dx; const gy = k * dy; const gz = k * dz;
    grad[i * 3] += gx; grad[i * 3 + 1] += gy; grad[i * 3 + 2] += gz;
    grad[j * 3] -= gx; grad[j * 3 + 1] -= gy; grad[j * 3 + 2] -= gz;
  };
  for (const t of terms.bonds) distanceTerm(t, 'bond');
  for (const t of terms.pairs) distanceTerm(t, 'pair');

  for (const t of terms.angles) {
    const { i, j, k } = t;
    const ux = x[i * 3] - x[j * 3]; const uy = x[i * 3 + 1] - x[j * 3 + 1]; const uz = x[i * 3 + 2] - x[j * 3 + 2];
    const vx = x[k * 3] - x[j * 3]; const vy = x[k * 3 + 1] - x[j * 3 + 1]; const vz = x[k * 3 + 2] - x[j * 3 + 2];
    const ru = Math.hypot(ux, uy, uz); const rv = Math.hypot(vx, vy, vz);
    if (ru < 1e-9 || rv < 1e-9) continue;
    const cos = Math.max(-1, Math.min(1, (ux * vx + uy * vy + uz * vz) / (ru * rv)));
    const thetaDeg = Math.acos(cos) * DEG;
    const dev = thetaDeg - t.target;
    out.angle += t.weight * dev * dev;
    nAngles += 1; sumAngles += dev * dev;
    if (!out.worstAngle || Math.abs(dev) > Math.abs(out.worstAngle.dev)) {
      out.worstAngle = { i, j, k, deg: thetaDeg, target: t.target, dev };
    }
    if (!grad && !hess) continue;
    const sin = Math.sqrt(Math.max(1e-12, 1 - cos * cos));
    if (sin < 1e-9) continue;      // angle exactement plat : aucune dérivée (voir UNSTICK_STEP)
    const uxHat = ux / ru; const uyHat = uy / ru; const uzHat = uz / ru;
    const vxHat = vx / rv; const vyHat = vy / rv; const vzHat = vz / rv;
    /* LE JACOBIEN DE L'ANGLE — ∂θ°/∂r, atome par atome. Le gradient en est
       2w(θ−θ₀)·J et la diagonale de Gauss-Newton 2w·J² par coordonnée : une seule
       écriture, les deux usages, et le préconditionneur ne peut pas diverger du
       gradient (c'est le même vecteur). */
    const jScale = -DEG / sin;
    const jix = jScale * ((vxHat - cos * uxHat) / ru);
    const jiy = jScale * ((vyHat - cos * uyHat) / ru);
    const jiz = jScale * ((vzHat - cos * uzHat) / ru);
    const jkx = jScale * ((uxHat - cos * vxHat) / rv);
    const jky = jScale * ((uyHat - cos * vyHat) / rv);
    const jkz = jScale * ((uzHat - cos * vzHat) / rv);
    const jjx = -(jix + jkx); const jjy = -(jiy + jky); const jjz = -(jiz + jkz);
    if (hess) {
      const w2 = 2 * t.weight;
      hess[i * 3] += w2 * jix * jix; hess[i * 3 + 1] += w2 * jiy * jiy; hess[i * 3 + 2] += w2 * jiz * jiz;
      hess[k * 3] += w2 * jkx * jkx; hess[k * 3 + 1] += w2 * jky * jky; hess[k * 3 + 2] += w2 * jkz * jkz;
      hess[j * 3] += w2 * jjx * jjx; hess[j * 3 + 1] += w2 * jjy * jjy; hess[j * 3 + 2] += w2 * jjz * jjz;
    }
    if (grad) {
      const k2 = 2 * t.weight * dev;
      grad[i * 3] += k2 * jix; grad[i * 3 + 1] += k2 * jiy; grad[i * 3 + 2] += k2 * jiz;
      grad[k * 3] += k2 * jkx; grad[k * 3 + 1] += k2 * jky; grad[k * 3 + 2] += k2 * jkz;
      grad[j * 3] += k2 * jjx; grad[j * 3 + 1] += k2 * jjy; grad[j * 3 + 2] += k2 * jjz;
    }
  }

  if (tether > 0 && ref && movable && movable.length) {
    for (const i of movable) {
      const dx = x[i * 3] - ref[i * 3];
      const dy = x[i * 3 + 1] - ref[i * 3 + 1];
      const dz = x[i * 3 + 2] - ref[i * 3 + 2];
      out.tether += tether * (dx * dx + dy * dy + dz * dz);
      if (hess) {
        hess[i * 3] += 2 * tether; hess[i * 3 + 1] += 2 * tether; hess[i * 3 + 2] += 2 * tether;
      }
      if (grad) {
        grad[i * 3] += 2 * tether * dx;
        grad[i * 3 + 1] += 2 * tether * dy;
        grad[i * 3 + 2] += 2 * tether * dz;
      }
    }
  }

  out.bondRms = nBonds ? Math.sqrt(sumBonds / nBonds) : 0;
  out.angleRms = nAngles ? Math.sqrt(sumAngles / nAngles) : 0;
  out.total = out.bond + out.angle + out.pair + out.tether;
  return out;
};

/** LA DISTANCE DE CHAQUE PAIRE DEMANDÉE, sur les coordonnées données — ce que le
 *  rapport affiche AVANT et APRÈS, relu et jamais supposé (`reached` au sens de
 *  RELAX_PAIR_TOLERANCE : « la distance demandée est bien là »). */
export const pairReportOf = (terms, x) => terms.pairs.map((t) => {
  const d = dist3(
    [x[t.i * 3], x[t.i * 3 + 1], x[t.i * 3 + 2]],
    [x[t.j * 3], x[t.j * 3 + 1], x[t.j * 3 + 2]],
  );
  return {
    i: t.i, j: t.j, target: t.target, distance: d, deviation: d - t.target,
    reached: Math.abs(d - t.target) <= RELAX_PAIR_TOLERANCE,
  };
});

/**
 * LE COUP DE POUCE DES ANGLES PLATS — exécuté UNE fois, avant la descente, sur la
 * copie de travail. Un angle exactement à 180° (sin θ = 0) a un gradient NUL dans
 * toute direction : c'est un col, et une chaîne parfaitement alignée y resterait
 * alignée pour toujours. Chaque angle plat dont la cible n'est PAS 180° est donc
 * écarté de `step` ångströms le long d'une perpendiculaire DÉTERMINISTE à sa
 * première liaison (jamais un tirage : le même modèle donne le même résultat).
 * Rend le nombre d'angles qui ont reçu ce coup de pouce (`terms.unstuck`).
 */
export const unstickFlatAngles = (terms, x, step = UNSTICK_STEP) => {
  let nudged = 0;
  const s = Math.abs(Number(step)) || UNSTICK_STEP;
  for (const t of terms.angles) {
    if (Math.abs(Number(t.target) - 180) < 1e-9) continue;   // la cible EST 180° : rien à écarter
    const i = t.i; const j = t.j; const k = t.k;
    const ux = x[i * 3] - x[j * 3]; const uy = x[i * 3 + 1] - x[j * 3 + 1]; const uz = x[i * 3 + 2] - x[j * 3 + 2];
    const vx = x[k * 3] - x[j * 3]; const vy = x[k * 3 + 1] - x[j * 3 + 1]; const vz = x[k * 3 + 2] - x[j * 3 + 2];
    const ru = Math.hypot(ux, uy, uz); const rv = Math.hypot(vx, vy, vz);
    if (ru < 1e-9 || rv < 1e-9) continue;
    const cos = Math.max(-1, Math.min(1, (ux * vx + uy * vy + uz * vz) / (ru * rv)));
    const sin = Math.sqrt(Math.max(0, 1 - cos * cos));
    if (sin > FLAT_SIN) continue;
    const deg = Math.acos(cos) * DEG;
    if (Math.abs(deg - t.target) <= FLAT_DEV) continue;
    const p = perpendicularTo(ux, uy, uz);
    if (!p) continue;
    const sign = deg >= t.target ? 1 : -1;
    x[i * 3] += p[0] * s * sign; x[i * 3 + 1] += p[1] * s * sign; x[i * 3 + 2] += p[2] * s * sign;
    nudged += 1;
  }
  return nudged;
};

/* ── 7 · LA FENÊTRE QUI A LE DROIT DE BOUGER ───────────────────────────────── */
/**
 * LES ATOMES QUE LE CONSTRUIT PEUT DÉPLACER — ceux qui sont à `radius` liaisons ou
 * moins des atomes choisis, le long du VRAI graphe des liaisons. C'est ce qui rend
 * le geste local : la contrainte ferme une boucle en tordant la chaîne autour
 * d'elle, pas la molécule entière.
 *
 *   · `radius` = 0 : seuls les atomes choisis bougent — « amène ces deux atomes
 *     l'un vers l'autre », au plus près de ce que leurs propres liaisons permettent ;
 *   · le parcours part des atomes choisis et s'élargit liaison par liaison, donc
 *     quand la fenêtre est PLAFONNÉE (`maxAtoms`), ce sont les atomes les plus
 *     LOINTAINS qui sont laissés de côté — jamais un atome du cœur du geste ;
 *   · `truncated` le DIT (`true` quand le plafond a mordu), pour que le rapport
 *     puisse l'annoncer au lieu de faire croire à une molécule entière relâchée.
 */
export const relaxWindow = ({
  bonds = [], seeds = [], radius = RELAX_DEFAULT_RADIUS, atomCount = 0,
  maxAtoms = RELAX_MAX_MOVABLE_ATOMS,
} = {}) => {
  const graph = bondGraphOf({ bonds, atomCount });
  const cap = Math.max(0, Math.min(Math.round(Number(radius) || 0), RELAX_MAX_RADIUS));
  const roots = [...new Set(Array.from(seeds || []).map(Number)
    .filter((i) => isIndex(i) && (!atomCount || i < atomCount)))].sort((a, b) => a - b);
  const level = new Map(roots.map((i) => [i, 0]));
  const order = [...roots];
  for (let head = 0; head < order.length; head += 1) {
    const cur = order[head];
    const depth = level.get(cur);
    if (depth >= cap) continue;
    for (const raw of graph.neighbours(cur)) {
      const i = Number(raw);
      if (!isIndex(i) || level.has(i)) continue;
      level.set(i, depth + 1);
      order.push(i);
    }
  }
  const limit = Math.max(1, Math.round(Number(maxAtoms) || RELAX_MAX_MOVABLE_ATOMS));
  const movable = order.slice(0, Math.min(order.length, limit)).sort((a, b) => a - b);
  return {
    movable, seeds: roots, radius: cap,
    size: order.length, leftOut: order.length - movable.length,
    truncated: order.length > movable.length,
    bonds: graph.count, levels: level,
  };
};

/* ── 8 · LE CONSTRUIT, PAS À PAS ───────────────────────────────────────────── */

/** Le résumé d'une évaluation — les six chiffres que le rapport affiche, et les
 *  deux pires écarts (la liaison la plus fausse, l'angle le plus faux). */
const summaryOf = (e) => ({
  total: e.total, bond: e.bond, angle: e.angle, pair: e.pair, tether: e.tether,
  bondRms: e.bondRms, angleRms: e.angleRms,
  worstBond: e.worstBond ? { ...e.worstBond } : null,
  worstAngle: e.worstAngle ? { ...e.worstAngle } : null,
});

/**
 * LE GESTE ENTIER — « l'utilisateur définit la distance entre deux atomes, et le
 * programme commence à rapprocher ces deux atomes pas à pas, en déplaçant les
 * atomes qui ne respectent plus leurs angles et leurs liaisons, jusqu'à ce que la
 * molécule se soit déplacée assez pour que les atomes qui doivent être proches le
 * soient ».
 *
 * Le déroulement, dans l'ordre : la fonction cible est construite sur le GRAPHE
 * reçu (`buildRelaxTerms`), les termes qu'aucun atome mobile ne touche sont mis de
 * côté (une constante ne se minimise pas), l'énergie et son gradient sont évalués,
 * puis chaque pas est une plus grande pente PLAFONNÉE suivie d'une recherche
 * linéaire par dichotomie. Aucun aléatoire, aucune barrière franchie : la descente
 * est locale et le rapport le dit.
 *
 * @param {{positions:number[]|Float32Array|number[][], elements?:any[], bonds?:any[],
 *          pairs?:any[], movable?:number[]|null, steps?:number, maxAtomStep?:number,
 *          tolerance?:number, gradientTolerance?:number, weights?:object,
 *          tether?:number|null}} spec
 *   `pairs` = les distances DEMANDÉES : [{i, j, target}] ou [[i, j, d]].
 *   `movable` = les atomes qui ont le droit de bouger (par défaut : tous). Les
 *   autres sont rendus BIT À BIT, et c'est leur ancrage qui tient la molécule.
 * @returns {{ok:boolean, reason:string, converged:boolean, reached:boolean,
 *            positions:number[]|null, moved:number[], before:object|null,
 *            after:object|null, pairs:object[], steps:number, evaluations:number,
 *            terms:object, hybrids:any[]}}
 */
export const relaxGeometry = (spec = {}) => {
  const {
    positions = null, elements = [], bonds = [], pairs = [], movable = null,
    steps = RELAX_MAX_STEPS, maxAtomStep = RELAX_MAX_ATOM_STEP,
    tolerance = RELAX_ENERGY_TOLERANCE, gradientTolerance = RELAX_GRADIENT_TOLERANCE,
    weights = RELAX_WEIGHTS, tether = null,
  } = spec || {};

  const read = flatPositions(positions);
  if (!read) {
    return {
      ok: false, reason: 'bad-points', converged: false, reached: false,
      positions: null, moved: [], before: null, after: null, pairs: [],
      steps: 0, evaluations: 0, terms: null, hybrids: [],
    };
  }
  const count = read.count;
  const els = Array.from(elements || []).map((e) => element(e));
  const terms = buildRelaxTerms({ elements: els, bonds, pairs, weights, positions: read.flat });
  const termInfo = {
    bonds: 0, angles: 0, pairs: 0, unstuck: 0,
    bondCount: terms.bondCount, unknownBonds: terms.unknownBonds,
    aromaticBonds: terms.aromaticBonds, positions: count,
  };
  const refuse = (reason) => ({
    ok: false, reason, converged: false, reached: false, positions: null, moved: [],
    before: null, after: null, pairs: [], steps: 0, evaluations: 0,
    terms: termInfo, hybrids: terms.hybrids,
  });

  /* LES ATOMES MOBILES — ceux qu'on donne, ou tous. Un indice hors molécule, un
     négatif, un doublon : écartés sans un mot, comme partout dans le dossier. */
  const given = movable == null ? Array.from({ length: count }, (_, i) => i) : Array.from(movable);
  const movableList = [...new Set(given.map(Number).filter((i) => isIndex(i) && i < count))].sort((a, b) => a - b);
  const movableSet = new Set(movableList);
  if (!movableList.length) return refuse('no-movable');

  /* LES TERMES QUI BOUGENT — un terme dont AUCUN atome ne bouge est une constante :
     il ne pèse pas dans la descente et il ne paraît pas dans le rapport (sinon
     l'énergie d'une protéine entière noierait celle du geste). */
  const active = {
    bonds: terms.bonds.filter((t) => movableSet.has(t.i) || movableSet.has(t.j)),
    angles: terms.angles.filter((t) => movableSet.has(t.i) || movableSet.has(t.j) || movableSet.has(t.k)),
    pairs: terms.pairs.filter((t) => movableSet.has(t.i) || movableSet.has(t.j)),
  };
  termInfo.bonds = active.bonds.length;
  termInfo.angles = active.angles.length;
  termInfo.pairs = active.pairs.length;
  if (!active.bonds.length && !active.angles.length && !active.pairs.length) return refuse('no-terms');

  const n3 = count * 3;
  const x0 = read.flat.slice();
  const tetherWeight = tether == null ? Number(weights.tether) || 0 : Math.max(0, Number(tether) || 0);
  const grad = new Float64Array(n3);
  const hess = new Float64Array(n3);
  const dir = new Float64Array(n3);
  let x = x0.slice();
  const before = summaryOf(energyOf(active, x));
  const beforePairs = pairReportOf(active, x);

  /* LE COUP DE POUCE DES ANGLES PLATS, AVANT de descendre — jamais pour une simple
     lecture (steps = 0 ne touche à rien). Le rapport le compte (`terms.unstuck`). */
  const maxSteps = Math.max(0, Math.round(Number(steps) || 0));
  const unstuck = maxSteps > 0 ? unstickFlatAngles(active, x) : 0;
  termInfo.unstuck = unstuck;

  let current = energyOf(active, x, { grad, hess, ref: x0, tether: tetherWeight, movable: movableList });
  let evaluations = 2;
  let taken = 0;
  let quiet = 0;
  let reason = 'max-steps';
  const capMax = Math.max(1e-6, Number(maxAtomStep) || RELAX_MAX_ATOM_STEP);

  /* LA CONTRAINTE AVANCE PAR PALIERS — « le programme commence à rapprocher les
     deux atomes pas à pas ». La cible de chaque distance demandée part de la
     distance ACTUELLE et rejoint la cible en la moitié des pas ; l'autre moitié
     relâche la géométrie à la cible finale. Imposer la cible d'un coup (mesuré)
     fait écraser des angles de 45° là où le rapprochement progressif laisse la
     molécule se replier en gardant ses liaisons et ses angles. */
  const pairStartDistances = beforePairs.map((p) => p.distance);
  const pairTargets = active.pairs.map((t) => t.target);
  const rampSteps = Math.max(1, Math.round(maxSteps / 2));

  for (let s = 0; s < maxSteps; s += 1) {
    const ramp = Math.min(1, (s + 1) / rampSteps);
    let targetMoved = false;
    active.pairs.forEach((t, i) => {
      const next = pairStartDistances[i] + (pairTargets[i] - pairStartDistances[i]) * ramp;
      if (next !== t.target) { t.target = next; targetMoved = true; }
    });
    if (targetMoved) {
      current = energyOf(active, x, { grad, hess, ref: x0, tether: tetherWeight, movable: movableList });
      evaluations += 1;
      quiet = 0;
    }
    /* LA DIRECTION — la plus grande pente PRÉCONDITIONNÉE : chaque coordonnée se
       déplace de −g/h, où h est SA raideur (la diagonale de Gauss-Newton, 2w fois le
       carré du jacobien du terme). Un poids de 100 sur les longueurs et de 0.02 sur
       les angles ont ainsi chacun leur pas, au lieu que le terme le plus raide
       impose son échelle à tous les autres (sans ce préconditionneur, la descente
       oscillait et s'arrêtait à une énergie de 11 au lieu de 0.01 : mesuré).
       La direction est ensuite ramenée à un RAYON DE CONFIANCE : le déplacement d'un
       atome ne dépasse pas `cap`, qui décroît avec les pas — les premiers viennent
       de loin, les derniers ajustent finement. */
    let gmax = 0;
    for (const i of movableList) {
      const g = Math.max(
        Math.abs(grad[i * 3]), Math.abs(grad[i * 3 + 1]), Math.abs(grad[i * 3 + 2]),
      );
      if (g > gmax) gmax = g;
    }
    if (gmax < gradientTolerance) { reason = 'converged'; break; }
    dir.fill(0);
    let dmax = 0;
    for (const i of movableList) {
      for (let c = 0; c < 3; c += 1) {
        const k = i * 3 + c;
        dir[k] = hess[k] > 1e-12 ? -grad[k] / hess[k] : 0;
      }
      const d = Math.hypot(dir[i * 3], dir[i * 3 + 1], dir[i * 3 + 2]);
      if (d > dmax) dmax = d;
    }
    if (!(dmax > 1e-15)) { reason = 'converged'; break; }
    const progress = maxSteps > 1 ? s / (maxSteps - 1) : 1;
    const cap = Math.max(capMax * 0.05, capMax * (1 - 0.95 * progress));
    const scale = cap / dmax;
    for (const i of movableList) {
      dir[i * 3] *= scale; dir[i * 3 + 1] *= scale; dir[i * 3 + 2] *= scale;
    }

    /* LE PAS — divisé par deux jusqu'à ce que l'énergie BAISSE vraiment. Si aucun
       pas ne la fait baisser, la descente est arrivée sur un palier : elle s'ARRÊTE
       et le DIT (aucun pas inventé pour faire semblant). */
    const wasTotal = current.total;
    let accepted = false;
    let move = 1;
    for (let back = 0; back < 16; back += 1) {
      const trial = x.slice();
      for (let k = 0; k < n3; k += 1) trial[k] += dir[k] * move;
      const e = energyOf(active, trial, { ref: x0, tether: tetherWeight, movable: movableList });
      evaluations += 1;
      if (e.total < wasTotal - 1e-12) {
        x = trial;
        current = energyOf(active, x, { grad, hess, ref: x0, tether: tetherWeight, movable: movableList });
        evaluations += 1;
        accepted = true;
        break;
      }
      move /= 2;
    }
    taken = s + 1;
    if (!accepted) { reason = 'stalled'; break; }
    if (wasTotal - current.total < tolerance) {
      quiet += 1;
      if (quiet >= 2) { reason = 'converged'; break; }
    } else {
      quiet = 0;
    }
  }

  /* LE RAPPORT — relu sur les coordonnées RÉELLEMENT obtenues, jamais supposé. La
     cible de chaque paire est celle de l'UTILISATEUR (le rapprochement par paliers
     n'est qu'un chemin), et l'énergie est recalculée à cette cible-là. */
  active.pairs.forEach((t, i) => { t.target = pairTargets[i]; });
  const afterPairs = pairReportOf(active, x);
  const moved = [];
  for (const i of movableList) {
    if (Math.abs(x[i * 3] - x0[i * 3]) + Math.abs(x[i * 3 + 1] - x0[i * 3 + 1])
      + Math.abs(x[i * 3 + 2] - x0[i * 3 + 2]) > 1e-9) moved.push(i);
  }
  const reached = afterPairs.length > 0 && afterPairs.every((p) => p.reached);
  return {
    ok: true, reason, converged: reached, reached, unstuck,
    positions: x,
    moved,
    before,
    after: summaryOf(energyOf(active, x)),
    pairs: beforePairs.map((p, i) => ({
      i: p.i, j: p.j, target: p.target,
      before: p.distance, after: afterPairs[i].distance,
      deviation: afterPairs[i].deviation, reached: afterPairs[i].reached,
    })),
    steps: taken,
    evaluations,
    terms: termInfo,
    hybrids: terms.hybrids,
  };
};

