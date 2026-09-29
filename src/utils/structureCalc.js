/* ============================================================================
   src/utils/structureCalc.js
   🧬 CALCUL DE STRUCTURE — n DÉPARTS TIRÉS AU HASARD, LE ⚒ SUR CHACUN, m RETENUES.

   La demande, mot pour mot : « Implement a structure calculation button in which the
   user provide the distances between atom pairs and selects the number of starting
   structures n and the number of retained structures m. The program must then generate
   n structures by randomly assigning values of all dihedral angles. From each of these
   n structure the protocol of “model build” is applied to respect the distance
   constraints and the final result is scored. the best m structures are retained. »

   Ce module fait ces quatre choses, dans cet ordre, et rien d'autre :

     1. LES DIÈDRES DU DÉPART SONT TIRÉS — `rotatableBondsOf` lit les liaisons qui SONT
        un dièdre (simple, hors cycle, avec des atomes des deux côtés) et
        `randomTorsionsOf` en pose une valeur uniforme dans (−180, 180) par
        `planTorsion` : rotation rigide, donc longueurs et angles intacts. Le tirage
        vient de `makeRelaxRandom` (la graine du ⚒) : le même n donne les mêmes départs.
     2. LE RECUIT, PUIS LE PROTOCOLE DU ⚒ SUR CHACUN — `annealTorsionsOf` : Metropolis
        (exp(−Δ/T)) en espace dihédral, température décroissante, terme ω trans et cœur
        dur. Puis EXACTEMENT le ⚒ : `buildModelGeometry` (chimie et empilements),
        chaque distance conduite par `relaxGeometry`, un balayage après les gestes, et
        une TREMPE froide sous longe pour réparer ce que la descente a cassé.
     3. CHAQUE RÉSULTAT EST NOTÉ — `scoreStructureOf` : la fonction cible du ⚒ sans la
        longe, plus la pénalité d'empilement et le terme ω. Rien n'est réinventé.
     4. LES m MEILLEURES SONT GARDÉES — `rankStructureAttempts`, avec le rapport de la
        famille : ce que chaque distance y mesure, et la dispersion des m modèles après
        superposition optimale.

   CE QU'IL N'EST PAS : ni dynamique moléculaire, ni champ de forces — aucune charge,
   aucun solvant, aucune entropie, aucun atome ajouté, et le score n'est comparable qu'à
   l'intérieur d'un même calcul. Le recuit, lui, existe : il est EN ESPACE DIHÉDRAL (un
   pas = une rotation rigide), et c'est le terme ω ci-dessus qui tient les liaisons
   peptidiques en trans — là où le ⚒ seul les laissait partir en cis.

   Module PUR, comme ses voisins : il ne touche NI ses arguments NI l'écran, il ne
   connaît ni NGL ni React. Les coordonnées entrent à plat (trois nombres par atome)
   et ressortent de même — c'est ce que `positionFromArray` écrit.
   ========================================================================= */

import {
  /* les tables, les poids et les bornes du ⚒ — jamais une seconde vérité */
  RELAX_WEIGHTS, RELAX_CLASH_DISTANCE, RELAX_CLASH_WEIGHT, RELAX_CONTACT_TOLERANCE,
  RELAX_MAX_STEPS, RELAX_MAX_ATOM_STEP, RELAX_STAGE_STEP, RELAX_ESCAPE_STEPS,
  RELAX_KICK_DEG, RELAX_DEFAULT_RADIUS,
  /* le graphe, la charnière d'une liaison, la fonction cible, l'énergie */
  bondGraphOf, bondSideOf, buildRelaxTerms, energyOf, flatPositions,
  badContactsOf, clashReportOf, makeRelaxRandom, contactDistanceOf,
  /* LES DEUX MOITIÉS DU PROTOCOLE « MODEL BUILD » — celles du bouton ⚒ */
  buildModelGeometry, relaxGeometry,
} from './geometryRelax.js';
/* LE dièdre du dossier (convention IUPAC signée) et LA rotation du dossier — il n'y
   a pas de second lecteur de dièdre dans cette application. */
import { dihedralDeg, planTorsion } from './torsionDrive.js';
/* La superposition optimale (kabsch, par utils/mdAnalysis.js) — pour la dispersion de
   la famille SEULEMENT : rien n'est calculé ici qui existe déjà ailleurs. */
import { rigidTransform } from './structureFit.js';

/* ── 1 · LES BORNES ET LA GRAINE ───────────────────────────────────────────────
   Ce que le panneau propose, et ce que le module accepte. Les bornes ne sont pas
   décoratives : n départs × le protocole du ⚒ est un calcul qu'on ATTEND, et
   au-delà de soixante-quatre la mémoire des coordonnées de famille (n × 3N) et le
   temps de la descente n'ont plus rien à voir avec un clic. */

/** n proposé par le panneau (le nombre de structures de départ). */
export const STRUCTURE_CALC_DEFAULT_STARTS = 8;
/** n maximal — au-delà, un « clic » n'est plus un clic. */
export const STRUCTURE_CALC_MAX_STARTS = 64;
/** m proposé par le panneau (le nombre de structures RETENUES). */
export const STRUCTURE_CALC_DEFAULT_KEEP = 3;
/** m maximal — une famille d'essais se regarde, elle ne se noie pas. */
export const STRUCTURE_CALC_MAX_KEEP = 12;
/** LA GRAINE — fixe, comme celle du ⚒ : le même calcul redonne exactement les mêmes
 *  n départs, le même classement et les mêmes m modèles. Un calcul qu'on ne peut pas
 *  refaire n'est pas un calcul, c'est une capture d'écran. */
export const STRUCTURE_CALC_SEED = 0x5EEDCA1C;
/** Le PAS d'une graine de départ : la graine du départ k est la graine de base
 *  AVANCÉE de k pas dorés (Knuth, 2³²/φ) — deux départs ne tirent donc jamais la
 *  même suite, et l'indice k redonne toujours le même tirage. */
export const STRUCTURE_CALC_SEED_STEP = 0x9E3779B1;
/** À partir de quel écart une distance demandée n'est plus respectée. 0.25 Å : c'est
 *  l'ordre de grandeur d'une contrainte NOE tenue, PAS les 0.05 Å de
 *  RELAX_PAIR_TOLERANCE (qui dit « la descente a posé la distance exactement »). Un
 *  modèle peut donc être « retenu » avec 0.2 Å d'écart, et le rapport l'écrit. */
export const STRUCTURE_CALC_RESTRAINT_TOLERANCE = 0.25;
/** Combien de BALAYAGES des contraintes chaque départ reçoit : chaque balayage
 *  conduit ce qui n'est pas respecté (la plus fausse d'abord), puis laisse le ⚒
 *  rebalayer la chimie et le cœur dur — les mouvements qu'il vient de faire peuvent
 *  avoir créé d'autres empilements, exactement comme dans le construit automatique
 *  (« se il protocollo sulla prima distanza ha generato altre distanze incorrette si
 *  passa alla seconda »). */
export const STRUCTURE_CALC_PASSES = 3;
/** LE BUDGET DE LA PRÉPARATION D'UN DÉPART (le ⚒ sans atome piqué, §8bis) — le même
 *  protocole, un budget plus court : n départs × le budget complet d'un clic ne
 *  serait pas un calcul qu'on attend. Le rapport dit quand le plafond mord
 *  (`truncated` du module). */
export const STRUCTURE_CALC_BUILD_PASSES = 2;
/** …combien de longueurs et de contacts la préparation d'un départ conduit par
 *  balayage (le ⚒ en conduit 24 et 8 : ici, n fois ce chiffre). */
export const STRUCTURE_CALC_BUILD_DISTANCES = 8;
export const STRUCTURE_CALC_BUILD_CONTACTS = 4;
/** Combien de contraintes le module accepte (au-delà, ce n'est plus une liste qu'on
 *  relit à l'écran). */
export const STRUCTURE_CALC_MAX_RESTRAINTS = 40;
/** Les 🎲 bottes de torsion d'une descente de contrainte : 0 par défaut — ici la
 *  diversification, c'est n, et payer 6 bottes × n départs × les contraintes serait
 *  payer deux fois la même chose. Le panneau envoie SON réglage (celui du ⚒), donc
 *  l'utilisateur qui veut les bottes les a. */
export const STRUCTURE_CALC_ESCAPES = 0;
/** Le budget de pas d'une descente de contrainte (celui du ⚒). */
export const STRUCTURE_CALC_STEPS = RELAX_MAX_STEPS;

/* 1bis · LE RECUIT EN ESPACE DIHÉDRAL — les six chiffres du plan de température.
   Un tirage uniforme est un point AU HASARD dans un espace de très grande
   dimension : presque toujours empilé ou loin des distances, et la descente du ⚒
   qui suit est LOCALE — elle ne sort pas d'un creux. Le recuit accepte un pas qui
   empire (Metropolis, exp(−Δ/T)) avec T décroissant : c'est ce qui atteint une
   conformation qui SATISFAIT les distances sans la connaître d'avance (CYANA et
   XPLOR font cela en espace dihédral). Aucun atome, aucune charge, aucun solvant
   n'est ajouté : ce sont des chiffres de RECUIT, pas une force. */
