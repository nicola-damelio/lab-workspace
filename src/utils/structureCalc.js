/* ============================================================================
   src/utils/structureCalc.js
   🧬 CALCUL DE STRUCTURE — n DÉPARTS TIRÉS AU HASARD, LE ⚒ SUR CHACUN, m RETENUES.

   La demande, mot pour mot :

     « Implement a structure calculation button in which the user provide the
       distances between atom pairs and selects the number of starting structures n
       and the number of retained structures m. The program must then generate n
       structures by randomly assigning values of all dihedral angles. From each of
       these n structure the protocol of “model build” is applied to respect the
       distance constraints and the final result is scored. the best m structures
       are retained. »

   Ce module fait EXACTEMENT ces quatre choses, dans cet ordre, et rien d'autre :

     1. LES DIÈDRES DU DÉPART SONT TIRÉS — `rotatableBondsOf` lit, dans le graphe de
        liaisons reçu, les seules liaisons qui SONT un dièdre : SIMPLE (un ordre 2 ou
        3 ne tourne pas), hors d'un cycle (ses deux côtés ne communiquent pas
        autrement — le côté vient de `bondSideOf`, la charnière du module du ⚒), et
        dont les DEUX côtés portent au moins un atome (un atome terminal ne fait pas
        un dièdre). `randomTorsionsOf` tire alors, pour chacune, un angle uniforme
        dans (−180, 180) et le POSE (`planTorsion` de utils/torsionDrive.js : rotation
        rigide d'un côté autour de l'axe, en quaternion) : les longueurs ET les angles
        internes sont préservés au chiffre près, seuls les dièdres changent — c'est ce
        qu'un dièdre est. Le tirage vient de `makeRelaxRandom` (mulberry32, la graine
        du ⚒) : il n'y a pas un second générateur dans le dossier, et le même n donne
        toujours les mêmes n départs.
     2. LE PROTOCOLE « MODEL BUILD » EST APPLIQUÉ À CHACUN — pas une seconde
        descente, pas une seconde table : le ⚒ tel quel. `buildModelGeometry` (§8bis
        de utils/geometryRelax.js) règle d'abord la CHIMIE et LES EMPILEMENTS (les
        longueurs fausses, puis les couples entrés dans leur cœur dur), et chaque
        distance demandée que le départ ne respecte pas est ensuite CONDUITE par
        `relaxGeometry` (la même fonction que le bouton ⚒ appelle : la paire
        rapprochée PAR PALIERS, la fenêtre entière relâchée après chacun, les 🎲
        bottes de torsion pour sortir d'un creux). La fenêtre est la MOLÉCULE
        ENTIÈRE — ici il n'y a pas deux atomes piqués mais n départs, donc rien ne
        dit quel bout devrait rester en place (et le ⟳ rebâtiment serait sans effet :
        sans ancre, tout est reposé, donc rien ne change).
     3. CHAQUE RÉSULTAT EST NOTÉ — `scoreStructureOf` : la MÊME fonction cible que le
        ⚒ (longueurs idéales, angles de l'hybridation, cycles que le fichier déclare
        plans, les distances demandées à leur poids, le CŒUR DUR), SANS la longe
        (une longe juge la distance au départ de la descente, pas la qualité du
        modèle : n départs sont là pour explorer), PLUS la pénalité d'empilement que
        le module emploie déjà pour préférer un modèle propre à un modèle empilé
        (`RELAX_CLASH_WEIGHT` × gravité, le chiffre de ses 🎲 échappées).
     4. LES m MEILLEURES SONT GARDÉES — `rankStructureAttempts` classe par score
        croissant (les indices départagent : deux scores égaux donnent toujours le
        même ordre), et `structureCalculationOf` rend les m premières, dans l'ordre
        du classement, avec pour chacune les CHIFFRES qui l'ont classée. Le rapport
        de la famille est là aussi : la dispersion des m modèles (RMSD deux à deux
        après superposition optimale) et ce que chaque distance demandée mesure dans
        la famille.

   CE QU'IL N'EST PAS, et le panneau le dit aussi : ni dynamique moléculaire, ni
   recuit simulé, ni champ de forces. Aucun atome ni hydrogène n'est ajouté ; aucune
   charge, aucun solvant, aucune entropie ; et le hasard n'intervient QUE dans les
   dièdres du départ — chaque descente qui suit est locale et déterministe, la même
   que celle du ⚒. Le score n'est pas une énergie en kcal/mol et n'est comparable
   qu'à l'intérieur d'un même calcul (même molécule, mêmes contraintes).

   ⚠ UNE LIAISON PEPTIDIQUE (un C–N simple du graphe) EST UN DIÈDRE POUR CE LECTEUR :
   un tirage peut donc la mettre en cis. Le ⚒ n'a aucune cible d'ω — il l'a toujours
   dit (« ce n'est pas un champ de forces »), et c'est le graphe de Ramachandran (🪢)
   qui montre ce qu'un résultat a fait de ses ω. Le panneau le répète : le module ne
   cache rien, il nomme ce qu'il ne fait pas.

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
  badContactsOf, clashReportOf, makeRelaxRandom,
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

/* ── 4 · LA NOTE D'UN RÉSULTAT — « the final result is scored » ───────────────
   Le score est la MÊME fonction cible que celle que le ⚒ minimise —
   `buildRelaxTerms` + `energyOf` de utils/geometryRelax.js, la molécule entière,
   les distances demandées comprises à leur poids (`RELAX_WEIGHTS.pair`) et le cœur
   dur compris lui aussi —, SANS la longe : une longe juge la distance au départ de
   la descente, et n départs sont là pour explorer, pas pour rester près de leur
   tirage. S'y ajoute la seule chose que le module ajoute déjà ailleurs : la
   pénalité d'empilement de ses 🎲 échappées (`RELAX_CLASH_WEIGHT` × gravité), qui
   préfère un modèle propre à un modèle empilé. Le rapport donne les deux chiffres
   séparément (`total` et `clashPenalty`) EN PLUS des familles de l'énergie : un
   score n'est pas une boîte noire, il se lit. */

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
  tolerance = STRUCTURE_CALC_RESTRAINT_TOLERANCE,
} = {}) => {
  const read = flatPositions(positions);
  if (!read) {
    return {
      ok: false, reason: 'bad-points', score: Infinity, total: Infinity,
      bond: 0, angle: 0, planar: 0, pair: 0, contact: 0,
      bondRms: 0, angleRms: 0, planarRms: 0, contactRms: 0,
      worstBond: null, worstAngle: null, worstPlanar: null, worstContact: null,
      clashPenalty: 0,
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
  return {
    ok: true,
    reason: 'ok',
    score: e.total + clashPenalty,
    total: e.total,
    bond: e.bond, angle: e.angle, planar: e.planar, pair: e.pair, contact: e.contact,
    bondRms: e.bondRms, angleRms: e.angleRms, planarRms: e.planarRms, contactRms: e.contactRms,
    worstBond: e.worstBond ? { ...e.worstBond } : null,
    worstAngle: e.worstAngle ? { ...e.worstAngle } : null,
    worstPlanar: e.worstPlanar ? { ...e.worstPlanar } : null,
    worstContact: e.worstContact ? { ...e.worstContact } : null,
    clashPenalty,
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

/* ── 5 · UN DÉPART, DE BOUT EN BOUT — LE ⚒ SUR UNE CONFORMATION TIRÉE ────────
   C'est le cœur de la demande, et il n'y a rien d'autre dedans que ce qui est
   demandé : on tire les dièdres, on applique le protocole du ⚒, on recommence tant
   qu'il reste une distance non respectée (et qu'un balayage a gagné quelque chose),
   et on note. La graine du départ k est la graine de base AVANCÉE de k pas dorés. */

/**
 * @param {object} spec les coordonnées, les éléments, les liaisons et les contraintes,
 *   plus les réglages du ⚒ (paliers, 🎲 bottes, cœur dur, poids) et ceux du calcul
 *   (`passes`, le budget de la préparation, `escaliers`), `index` (le numéro du
 *   départ), `seed` (la graine de base), `draw: false` pour ne PAS tirer (le ⚒ sur la
 *   molécule telle quelle), `onPass` (un rapport par balayage).
 * @returns {{ok:boolean, reason:string, index:number, seed:number, score:number,
 *            total:number, bond:number, angle:number, planar:number, pair:number,
 *            contact:number, bondRms:number, angleRms:number, planarRms:number,
 *            clashPenalty:number, clashes:object, contacts:object, restraint:object,
 *            positions:number[]|null, moved:number, restraints:object[],
 *            restraintCount:number, dropped:number, draw:object, channels:object[],
 *            protocol:object}}
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
  draw = true, onPass = null,
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
      protocol: { prep: null, passes: [], passCount: 0, drove: 0, reached: 0, steps: 0, evaluations: 0 },
    };
  }
  const count = read.count;
  const clean = restraintListOf({ restraints, atomCount: count });
  const x0 = read.flat.slice();
  /* 1 · LE TIRAGE DES DIÈDRES — le départ. `draw: false` garde la molécule reçue
     telle quelle (le ⚒ d'un seul coup, sans hasard : ce que la sonde compare). */
  const drawn = draw
    ? randomTorsionsOf({ positions: x0, elements: els, bonds, atomCount: count, seed: startSeed })
    : null;
  let x = drawn && drawn.ok ? Array.from(drawn.positions) : x0.slice();
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
      }
    }
    /* LE BALAYAGE DU ⚒ APRÈS LES GESTES — les mouvements viennent peut-être de créer
       des empilements, et la chimie se relit du même coup : c'est exactement le tour
       du construit automatique (« les longueurs d'abord, les contacts ensuite, et un
       balayage de plus si ses propres gestes ont laissé du travail »). */
    const scanRun = scanOf(x, p);
    if (scanRun && scanRun.ok) {
      x = Array.from(scanRun.positions);
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

  /* LA NOTE, ET LA RElecture DES DIÈDRES — le rapport dit ce que la structure A, pas
     ce que le tirage a demandé (`channelReadingsOf` relit chaque canal avec LE
     lecteur de dihèdre du dossier). */
  const scored = scoreStructureOf({
    positions: x, elements: els, bonds, restraints: clean.list, weights, clashDistance, tolerance,
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
   `onAttempt` reçoit chaque tentative dès qu'elle est finie, et `shouldStop` est
   consulté AVANT chaque départ (le bouton ⏹ du panneau). */

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