export const STRUCTURE_CALC_ANNEAL_STEPS = 6;         // paliers de température
export const STRUCTURE_CALC_ANNEAL_HOT = 1;           // T du premier palier…
export const STRUCTURE_CALC_ANNEAL_COLD = 0.02;       // …et du dernier (× le coût du départ)
export const STRUCTURE_CALC_ANNEAL_MOVES = 12;        // pas ESSAYÉS par canal et par palier
export const STRUCTURE_CALC_ANNEAL_AMPLITUDE = 180;   // ° du pas — un dièdre ordinaire
export const STRUCTURE_CALC_ANNEAL_OMEGA_AMPLITUDE = 12; // ° — une liaison peptidique
/* LE TERME ω — une liaison peptidique préfère TRANS (ω = 180°). Le plateau (± 30°)
   est le désordre réel d'une chaîne : le terme ne mord qu'au-delà, et c'est ce qui
   remplace « le ⚒ n'a aucune cible d'ω » d'avant ce recuit. */
export const STRUCTURE_CALC_OMEGA = 180;
export const STRUCTURE_CALC_OMEGA_TOLERANCE = 30;
export const STRUCTURE_CALC_OMEGA_WEIGHT = 2;
/* LE CŒUR DUR DU RECUIT — la portée de la grille qui cherche les couples trop
   serrés (Å : le contact le plus long est ~2.2, donc 2.4 les attrape tous), et
   tous les combien de pas la grille est refaite (les atomes ont bougé). */
export const STRUCTURE_CALC_CORE_REACH = 2.4;
export const STRUCTURE_CALC_CORE_REFRESH = 24;
/* LA TREMPE FINALE — le protocole du ⚒ n'a AUCUNE cible d'ω : en conduisant une
   distance, sa descente peut remettre une liaison peptidique en cis (mesuré, pas
   supposé). Après le protocole, un dernier recuit FROID répare ce que la descente a
   cassé — avec une LONGE : aucun mouvement qui ferait sortir une distance DÉJÀ
   respectée de sa tolérance n'est accepté. Trois paliers suffisent : à froid, seuls
   les mouvements qui améliorent sont gardés. */
export const STRUCTURE_CALC_QUENCH_STEPS = 3;

/* ── 2 · CE QUE L'UTILISATEUR IMPOSE : LES DISTANCES ENTRE COUPLES D'ATOMES ────
   « the user provide the distances between atom pairs ». La liste reçue est
   NORMALISÉE une fois pour toutes (les deux écritures acceptées — `[[i, j, d]]` et
   `[{i, j, target}]` —, les indices hors molécule, les couples dégénérés, les cibles
   absurdes et les doublons écartés, le plafond appliqué) et TOUT ce qui suit lit
   cette liste-là : un couple ne peut donc pas exister pour le rapport et pas pour la
   descente, comme une liaison ne peut pas exister pour la fenêtre et pas pour les
   termes (la règle du dossier). `dropped` COMPTE ce qui a été écarté au lieu de le
   taire : le panneau le dit. */

const clampInt = (v, min, max, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
/** La distance de deux atomes d'un tableau à plat (trois nombres par atome). */
const dist3 = (x, i, j) => Math.hypot(x[i * 3] - x[j * 3], x[i * 3 + 1] - x[j * 3 + 1], x[i * 3 + 2] - x[j * 3 + 2]);
const wrapSeed = (v) => (Math.round(Number(v)) >>> 0) || 0;

/**
 * LA LISTE DES CONTRAINTES, NORMALISÉE — `{list, dropped, count}`.
 * `list` = `{i, j, target, order}` dans l'ordre reçu (le numéro `order` est celui
 * que le rapport affiche : « 1 = 12–48 à 6.00 Å »), `dropped` = combien d'entrées
 * ont été écartées (mauvais indices, couple dégénéré, cible non finie ou ≤ 0,
 * doublon d'un couple déjà imposé, au-delà de STRUCTURE_CALC_MAX_RESTRAINTS).
 */
export const restraintListOf = ({ restraints = [], atomCount = 0 } = {}) => {
  const count = clampInt(atomCount, 0, Number.MAX_SAFE_INTEGER, 0);
  const list = [];
  const seen = new Set();
  let dropped = 0;
  for (const raw of Array.from(restraints || [])) {
    const r = Array.isArray(raw) ? { i: raw[0], j: raw[1], target: raw[2] } : (raw || {});
    const i = Number(r.i); const j = Number(r.j); const target = Number(r.target);
    const bad = !Number.isInteger(i) || !Number.isInteger(j) || i === j || i < 0 || j < 0
      || (count > 0 && (i >= count || j >= count))
      || !Number.isFinite(target) || target <= 0;
    if (bad) { dropped += 1; continue; }
    const key = i < j ? `${i}-${j}` : `${j}-${i}`;
    if (seen.has(key)) { dropped += 1; continue; }
    seen.add(key);
    if (list.length >= STRUCTURE_CALC_MAX_RESTRAINTS) { dropped += 1; continue; }
    list.push({ i, j, target, order: list.length + 1 });
  }
  return { list, dropped, count: list.length };
};

/**
 * CE QUE CHAQUE DISTANCE DEMANDÉE MESURE — relu sur les coordonnées reçues, jamais
 * supposé. Une contrainte est RESPECTÉE à `tolerance` près (0.25 Å par défaut) et le
 * rapport donne les deux chiffres : l'écart signé (`deviation`, positif = les deux
 * atomes sont plus loin que demandé) et sa valeur absolue. `rmsd` = la racine de la
 * moyenne des écarts au carré — le seul chiffre qui résume la liste —, `severity` =
 * la somme des |écart| (le chiffre dont les balayages se servent pour savoir si un
 * passage a AMÉLIORÉ quelque chose), `worst` = la plus fausse.
 */
export const restraintReportOf = ({
  positions = null, restraints = [], tolerance = STRUCTURE_CALC_RESTRAINT_TOLERANCE,
} = {}) => {
  const read = flatPositions(positions);
  const limit = Number(tolerance) >= 0 ? Number(tolerance) : STRUCTURE_CALC_RESTRAINT_TOLERANCE;
  const out = {
    count: 0, tolerance: limit, satisfied: 0, violations: 0,
    rmsd: 0, severity: 0, worst: null, list: [],
  };
  if (!read) return out;
  const x = read.flat;
  const clean = restraintListOf({ restraints, atomCount: read.count }).list;
  out.count = clean.length;
  let sumSq = 0;
  for (const r of clean) {
    const distance = dist3(x, r.i, r.j);
    const deviation = distance - r.target;
    const abs = Math.abs(deviation);
    const satisfied = abs <= limit;
    const entry = {
      i: r.i, j: r.j, order: r.order, target: r.target,
      distance, deviation, abs, satisfied,
    };
    out.list.push(entry);
    if (satisfied) out.satisfied += 1; else out.violations += 1;
    sumSq += deviation * deviation;
    out.severity += abs;
    if (!out.worst || abs > out.worst.abs) out.worst = { ...entry };
  }
  out.rmsd = out.count ? Math.sqrt(sumSq / out.count) : 0;
  return out;
};

/* ── 3 · LES DIÈDRES D'UNE MOLÉCULE, ET LE TIRAGE ─────────────────────────────
   « randomly assigning values of all dihedral angles ». Un dièdre, pour un graphe de
   liaisons, c'est une liaison qui est une CHARNIÈRE : elle tourne (simplement liée),
   elle n'est pas dans un cycle (la faire tourner déformerait le cycle au lieu de
   tourner un bout), et ses DEUX côtés portent quelque chose (un atome terminal ne
   fait pas un dièdre : il n'y a pas de quatrième atome à lire). Ce lecteur-là ne
   touche à rien ; `randomTorsionsOf` pose ensuite les angles tirés. */

/** Les canaux de torsion d'une molécule — `{count, channels, ring, multiple,
 *  terminal, checked}`. Un canal = `{i, j, axis:[B,C], ref:A, probe:D, moving[…],
 *  movingCount, anchorCount, probeAtoms:[A,B,C,D]}` : `moving` (TRIÉ, contrat de
 *  `planTorsion`) est le côté qui tourne — le plus PETIT des deux, parce qu'un
 *  dièdre tourne le bout et pas le reste de la molécule —, `probeAtoms` est le
 *  quadruplet sur lequel le dièdre se lit, et `ring`/`multiple`/`terminal` comptent
 *  ce que le lecteur a écarté et POURQUOI (les liaisons d'un cycle, les doubles et
 *  triples, les liaisons à un atome terminal). */
export const rotatableBondsOf = ({ elements = [], bonds = [], atomCount = 0 } = {}) => {
  const els = Array.from(elements || []);
  const count = clampInt(atomCount || els.length, 0, Number.MAX_SAFE_INTEGER, 0);
  const graph = bondGraphOf({ bonds, atomCount: count });
  const out = {
    count: 0, checked: graph.list.length, channels: [],
    ring: 0, multiple: 0, terminal: 0, unknown: 0,
  };
  /* L'ORDRE DES CANAUX EST FIXE — par indices croissants, jamais l'ordre où le
     fichier déclare ses liaisons : le même graphe donne donc toujours la même suite
     de tirages, quel que soit l'ordre des CONECT. */
  const ordered = [...graph.list].sort((a, b) => (a.i - b.i) || (a.j - b.j));
  const nbOf = (a) => graph.neighbours(a).map(Number)
    .filter((k) => Number.isInteger(k) && k >= 0 && k < count).sort((p, q) => p - q);
  for (const { i, j, order } of ordered) {
    if (order !== 1) { out.multiple += 1; continue; }
    const sideI = bondSideOf({ neighbours: graph.neighbours, atom: i, other: j, atomCount: count });
    const sideJ = bondSideOf({ neighbours: graph.neighbours, atom: j, other: i, atomCount: count });
    if (sideI == null || sideJ == null) { out.ring += 1; continue; }
    if (!sideI.length || !sideJ.length) { out.terminal += 1; continue; }
    const turnJ = sideJ.length <= sideI.length;
    const moving = (turnJ ? sideJ : sideI).slice().sort((a, b) => a - b);
    const anchor = new Set(turnJ ? sideI : sideJ);
    const movingSet = new Set(moving);
    const axis = turnJ ? [i, j] : [j, i];
    /* A — la référence du dièdre : un voisin de l'atome d'ANCRAGE, du côté qui ne
       tourne pas. D — l'atome mobile lu : un voisin de l'atome qui tourne, du côté
       qui tourne. Les deux existent forcément (chaque côté est non vide et connexe à
       son atome d'axe) ; sinon le canal est COMPTÉ et laissé de côté, jamais deviné. */
    const ref = nbOf(axis[0]).filter((k) => anchor.has(k))[0];
    const probe = nbOf(axis[1]).filter((k) => movingSet.has(k))[0];
    if (!Number.isInteger(ref) || !Number.isInteger(probe)) { out.unknown += 1; continue; }
    out.channels.push({
      i, j, order, axis, ref, probe, moving,
      movingCount: moving.length, anchorCount: anchor.size,
      probeAtoms: [ref, axis[0], axis[1], probe],
    });
  }
  out.count = out.channels.length;
  return out;
};

/**
 * LE DÉPART TIRÉ AU HASARD — un angle uniforme dans (−180, 180) par canal, POSÉ par
 * `planTorsion` (rotation rigide d'un côté autour de l'axe, en quaternion) : les
 * longueurs, les angles et les cycles de la molécule ne bougent pas d'un chiffre,
 * seuls les dièdres changent. Rend la structure tirée à plat (`positions`), ce que
 * chaque canal a reçu (`turned` : l'angle tiré ET le dièdre relu avant/après), et ce
 * que `planTorsion` a refusé (`skipped`, avec sa raison — un quadruplet aligné n'a
 * pas de dièdre, et un nombre inventé vaudrait moins que ce silence).
 *
 * `rng` permet d'injecter un tirage ; sans lui, `makeRelaxRandom(graine)` — le
 * générateur du ⚒, il n'y en a pas d'autre dans le dossier.
 */
export const randomTorsionsOf = ({
  positions = null, elements = [], bonds = [], atomCount = 0,
  seed = STRUCTURE_CALC_SEED, rng = null, channels = null,
} = {}) => {
  const read = flatPositions(positions);
  if (!read) {
    return {
      ok: false, reason: 'bad-points', positions: null, channels: [], channelCount: 0,
      counts: null, turned: [], skipped: [], drawn: 0,
    };
  }
  const count = read.count;
  /* LE GRAPHE EST RECADRÉ SUR LES COORDONNÉES REÇUES — une liaison qui nomme un atome
     au-delà du dernier atome lu n'a aucune coordonnée à tourner : un `atomCount`
     demandé plus grand est donc ramené à ce que la molécule a. */
  const asked = clampInt(atomCount, 0, Number.MAX_SAFE_INTEGER, 0);
  const list = channels || rotatableBondsOf({
    elements, bonds, atomCount: asked > 0 ? Math.min(asked, count) : count,
  });
  const chan = Array.from(list.channels || []);
  const draw = typeof rng === 'function' ? rng : makeRelaxRandom(wrapSeed(seed));
  const x = read.flat.slice();
  const pt = (i) => [x[i * 3], x[i * 3 + 1], x[i * 3 + 2]];
  const turned = [];
  const skipped = [];
  for (const ch of chan) {
    /* ARRONDI AU MILLIÈME DE DEGRÉ — un rapport se lit, et rien d'autre ne change :
       le même tirage donne le même nombre pour tout le monde. */
    const angle = Number((draw() * 360 - 180).toFixed(3));
    const plan = planTorsion({
      points: ch.probeAtoms.map(pt),
      moved: ch.moving.map(pt),
      request: { angleDeg: angle },
    });
    if (!plan.ok) { skipped.push({ i: ch.i, j: ch.j, why: plan.reason }); continue; }
    ch.moving.forEach((k, c) => {
      const p = plan.positions[c];
      x[k * 3] = p[0]; x[k * 3 + 1] = p[1]; x[k * 3 + 2] = p[2];
    });
    turned.push({
      i: ch.i, j: ch.j, axis: ch.axis, atoms: ch.movingCount,
      drawn: angle, before: plan.beforeDeg, after: plan.afterDeg,
      turned: Number(plan.deltaDeg.toFixed(3)),
    });
  }
  return {
    ok: true, reason: 'ok', positions: x, channels: chan,
    channelCount: list.count == null ? chan.length : list.count,
    counts: {
      ring: list.ring || 0, multiple: list.multiple || 0,
      terminal: list.terminal || 0, unknown: list.unknown || 0,
    },
    turned, skipped, drawn: turned.length,
  };
};

/** LE DIHÈDRE QUE CHAQUE CANAL A MAINTENANT — relu par LE lecteur du dossier
 *  (`dihedralDeg`, la convention IUPAC signée de utils/torsionDrive.js) sur les
 *  coordonnées reçues : c'est ce que le rapport affiche après coup, jamais ce que le
 *  tirage a demandé. `deg` vaut `null` quand le quadruplet n'a plus de dièdre. */
export const channelReadingsOf = ({ positions = null, channels = [] } = {}) => {
  const read = flatPositions(positions);
  if (!read) return [];
  const x = read.flat;
  const pt = (i) => [x[i * 3], x[i * 3 + 1], x[i * 3 + 2]];
  const out = [];
  for (const ch of Array.from(channels || [])) {
    const [A, B, C, D] = ch.probeAtoms || [];
    out.push({
      i: ch.i, j: ch.j, axis: ch.axis, atoms: ch.movingCount,
      deg: dihedralDeg(pt(A), pt(B), pt(C), pt(D)),
    });
  }
  return out;
};

/* ── 3bis · LA PHYSIQUE AJOUTÉE — LE RECUIT, ET LE TERME ω ───────────────────
   Deux ajouts, et rien d'autre : un TERME (ω, la liaison peptidique préfère trans) et
   un GESTE (le recuit simulé en espace dihédral). Le geste est une rotation RIGIDE
   d'un côté autour de sa charnière (`planTorsion`, le même écrivain de torsion que le
   panneau ✏️ et que le tirage ci-dessus) : une longueur, un angle ou un cycle ne
   bougent pas d'un chiffre, seuls les dièdres changent. C'est ce qui permet le recuit
   sans champ de forces : on ne déplace pas des atomes, on TOURNE des liaisons. */

/** LES LIAISONS PEPTIDIQUES D'UNE MOLÉCULE — celles qui portent un ω.
 *  Reconnues par la chimie seule, jamais par un nom d'atome : un C qui porte un O
 *  (carbonyle) lié par une liaison SIMPLE à un N qui porte lui-même un autre C. Le
 *  dièdre visé est le dièdre IUPAC CA–C–N–CA (`probeAtoms`), et il est TRANS à 180°.
 *  Rend `{i, j, c, n, probeAtoms, target}` par liaison peptidique, dans l'ordre du
 *  graphe : deux appels sur la même molécule rendent la même liste. */
export const peptideOmegasOf = ({ elements = [], bonds = [], atomCount = 0 } = {}) => {
  const els = Array.from(elements || []).map((e) => String(e == null ? '' : e).trim().toUpperCase());
  /* `atomCount` sert quand les ÉLÉMENTS ne sont pas donnés : le graphe a besoin d'une
     borne, et un appelant qui ne connaît que le nombre d'atomes ne doit pas être ignoré. */
  const count = els.length || Math.max(0, Math.round(Number(atomCount) || 0));
  const graph = bondGraphOf({ bonds, atomCount: count });
  const out = [];
  for (const { i, j, order } of graph.list) {
    if (order !== 1) continue;
    const c = els[i] === 'C' && els[j] === 'N' ? i : (els[j] === 'C' && els[i] === 'N' ? j : -1);
    if (c < 0) continue;
    const n = c === i ? j : i;
    const nbC = graph.neighbours(c).filter((k) => k !== n);
    const nbN = graph.neighbours(n).filter((k) => k !== c);
    if (!nbC.some((k) => els[k] === 'O')) continue;        // pas un carbonyle : pas un ω
    const caC = nbC.find((k) => els[k] === 'C');
    const caN = nbN.find((k) => els[k] === 'C');
    if (!Number.isInteger(caC) || !Number.isInteger(caN)) continue;
    out.push({ i: c, j: n, c, n, probeAtoms: [caC, c, n, caN], target: STRUCTURE_CALC_OMEGA });
  }
  return out;
};

/** CE QUE LE TERME ω COÛTE SUR CES COORDONNÉES — `{count, penalty, violations, worst,
 *  list}`. Le plateau fait le travail : un ω à ± 30° de 180° ne coûte RIEN (c'est le
 *  désordre d'une vraie chaîne), au-delà il coûte `weight × (écart − plateau)²`. */
export const omegaPenaltyOf = ({ positions = null, omegas = [] } = {}) => {
  const read = flatPositions(positions);
  if (!read) return { count: 0, penalty: 0, violations: 0, worst: null, list: [] };
  const x = read.flat;
  const pt = (k) => [x[k * 3], x[k * 3 + 1], x[k * 3 + 2]];
  const list = [];
  let penalty = 0;
  let violations = 0;
  let worst = null;
  for (const o of Array.from(omegas || [])) {
    const [a, b, c, d] = o.probeAtoms || [];
    const deg = dihedralDeg(pt(a), pt(b), pt(c), pt(d));
    if (!Number.isFinite(deg)) continue;
    const dev = Math.abs(((deg - o.target + 540) % 360) - 180);   // écart réel, 0..180
    const over = Math.max(0, dev - STRUCTURE_CALC_OMEGA_TOLERANCE);
    penalty += STRUCTURE_CALC_OMEGA_WEIGHT * over * over;
    if (over > 0) violations += 1;
    const row = { i: o.i, j: o.j, deg, target: o.target, dev, over };
    list.push(row);
    if (!worst || over > worst.over) worst = row;
  }
  return { count: list.length, penalty, violations, worst, list };
};

/** LE RECUIT — la seule fonction du dossier qui ACCEPTE un pas qui empire.
 *
 *  Chaque pas est une rotation RIGIDE d'un côté de molécule autour d'une charnière
 *  (`planTorsion`) : les longueurs et les angles d'un côté ne bougent pas d'un
 *  chiffre, donc l'énergie des liaisons, des angles et des plans est une CONSTANTE
 *  pendant tout le recuit — seules les distances demandées qui TRAVERSENT la
 *  charnière, le cœur dur et le terme ω peuvent changer. C'est pour cela qu'un recuit
 *  en espace dihédral est abordable : un pas ne relit qu'une poignée de termes.
 *
 *  Un pas est accepté s'il n'empire pas, ou avec la probabilité exp(−Δ/T) — la loi de
 *  Metropolis — T étant le palier courant (chaud d'abord : les conformations
 *  s'échangent ; froid à la fin : la dernière est un minimum local). Le tirage vient
 *  d'un `makeRelaxRandom(graine)` : mêmes paliers, mêmes pas, même résultat.
 *
 *  Rend `{ok, reason, positions, channels, omegas, schedule, tried, accepted,
 *  skipped, cost:{before, after}, omega}` : `schedule` porte une ligne par palier
 *  (`{step, temperature, tried, accepted, cost, of}`) — un recuit se LIT.
 */
export const annealTorsionsOf = ({
  positions = null, elements = [], bonds = [], restraints = [],
  channels = null, omegas = null, weights = RELAX_WEIGHTS, leash = null,
  seed = STRUCTURE_CALC_SEED, rng = null,
  steps = STRUCTURE_CALC_ANNEAL_STEPS,
  hot = STRUCTURE_CALC_ANNEAL_HOT, cold = STRUCTURE_CALC_ANNEAL_COLD,
  moves = STRUCTURE_CALC_ANNEAL_MOVES,
  amplitude = STRUCTURE_CALC_ANNEAL_AMPLITUDE,
  omegaAmplitude = STRUCTURE_CALC_ANNEAL_OMEGA_AMPLITUDE,
  coreReach = STRUCTURE_CALC_CORE_REACH,
  refresh = STRUCTURE_CALC_CORE_REFRESH,
  protectOmega = false,
  onStep = null,
} = {}) => {
  const read = flatPositions(positions);
  if (!read) {
    return {
      ok: false, reason: 'bad-points', positions: null, channels: 0, omegas: 0,
      schedule: [], tried: 0, accepted: 0, skipped: 0,
      cost: { before: 0, after: 0 }, omega: null,
    };
  }
  const count = read.count;
  const els = Array.from(elements || []);
  const clean = restraintListOf({ restraints, atomCount: count }).list;
  /* LES CANAUX — acceptés soit comme la liste rendue par `rotatableBondsOf`
     (`{channels,…}`), soit comme le TABLEAU de canaux seul : le module tolère les
     deux, donc un appelant ne peut pas se tromper de forme. */
  const list = Array.isArray(channels)
    ? { channels }
    : (channels || rotatableBondsOf({ elements: els, bonds, atomCount: count }));
  const chan = Array.from(list.channels || []);
  const omega = Array.from(omegas || peptideOmegasOf({ elements: els, bonds, atomCount: count }));
  const x = read.flat.slice();
  const out = {
    ok: true, reason: 'ok', positions: x, channels: chan.length, omegas: omega.length,
    schedule: [], tried: 0, accepted: 0, skipped: 0, cost: { before: 0, after: 0 }, omega: null,
  };
  const nStep = clampInt(steps, 0, 64, STRUCTURE_CALC_ANNEAL_STEPS);
  if (!chan.length || !nStep) { out.reason = chan.length ? 'no-step' : 'no-channel'; return out; }
  const random = typeof rng === 'function' ? rng : makeRelaxRandom(wrapSeed(seed));
  /* LES TERMES DU ⚒, lus UNE fois : seules les distances demandées servent ici (les
     liaisons, les angles et les plans sont constants, voir plus haut). */
  const terms = buildRelaxTerms({ elements: els, bonds, pairs: clean, weights, positions: x });
  /* LA LONGE — les distances DÉJÀ respectées qu'un pas n'a pas le droit de casser
     (`{i, j, tolerance}` par couple). Aucun coût en plus dans la boucle : la règle se
     lit sur les couples qui traversent la charnière, les seuls qu'un pas change. */
  const leashOf = new Map();
  for (const r of Array.from(leash || [])) {
    const li = Number(r && r.i); const lj = Number(r && r.j);
    if (!Number.isInteger(li) || !Number.isInteger(lj)) continue;
    const tol = Number(r.tolerance);
    leashOf.set(li < lj ? `${li}-${lj}` : `${lj}-${li}`,
      Number.isFinite(tol) && tol >= 0 ? tol : STRUCTURE_CALC_RESTRAINT_TOLERANCE);
  }
  const leashKey = (i, j) => (i < j ? `${i}-${j}` : `${j}-${i}`);
  const graph = bondGraphOf({ bonds, atomCount: count });
  const reach = Math.max(0.5, Number(coreReach) || STRUCTURE_CALC_CORE_REACH);
  const at = (k, map) => (map && map.has(k) ? map.get(k) : [x[k * 3], x[k * 3 + 1], x[k * 3 + 2]]);
  const gap = (i, j, map) => {
    const a = at(i, map); const b = at(j, map);
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  };
  const pairCost = (t, map) => {
    const dev = gap(t.i, t.j, map) - t.target;
    return t.weight * dev * dev;
  };
  const coreCost = (c, map) => {
    const over = c.target - gap(c.i, c.j, map);
    return over > 0 ? c.weight * over * over : 0;
  };
  const omegaCost = (o, map) => {
    const deg = dihedralDeg(at(o.probeAtoms[0], map), at(o.probeAtoms[1], map),
      at(o.probeAtoms[2], map), at(o.probeAtoms[3], map));
    if (!Number.isFinite(deg)) return 0;
    const over = Math.max(0, Math.abs(((deg - o.target + 540) % 360) - 180)
      - STRUCTURE_CALC_OMEGA_TOLERANCE);
    return STRUCTURE_CALC_OMEGA_WEIGHT * over * over;
  };

  /* LE CŒUR DUR, MAINTENANT — les couples que le graphe ne lie pas (ni directement,
     ni par un atome commun) et qui sont à portée : `contactDistanceOf` donne leur
     seuil, et le terme ne mord qu'en dessous. Une grille de `reach` les trouve sans
     le O(n²) d'une protéine, et elle est refaite régulièrement (les atomes bougent). */
  const corePairsOf = () => {
    const bonded = new Set();
    for (const b of graph.list) bonded.add(b.i < b.j ? `${b.i}-${b.j}` : `${b.j}-${b.i}`);
    const linked = (i, j) => graph.neighbours(i).some((k) => graph.neighbours(j).includes(k));
    const cell = reach;
    const key = (a, b, c) => `${a},${b},${c}`;
    const grid = new Map();
    for (let i = 0; i < count; i += 1) {
      const k = key(Math.floor(x[i * 3] / cell), Math.floor(x[i * 3 + 1] / cell),
        Math.floor(x[i * 3 + 2] / cell));
      const list = grid.get(k);
      if (list) list.push(i); else grid.set(k, [i]);
    }
    const pairs = [];
    for (let i = 0; i < count; i += 1) {
      const cx = Math.floor(x[i * 3] / cell); const cy = Math.floor(x[i * 3 + 1] / cell);
      const cz = Math.floor(x[i * 3 + 2] / cell);
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dz = -1; dz <= 1; dz += 1) {
            const list = grid.get(key(cx + dx, cy + dy, cz + dz));
            if (!list) continue;
            for (const j of list) {
              if (j <= i) continue;
              if (bonded.has(`${i}-${j}`)) continue;
              if (linked(i, j)) continue;
              pairs.push({
                i, j, target: contactDistanceOf(els[i], els[j]).distance,
                weight: Number(weights.contact) || 0,
              });
            }
          }
        }
      }
    }
    return pairs;
  };
  /* LES TERMES QUI TRAVERSENT UNE CHARNIÈRE — les seuls qu'un pas peut changer : un
     couple dont UN atome tourne et l'autre non, un ω dont UN des quatre atomes tourne.
     Lus une fois par canal (la molécule change, la liste des couples non). */
  const crossOf = (ch) => {
    const set = new Set(ch.moving);
    return {
      pairs: terms.pairs.filter((t) => set.has(t.i) !== set.has(t.j)),
      omegas: omega.filter((o) => o.probeAtoms.some((k) => set.has(k))),
    };
  };
  const omegaBond = new Set(omega.map((o) => (o.c < o.n ? `${o.c}-${o.n}` : `${o.n}-${o.c}`)));
  const isPeptide = (ch) => omegaBond.has(ch.i < ch.j ? `${ch.i}-${ch.j}` : `${ch.j}-${ch.i}`);
  let core = corePairsOf();
  let cost = 0;
  for (const t of terms.pairs) cost += pairCost(t, null);
  for (const c of core) cost += coreCost(c, null);
  for (const o of omega) cost += omegaCost(o, null);
  out.cost.before = cost;
  const scale = Math.max(1e-6, Math.abs(cost));
  const amp = Math.max(1, Math.abs(Number(amplitude) || STRUCTURE_CALC_ANNEAL_AMPLITUDE));
  const ampO = Math.max(0.5, Math.abs(Number(omegaAmplitude) || STRUCTURE_CALC_ANNEAL_OMEGA_AMPLITUDE));
  const perStep = Math.max(1, clampInt(moves, 1, 512, STRUCTURE_CALC_ANNEAL_MOVES)) * chan.length;
  const rebuild = Math.max(1, Math.round(refresh) || STRUCTURE_CALC_CORE_REFRESH);
  const caches = new Map();

  for (let s = 0; s < nStep; s += 1) {
    const frac = nStep === 1 ? 1 : s / (nStep - 1);
    const T = scale * (hot + (cold - hot) * frac);
    let tried = 0; let accepted = 0;
    for (let m = 0; m < perStep; m += 1) {
      if (m > 0 && m % rebuild === 0) {
        for (const c of core) cost -= coreCost(c, null);
        core = corePairsOf();
        for (const c of core) cost += coreCost(c, null);
      }
      const pick = Math.min(chan.length - 1, Math.floor(random() * chan.length));
      const ch = chan[pick];
      let ctx = caches.get(pick);
      if (!ctx) { ctx = crossOf(ch); caches.set(pick, ctx); }
      const probe = ch.probeAtoms.map((k) => [x[k * 3], x[k * 3 + 1], x[k * 3 + 2]]);
      const cur = dihedralDeg(probe[0], probe[1], probe[2], probe[3]);
      if (!Number.isFinite(cur)) { out.skipped += 1; continue; }
      const delta = (random() * 2 - 1) * (isPeptide(ch) ? ampO : amp);
      const want = ((cur + delta + 540) % 360) - 180;
      const plan = planTorsion({
        points: probe,
        moved: ch.moving.map((k) => [x[k * 3], x[k * 3 + 1], x[k * 3 + 2]]),
        request: { angleDeg: want },
      });
      tried += 1;
      if (!plan.ok) { out.skipped += 1; continue; }
      const map = new Map();
      ch.moving.forEach((k, c) => {
        const p = plan.positions[c];
        map.set(k, [p[0], p[1], p[2]]);
      });
      /* LA LONGE D'ABORD — un pas qui ferait sortir de sa tolérance une distance DÉJÀ
         respectée est refusé, même s'il améliore tout le reste. C'est ce qui permet à
         une trempe de réparer ω SANS lâcher les distances que le ⚒ vient d'atteindre. */
      let leashed = false;
      for (const t of ctx.pairs) {
        const tol = leashOf.get(leashKey(t.i, t.j));
        if (tol == null) continue;
        if (Math.abs(gap(t.i, t.j, null) - t.target) > tol) continue;   // pas encore tenue
        if (Math.abs(gap(t.i, t.j, map) - t.target) > tol) { leashed = true; break; }
      }
      if (leashed) { out.skipped += 1; continue; }
      let dv = 0;
      let dvOmega = 0;
      for (const t of ctx.pairs) dv += pairCost(t, map) - pairCost(t, null);
      for (const o of ctx.omegas) {
        const d = omegaCost(o, map) - omegaCost(o, null);
        dv += d;
        dvOmega += d;
      }
      /* ω NE SE DÉGRADE JAMAIS (la trempe) — un pas qui abîmerait ω est refusé même
         s'il répare un empilement : il y a assez d'autres pas pour faire les deux. */
      if (protectOmega && dvOmega > 1e-12) { out.skipped += 1; continue; }
      for (const c of core) {
        if (map.has(c.i) === map.has(c.j)) continue;
        dv += coreCost(c, map) - coreCost(c, null);
      }
      if (!(dv <= 0) && !(random() < Math.exp(-dv / T))) continue;
      for (const [k, p] of map) { x[k * 3] = p[0]; x[k * 3 + 1] = p[1]; x[k * 3 + 2] = p[2]; }
      cost += dv;
      accepted += 1;
    }
    out.tried += tried;
    out.accepted += accepted;
    const row = {
      step: s + 1, temperature: Number(T.toFixed(6)), tried, accepted,
      cost: Number(cost.toFixed(6)), of: nStep,
    };
    out.schedule.push(row);
    if (typeof onStep === 'function') {
      try { onStep({ phase: 'anneal', positions: x, ...row }); } catch { /* un rapport qui se plaint n'arrête pas le recuit */ }
    }
  }
  let finalCost = 0;
  for (const t of terms.pairs) finalCost += pairCost(t, null);
  for (const c of core) finalCost += coreCost(c, null);
  for (const o of omega) finalCost += omegaCost(o, null);
  out.cost.after = finalCost;
  out.omega = omegaPenaltyOf({ positions: x, omegas: omega });
  return out;
};

/* ── 4 · LA NOTE D'UN RÉSULTAT — « the final result is scored » ───────────────
   La MÊME fonction cible que le ⚒ (`buildRelaxTerms` + `energyOf`, molécule entière,
   distances demandées comprises), SANS la longe — n départs sont là pour explorer —,
   plus la pénalité d'empilement des 🎲 échappées (`RELAX_CLASH_WEIGHT` × gravité) et le
   terme ω (`omegaPenaltyOf`). Les familles de l'énergie sont rendues À PART : un score
   n'est pas une boîte noire, il se lit. */

/**
 * @returns {{ok:boolean, reason:string, score:number, total:number, bond:number,
 *            angle:number, planar:number, pair:number, contact:number,
 *            bondRms:number, angleRms:number, planarRms:number, contactRms:number,
 *            worstBond:object|null, worstAngle:object|null, worstPlanar:object|null,
 *            worstContact:object|null, clashPenalty:number, clashes:object,
 *            contacts:object, restraint:object}}
 *   `score` = `total + clashPenalty` — le seul chiffre du classement ; `total` = la
 *   fonction cible du ⚒ ; `restraint` = la lecture des distances demandées
 *   (`restraintReportOf`, relue sur ces coordonnées-là).
 */
export const scoreStructureOf = ({
  positions = null, elements = [], bonds = [], restraints = [],
  weights = RELAX_WEIGHTS, clashDistance = RELAX_CLASH_DISTANCE,
  tolerance = STRUCTURE_CALC_RESTRAINT_TOLERANCE, omegas = null,
} = {}) => {
  const read = flatPositions(positions);
  if (!read) {
    return {
      ok: false, reason: 'bad-points', score: Infinity, total: Infinity,
      bond: 0, angle: 0, planar: 0, pair: 0, contact: 0,
      bondRms: 0, angleRms: 0, planarRms: 0, contactRms: 0,
      worstBond: null, worstAngle: null, worstPlanar: null, worstContact: null,
      clashPenalty: 0, omegaPenalty: 0,
      omega: { count: 0, penalty: 0, violations: 0, worst: null },
      clashes: { count: 0, worst: null, severity: 0, minDistance: clashDistance },
      contacts: { count: 0, severity: 0, worst: null, checked: 0, unknownElements: 0 },
      restraint: restraintReportOf({ positions: null, restraints, tolerance }),
    };
  }
  const x = read.flat;
  const clean = restraintListOf({ restraints, atomCount: read.count }).list;
  /* LES TERMES SONT CEUX DU ⚒, recalculés ici sur CES coordonnées : la table des
     longueurs, l'hybridation, les cycles que le fichier lit comme plans, les
     distances demandées. Rien n'est réinventé — c'est le même constructeur que la
     descente emploie. */
  const terms = buildRelaxTerms({ elements, bonds, pairs: clean, weights, positions: x });
  const e = energyOf(terms, x);
  const clashes = clashReportOf({ positions: x, bonds, minDistance: clashDistance });
  const contacts = badContactsOf({
    positions: x, elements, bonds, tolerance: RELAX_CONTACT_TOLERANCE,
  }) || { count: 0, severity: 0, worst: null, checked: 0, unknownElements: 0 };
  const clashPenalty = RELAX_CLASH_WEIGHT * (Number(clashes.severity) || 0);
  /* LE TERME ω — la part « physique » ajoutée par le recuit : une liaison peptidique
     préférée TRANS. Elle entre dans le SCORE (elle juge un modèle fini), et elle est
     rendue à part pour que le score reste lisible. */
  const omegaList = omegas || peptideOmegasOf({ elements, bonds, atomCount: read.count });
  const om = omegaPenaltyOf({ positions: x, omegas: omegaList });
  return {
    ok: true,
    reason: 'ok',
    score: e.total + clashPenalty + om.penalty,
    total: e.total,
    bond: e.bond, angle: e.angle, planar: e.planar, pair: e.pair, contact: e.contact,
    bondRms: e.bondRms, angleRms: e.angleRms, planarRms: e.planarRms, contactRms: e.contactRms,
    worstBond: e.worstBond ? { ...e.worstBond } : null,
    worstAngle: e.worstAngle ? { ...e.worstAngle } : null,
    worstPlanar: e.worstPlanar ? { ...e.worstPlanar } : null,
    worstContact: e.worstContact ? { ...e.worstContact } : null,
    clashPenalty,
    omegaPenalty: om.penalty,
    omega: {
      count: om.count, violations: om.violations,
      worst: om.worst ? { ...om.worst } : null,
    },
    clashes: {
      count: clashes.count, severity: clashes.severity,
      minDistance: clashes.minDistance,
      worst: clashes.worst ? { ...clashes.worst } : null,
    },
    contacts: {
      count: contacts.count, severity: contacts.severity,
      checked: contacts.checked, unknownElements: contacts.unknownElements,
      worst: contacts.worst ? { ...contacts.worst } : null,
    },
    restraint: restraintReportOf({ positions: x, restraints: clean, tolerance }),
  };
};

/* ── 5 · UN DÉPART, DE BOUT EN BOUT — LE 🔥 RECUIT, PUIS LE ⚒ ──────────────────
   Le cœur de la demande : on tire les dièdres, on RECUIT (M1bis), on applique le
   protocole du ⚒, on recommence tant qu'il reste une distance non respectée (et qu'un
   balayage a gagné quelque chose), on TREMPE, et on note. La graine du départ k est la
   graine de base AVANCÉE de k pas dorés : le même k redonne le même modèle. */

/**
 * @param {object} spec les coordonnées, les éléments, les liaisons et les contraintes,
 *   plus les réglages du ⚒ (paliers, 🎲 bottes, cœur dur, poids) et ceux du calcul
 *   (`passes`, le budget de la préparation), `index` (le numéro du départ), `seed` (la
 *   graine de base), `draw: false` pour ne PAS tirer (le ⚒ sur la molécule telle
 *   quelle), `onPass` (un rapport par balayage), `onStep` (un rapport par GESTE : le
 *   tirage, chaque palier de recuit, la préparation, chaque distance conduite, le
 *   balayage, la trempe — c'est ce qui permet de VOIR le calcul), `anneal` (le nombre
 *   de paliers de recuit ; `null` = les paliers par défaut pour un départ TIRÉ, et
 *   AUCUN recuit pour un départ non tiré ; `0` = aucun), `quench` (la trempe finale).
 * @returns {{ok:boolean, reason:string, index:number, seed:number, score:number,
 *            total:number, bond:number, angle:number, planar:number, pair:number,
 *            contact:number, bondRms:number, angleRms:number, planarRms:number,
 *            clashPenalty:number, omegaPenalty:number, omega:object,
 *            clashes:object, contacts:object, restraint:object,
 *            positions:number[]|null, moved:number, restraints:object[],
 *            restraintCount:number, dropped:number, draw:object, channels:object[],
 *            anneal:object|null, quench:object|null, protocol:object}}
 *   `reason` = comment le départ s'est terminé (`converged` : plus une seule distance
 *   hors tolérance ; `stalled` : un balayage n'a plus rien gagné — le rapport dit ce
 *   qui reste ; `max-passes` : le budget de balayages est épuisé). `positions` est le
 *   modèle du départ, à plat ; `restraint` sa lecture ; `protocol` le journal des
 *   balayages (ce que chacun a conduit, ce que la préparation a trouvé, les pas et
 *   les évaluations payés).
 */
export const structureAttemptOf = ({
  positions = null, elements = [], bonds = [], restraints = [], index = 0,
  seed = STRUCTURE_CALC_SEED, tolerance = STRUCTURE_CALC_RESTRAINT_TOLERANCE,
  weights = RELAX_WEIGHTS, steps = STRUCTURE_CALC_STEPS,
  maxAtomStep = RELAX_MAX_ATOM_STEP, stageStep = RELAX_STAGE_STEP,
  escapes = STRUCTURE_CALC_ESCAPES, escapeSteps = RELAX_ESCAPE_STEPS,
  kickDeg = RELAX_KICK_DEG, clashDistance = RELAX_CLASH_DISTANCE,
  radius = RELAX_DEFAULT_RADIUS, passes = STRUCTURE_CALC_PASSES,
  buildPasses = STRUCTURE_CALC_BUILD_PASSES,
  buildDistances = STRUCTURE_CALC_BUILD_DISTANCES,
  buildContacts = STRUCTURE_CALC_BUILD_CONTACTS,
  draw = true, onPass = null, onStep = null,
  anneal = null, quench = true,
} = {}) => {
  const read = flatPositions(positions);
  const k = clampInt(index, 0, Number.MAX_SAFE_INTEGER, 0);
  const startSeed = wrapSeed(wrapSeed(seed) + wrapSeed(k * STRUCTURE_CALC_SEED_STEP));
  const els = Array.from(elements || []);
  if (!read) {
    return {
      ok: false, reason: 'bad-points', index: k, seed: startSeed, score: Infinity,
      total: Infinity, bond: 0, angle: 0, planar: 0, pair: 0, contact: 0,
      bondRms: 0, angleRms: 0, planarRms: 0, clashPenalty: 0,
      clashes: { count: 0, severity: 0, worst: null, minDistance: clashDistance },
      contacts: { count: 0, severity: 0, worst: null, checked: 0, unknownElements: 0 },
      restraint: restraintReportOf({ positions: null, restraints, tolerance }),
      positions: null, moved: 0, restraints: [], restraintCount: 0, dropped: 0,
      draw: { turned: 0, channels: 0, skipped: 0, counts: null, plan: [] },
      channels: [],
      anneal: null,
      omega: { count: 0, penalty: 0, violations: 0, worst: null },
      protocol: { prep: null, passes: [], passCount: 0, drove: 0, reached: 0, steps: 0, evaluations: 0 },
    };
  }
  const count = read.count;
  const clean = restraintListOf({ restraints, atomCount: count });
  const x0 = read.flat.slice();
  /* LE PAS MONTRE — un rapport par geste (le panneau écrit ces coordonnées à l'écran
     s'il le demande) : le tirage, chaque palier du recuit, la préparation, chaque
     distance conduite, le balayage. Aucune coordonnée n'est recalculée : c'est `x`. */
  const step = (phase, positions, extra = null) => {
    if (typeof onStep !== 'function') return;
    try { onStep({ phase, positions, index: k, ...(extra || {}) }); } catch { /* un rapport qui se plaint n'arrête pas le calcul */ }
  };
  /* 1 · LE TIRAGE DES DIÈDRES — le départ. `draw: false` garde la molécule reçue
     telle quelle (le ⚒ d'un seul coup, sans hasard : ce que la sonde compare). */
  const drawn = draw
    ? randomTorsionsOf({ positions: x0, elements: els, bonds, atomCount: count, seed: startSeed })
    : null;
  let x = drawn && drawn.ok ? Array.from(drawn.positions) : x0.slice();
  step('draw', x, { channels: drawn ? drawn.channelCount : 0 });
  /* 1bis · LE RECUIT — LA PHYSIQUE. Le tirage est un point AU HASARD dans un espace de
     très grande dimension, et le protocole qui suit est LOCAL : sans recuit, un départ
     empilé ou loin de vos distances y reste. Le recuit n'appartient donc qu'à un
     DÉPART TIRÉ : `draw: false` est le ⚒ tel quel sur la molécule reçue (aucun
     hasard), et il ne recuit pas — sauf si `anneal` le demande explicitement. La
     barrière ω est lue ici une fois pour tout le départ (elle sert aussi à la note). */
  const omegas = peptideOmegasOf({ elements: els, bonds, atomCount: count });
  const annealSteps = clampInt(
    anneal == null ? (draw ? STRUCTURE_CALC_ANNEAL_STEPS : 0) : anneal,
    0, 64, 0,
  );
  const annealRun = annealSteps > 0
    ? annealTorsionsOf({
      positions: x, elements: els, bonds, restraints: clean.list,
      channels: drawn ? drawn.channels : null, omegas, weights,
      seed: wrapSeed(startSeed + 7),
      steps: annealSteps,
      onStep: typeof onStep === 'function' ? (s) => step('anneal', s.positions, s) : null,
    })
    : null;
  if (annealRun && annealRun.ok) x = Array.from(annealRun.positions);
  /* 2 · LA PRÉPARATION — LE PROTOCOLE DU ⚒, SANS ATOME PIQUÉ : il cherche lui-même
     les longueurs fausses et les couples entrés dans leur cœur dur (un tirage peut
     empiler deux chaînes latérales). Même protocole, budget plus court (voir les
     constantes) — et le rapport dit quand le plafond a mordu. */
  const scanOf = (arr, pass) => buildModelGeometry({
    positions: arr, elements: els, bonds, movable: null,
    passes: buildPasses, maxDistances: buildDistances, maxContacts: buildContacts,
    radius, stageStep, escapes, escapeSteps, kickDeg, clashDistance, weights, steps,
    rebuild: false, seed: wrapSeed(startSeed + pass),
  });
  const prepRun = scanOf(x, 0);
  if (prepRun && prepRun.ok) x = Array.from(prepRun.positions);
  step('prep', x);
  const prep = {
    reason: prepRun ? prepRun.reason : 'no-prep',
    converged: !!(prepRun && prepRun.converged),
    found: prepRun ? prepRun.found : 0,
    foundContacts: prepRun ? prepRun.foundContacts : 0,
    truncated: !!(prepRun && prepRun.truncated),
    scans: prepRun ? prepRun.passCount : 0,
    moved: prepRun ? (prepRun.moved || []).length : 0,
    bondRms: prepRun && prepRun.after ? prepRun.after.bondRms : 0,
    angleRms: prepRun && prepRun.after ? prepRun.after.angleRms : 0,
  };
  let reason = prep.reason;
  let stepsTaken = prepRun && prepRun.ok ? prepRun.steps || 0 : 0;
  let evaluations = prepRun && prepRun.ok ? prepRun.evaluations || 0 : 0;
  let drove = 0;
  let reached = 0;
  const passesLog = [];
  const passMax = clampInt(passes, 0, 64, STRUCTURE_CALC_PASSES);

  for (let p = 1; p <= passMax; p += 1) {
    const before = restraintReportOf({ positions: x, restraints: clean.list, tolerance });
    const entry = {
      pass: p,
      before: { violations: before.violations, severity: before.severity, rmsd: before.rmsd },
      drove: 0, reached: 0, skipped: 0, scan: null, after: null, improved: 0,
      steps: 0, evaluations: 0,
    };
    if (!before.violations) { reason = 'converged'; passesLog.push(entry); break; }
    /* LA PLUS FAUSSE D'ABORD — le classement d'un balayage, indices pour départager :
       deux écarts égaux donnent toujours le même ordre, donc le même modèle. */
    const wanted = before.list.filter((r) => !r.satisfied)
      .slice().sort((a, b) => (b.abs - a.abs) || (a.i - b.i) || (a.j - b.j));
    for (const r of wanted) {
      /* LA DISTANCE EST RELUE AVANT D'ÊTRE CONDUITE — le geste précédent l'a peut-être
         déjà mise à sa cible, et la reconduire pour rien coûterait une descente. */
      if (Math.abs(dist3(x, r.i, r.j) - r.target) <= tolerance) { entry.skipped += 1; continue; }
      const run = relaxGeometry({
        positions: x, elements: els, bonds,
        pairs: [{ i: r.i, j: r.j, target: r.target }],
        movable: null, weights, steps, maxAtomStep, stageStep,
        escapes, escapeSteps, kickDeg, clashDistance, rebuild: false,
        seed: wrapSeed(startSeed + p * 101 + entry.drove),
      });
      entry.drove += 1;
      drove += 1;
      entry.steps += run.steps || 0;
      entry.evaluations += run.evaluations || 0;
      stepsTaken += run.steps || 0;
      evaluations += run.evaluations || 0;
      if (run.ok) {
        x = Array.from(run.positions);
        if (run.reached) { entry.reached += 1; reached += 1; }
        step('drive', x, { pass: p, pair: { i: r.i, j: r.j } });
      }
    }
    /* LE BALAYAGE DU ⚒ APRÈS LES GESTES — les mouvements viennent peut-être de créer
       des empilements, et la chimie se relit du même coup : c'est exactement le tour
       du construit automatique (« les longueurs d'abord, les contacts ensuite, et un
       balayage de plus si ses propres gestes ont laissé du travail »). */
    const scanRun = scanOf(x, p);
    if (scanRun && scanRun.ok) {
      x = Array.from(scanRun.positions);
      step('scan', x, { pass: p, found: scanRun.found });
      entry.scan = {
        reason: scanRun.reason, converged: scanRun.converged,
        found: scanRun.found, foundContacts: scanRun.foundContacts,
        truncated: scanRun.truncated, moved: (scanRun.moved || []).length,
      };
      stepsTaken += scanRun.steps || 0;
      evaluations += scanRun.evaluations || 0;
    }
    const after = restraintReportOf({ positions: x, restraints: clean.list, tolerance });
    entry.after = { violations: after.violations, severity: after.severity, rmsd: after.rmsd };
    entry.improved = Number((entry.before.severity - entry.after.severity).toFixed(6));
    passesLog.push(entry);
    if (typeof onPass === 'function') {
      try { onPass(entry, { index: k, seed: startSeed }); } catch { /* un rapport qui se plaint n'arrête pas le calcul */ }
    }
    if (!after.violations) { reason = 'converged'; break; }
    if (!(entry.improved > 1e-9)) { reason = 'stalled'; break; }
    if (p >= passMax) reason = 'max-passes';
  }

  /* 3bis · LA TREMPE — LE PROTOCOLE A PU CASSER ω. Sa descente n'a aucune cible d'ω (le
     ⚒ n'en a jamais eu) : en conduisant une distance, elle peut remettre une liaison
     peptidique en cis. Ce dernier recuit, FROID et SOUS LONGE, répare ce qu'elle a
     abîmé sans lâcher les distances qu'elle vient de respecter. `quench: false` l'enlève. */
  /* CE QUE LE PROTOCOLE A FAIT D'ω, JUSTE AVANT LA TREMPE — le chiffre de départ de la
     trempe, mesuré ICI (le rapport ne compare que ce qui est comparable : le même
     terme, sur la géométrie que la trempe reçoit vraiment). */
  const omegaBeforeQuench = annealSteps > 0 && quench
    ? omegaPenaltyOf({ positions: x, omegas })
    : null;
  const quenchRun = annealSteps > 0 && quench
    ? annealTorsionsOf({
      positions: x, elements: els, bonds, restraints: clean.list,
      channels: drawn ? drawn.channels : null, omegas, weights,
      seed: wrapSeed(startSeed + 13),
      steps: STRUCTURE_CALC_QUENCH_STEPS,
      hot: STRUCTURE_CALC_ANNEAL_COLD, cold: STRUCTURE_CALC_ANNEAL_COLD,
      leash: clean.list, protectOmega: true,
      onStep: typeof onStep === 'function' ? (s) => step('quench', s.positions, s) : null,
    })
    : null;
  if (quenchRun && quenchRun.ok) x = Array.from(quenchRun.positions);

  /* LA NOTE, ET LA RElecture DES DIÈDRES — le rapport dit ce que la structure A, pas
     ce que le tirage a demandé (`channelReadingsOf` relit chaque canal avec LE
     lecteur de dihèdre du dossier). */
  const scored = scoreStructureOf({
    positions: x, elements: els, bonds, restraints: clean.list, weights, clashDistance,
    tolerance, omegas,
  });
  let moved = 0;
  for (let i = 0; i < count; i += 1) {
    if (Math.abs(x[i * 3] - x0[i * 3]) + Math.abs(x[i * 3 + 1] - x0[i * 3 + 1])
      + Math.abs(x[i * 3 + 2] - x0[i * 3 + 2]) > 1e-9) moved += 1;
  }
  return {
    ...scored,
    ok: true,
    reason,
    index: k,
    seed: startSeed,
    positions: x,
    moved,
    restraints: clean.list,
    restraintCount: clean.count,
    dropped: clean.dropped,
    draw: {
      turned: drawn ? drawn.drawn : 0,
      channels: drawn ? drawn.channelCount : 0,
      skipped: drawn ? drawn.skipped.length : 0,
      counts: drawn ? drawn.counts : null,
      plan: drawn ? drawn.turned : [],
    },
    channels: channelReadingsOf({ positions: x, channels: drawn ? drawn.channels : [] }),
    /* LE RECUIT, RACONTÉ — le plan de température pas à pas, ce qu'il a essayé, ce
       qu'il a accepté, et son coût avant/après. Un recuit qui ne dit rien ne se juge
       pas. */
    anneal: annealRun && annealRun.ok ? {
      steps: annealRun.schedule.length,
      tried: annealRun.tried,
      accepted: annealRun.accepted,
      skipped: annealRun.skipped,
      channels: annealRun.channels,
      omegas: annealRun.omegas,
      before: annealRun.cost.before,
      after: annealRun.cost.after,
      schedule: annealRun.schedule,
    } : null,
    /* LA TREMPE, RACONTÉE ELLE AUSSI — ce qu'elle a essayé après le protocole, ce
       qu'elle a accepté, et le coût avant/après (le même coût, donc comparable). */
    quench: quenchRun && quenchRun.ok ? {
      steps: quenchRun.schedule.length,
      tried: quenchRun.tried,
      accepted: quenchRun.accepted,
      skipped: quenchRun.skipped,
      before: quenchRun.cost.before,
      after: quenchRun.cost.after,
      omegaBefore: omegaBeforeQuench ? omegaBeforeQuench.penalty : 0,
      omegaBeforeDeg: omegaBeforeQuench && omegaBeforeQuench.worst ? omegaBeforeQuench.worst.deg : null,
      omega: quenchRun.omega,
      schedule: quenchRun.schedule,
    } : null,
    omega: scored.omega,
    protocol: {
      prep, passes: passesLog, passCount: passesLog.length,
      drove, reached, steps: stepsTaken, evaluations,
    },
  };
};

/* ── 6 · LE CLASSEMENT, ET LA FAMILLE DES m RETENUES ─────────────────────────
   « the final result is scored. the best m structures are retained. » Le classement
   est le score croissant — jamais autre chose —, les indices départagent les
   ex æquo, et les m premières sont RETENUES avec leurs coordonnées. Le rapport de la
   famille est celui d'une famille : ce que chaque distance demandée mesure dans les m
   modèles (min, max, moyenne, combien la respectent), et leur dispersion (RMSD deux à
   deux après SUPERPOSITION OPTIMALE — `rigidTransform`, le solveur du dossier : deux
   modèles identiques à une rotation près ont une dispersion nulle, et c'est bien ce
   qu'on veut savoir d'une famille). */

/** Ce que chaque distance demandée mesure dans la famille retenue — une ligne par
 *  contrainte, dans l'ordre du panneau : `{i, j, order, target, models, satisfied,
 *  min, max, mean, spread}`. Rien n'est recalculé depuis les coordonnées : chaque
 *  tentative porte déjà SA lecture (`restraint.list`), donc la famille ne peut pas
 *  dire autre chose que ce que les modèles disent. */
export const familyRestraintsOf = ({ attempts = [] } = {}) => {
  const list = Array.from(attempts || [])
    .filter((a) => a && a.restraint && Array.isArray(a.restraint.list));
  if (!list.length) return [];
  const first = list[0].restraint.list;
  const out = [];
  for (let k = 0; k < first.length; k += 1) {
    const r = first[k];
    let min = Infinity; let max = -Infinity; let sum = 0; let ok = 0; let n = 0;
    for (const a of list) {
      const e = a.restraint.list[k];
      if (!e) continue;
      min = Math.min(min, e.distance);
      max = Math.max(max, e.distance);
      sum += e.distance;
      n += 1;
      if (e.satisfied) ok += 1;
    }
    out.push({
      i: r.i, j: r.j, order: r.order, target: r.target, models: n, satisfied: ok,
      min: n ? min : 0, max: n ? max : 0, mean: n ? sum / n : 0, spread: n ? max - min : 0,
    });
  }
  return out;
};

/** LA DISPERSION DE LA FAMILLE — le RMSD de chaque COUPLE de modèles retenus après
 *  superposition optimale (`rigidTransform` de utils/structureFit.js, donc le solveur
 *  du dossier et jamais un second), plus la moyenne, la plus petite, la plus grande et
 *  le couple qui diverge le plus. `models < 2` : rien à comparer, et le rapport rend
 *  zéro plutôt qu'un chiffre inventé. */
export const familySpreadOf = ({ attempts = [] } = {}) => {
  const list = Array.from(attempts || []).filter((a) => a && a.positions);
  const out = {
    models: list.length, atoms: 0, pairs: [], count: 0,
    mean: 0, min: 0, max: 0, worst: null,
  };
  if (list.length < 2) {
    out.atoms = list.length ? Math.round(list[0].positions.length / 3) : 0;
    return out;
  }
  const count = Math.min(...list.map((a) => Math.round(a.positions.length / 3)));
  out.atoms = count;
  if (!count) return out;
  const idx = Array.from({ length: count }, (_, i) => i);
  const flats = list.map((a) => Array.from(a.positions).slice(0, count * 3));
  const rank = (a) => a.rank || 0;
  const pairs = [];
  for (let a = 0; a < list.length; a += 1) {
    for (let b = a + 1; b < list.length; b += 1) {
      const rt = rigidTransform(flats[a], flats[b], idx);
      pairs.push({
        a: rank(list[a]) || a + 1, b: rank(list[b]) || b + 1,
        rmsd: rt && Number.isFinite(rt.rmsd) ? rt.rmsd : Infinity,
      });
    }
  }
  let sum = 0;
  for (const p of pairs) sum += p.rmsd;
  out.pairs = pairs;
  out.count = pairs.length;
  out.mean = sum / pairs.length;
  out.min = Math.min(...pairs.map((p) => p.rmsd));
  out.max = Math.max(...pairs.map((p) => p.rmsd));
  out.worst = pairs.reduce((w, p) => (!w || p.rmsd > w.rmsd ? p : w), null);
  return out;
};

/**
 * LES m MEILLEURES, GARDÉES — `{ranking, retained, family, best, tried, scored,
 * refused, keep}`.
 * `ranking` = TOUTES les tentatives classées (`{rank, index, score, violations,
 * satisfied, rmsd, worst, clashes, contacts, bondRms, angleRms, moved, reason, draw,
 * protocol}` : le tableau du panneau), `retained` = les `keep` premières AVEC leurs
 * coordonnées (`positions`) — c'est ce que le panneau écrit dans la structure —,
 * `family` = le rapport de famille (`spread` + `restraints` + ce qui est resté
 * dehors). Une tentative refusée (`ok: false`) n'est jamais classée : elle est
 * COMPTÉE (`refused`).
 */
export const rankStructureAttempts = ({
  attempts = [], keep = STRUCTURE_CALC_DEFAULT_KEEP,
} = {}) => {
  const all = Array.from(attempts || []);
  const valid = all.filter((a) => a && a.ok !== false && Number.isFinite(a.score));
  const refused = all.length - valid.length;
  const sorted = valid.slice().sort((a, b) => (a.score - b.score) || (a.index - b.index));
  const hold = clampInt(keep, 0, STRUCTURE_CALC_MAX_KEEP, STRUCTURE_CALC_DEFAULT_KEEP);
  const line = (a, rank) => ({
    rank,
    index: a.index,
    score: a.score,
    total: a.total,
    clashPenalty: a.clashPenalty,
    bondRms: a.bondRms,
    angleRms: a.angleRms,
    moved: a.moved,
    reason: a.reason,
    clashes: a.clashes ? a.clashes.count : 0,
    contacts: a.contacts ? a.contacts.count : 0,
    violations: a.restraint ? a.restraint.violations : 0,
    satisfied: a.restraint ? a.restraint.satisfied : 0,
    rmsd: a.restraint ? a.restraint.rmsd : 0,
    severity: a.restraint ? a.restraint.severity : 0,
    worst: a.restraint && a.restraint.worst ? { ...a.restraint.worst } : null,
    draw: a.draw
      ? { turned: a.draw.turned, channels: a.draw.channels, skipped: a.draw.skipped }
      : null,
    protocol: a.protocol
      ? {
        prep: a.protocol.prep ? a.protocol.prep.reason : '',
        scans: a.protocol.prep ? a.protocol.prep.scans : 0,
        passes: a.protocol.passCount, drove: a.protocol.drove,
        reached: a.protocol.reached, steps: a.protocol.steps,
      }
      : null,
  });
  const ranking = sorted.map((a, i) => line(a, i + 1));
  const retained = sorted.slice(0, hold).map((a, i) => ({ ...a, rank: i + 1 }));
  return {
    ok: true,
    reason: 'ok',
    keep: hold,
    tried: all.length,
    scored: valid.length,
    refused,
    ranking,
    retained,
    family: {
      count: retained.length,
      spread: familySpreadOf({ attempts: retained }),
      restraints: familyRestraintsOf({ attempts: retained }),
      rest: ranking.slice(hold).map((r) => ({
        rank: r.rank, index: r.index, score: r.score, violations: r.violations,
      })),
    },
    best: ranking.length ? { ...ranking[0] } : null,
  };
};

/* ── 7 · LE CALCUL ENTIER — n DÉPARTS, PUIS LE CLASSEMENT ─────────────────────
   Les quatre gestes de la demande, dans l'ordre, en une seule fonction : n
   `structureAttemptOf` (numérotés 0…n−1, chacun avec SA graine), puis
   `rankStructureAttempts` sur les n tentatives. `indices` permet de ne calculer qu'une
   TRANCHE (le panneau en calcule une par image, pour que la page reste vivante),
   `onAttempt` reçoit chaque tentative dès qu'elle est finie, `shouldStop` est consulté
   AVANT chaque départ (le bouton ⏹ du panneau), et `anneal` / `onStep` descendent tels
   quels dans chaque `structureAttemptOf` (le recuit, et l'aperçu à l'écran). */

const refusedCalculation = (reason, extra = {}) => ({
  ok: false,
  reason,
  starts: 0,
  keep: 0,
  tried: 0,
  scored: 0,
  refused: 0,
  indices: [],
  attempts: [],
  ranking: [],
  retained: [],
  family: { count: 0, spread: familySpreadOf({ attempts: [] }), restraints: [], rest: [] },
  best: null,
  restraints: [],
  dropped: 0,
  stopped: false,
  ...extra,
});

export const structureCalculationOf = ({
  positions = null, elements = [], bonds = [], restraints = [],
  starts = STRUCTURE_CALC_DEFAULT_STARTS, keep = STRUCTURE_CALC_DEFAULT_KEEP,
  seed = STRUCTURE_CALC_SEED, tolerance = STRUCTURE_CALC_RESTRAINT_TOLERANCE,
  indices = null, onAttempt = null, shouldStop = null, ...rest
} = {}) => {
  const read = flatPositions(positions);
  if (!read) return refusedCalculation('bad-points');
  const n = clampInt(starts, 0, STRUCTURE_CALC_MAX_STARTS, STRUCTURE_CALC_DEFAULT_STARTS);
  const clean = restraintListOf({ restraints, atomCount: read.count });
  if (!clean.count) {
    return refusedCalculation('no-restraint', { starts: n, dropped: clean.dropped });
  }
  /* LA TRANCHE — `null` = les n départs, une liste = ceux-là seulement (indices hors
     bornes et doublons écartés : un départ ne se calcule pas deux fois). */
  const order = indices == null
    ? Array.from({ length: n }, (_, i) => i)
    : [...new Set(Array.from(indices)
      .map((i) => clampInt(i, 0, STRUCTURE_CALC_MAX_STARTS * 8, -1))
      .filter((i) => i >= 0))].sort((a, b) => a - b);
  if (!order.length) return refusedCalculation('no-start', { starts: n, dropped: clean.dropped });
  const attempts = [];
  let stopped = false;
  for (const index of order) {
    if (typeof shouldStop === 'function' && shouldStop()) { stopped = true; break; }
    const attempt = structureAttemptOf({
      ...rest,
      positions: read.flat, elements, bonds,
      restraints: clean.list, index, seed, tolerance,
    });
    attempts.push(attempt);
    if (typeof onAttempt === 'function') {
      try {
        onAttempt(attempt, { index, of: order.length, start: clean.count });
      } catch { /* un rapport qui se plaint n'arrête pas le calcul */ }
    }
  }
  const ranked = rankStructureAttempts({ attempts, keep });
  return {
    ...ranked,
    ok: true,
    reason: stopped ? 'stopped' : 'ok',
    starts: n,
    indices: order,
    attempts,
    restraintCount: clean.count,
    restraints: clean.list,
    dropped: clean.dropped,
    tolerance,
    stopped,
  };
};
