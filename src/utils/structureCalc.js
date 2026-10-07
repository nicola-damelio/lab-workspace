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
     2. LE CHAMP DE FORCES, ET LE PROTOCOLE STANDARD SUR CHAQUE DÉPART — le champ est
        UNE fonction (`forceFieldEnergyOf`) dont les familles se lisent une par une :
        liaisons, angles, plans, distances demandées (le ⚒), cœur dur, plus les trois
        potentiels de torsion sans lesquels un calcul de structure rend les
        Ramachandran que l'utilisateur a signalés — ω trans (`omegaPenaltyOf`), les
        bassins φ/ψ (`backboneTorsionsOf` + `ramaPenaltyOf`, les MÊMES bassins que le
        graphe 🪢 dessine) et les trois conformères décalés de χ1 (`chiPenaltyOf`).
        Sur chaque départ : tirage → recuit Metropolis (`annealTorsionsOf`) → le
        protocole du ⚒ (distances conduites une par une) → **dynamique moléculaire de
        Langevin en espace dihédral** (`molecularDynamicsOf`, chaud puis refroidi) →
        **minimisation** (`minimizeTorsionsOf`) → TREMPE froide sous longe.
        🪢 L'option « ω VARIE » (`freeOmega`) ne change QUE la liaison peptidique : FAUSSE par
        défaut, elle est PROTÉGÉE — aucun pas des quatre gestes ne peut augmenter son coût, donc
        les peptides restent TRANS ; VRAIE, ω devient un dièdre ordinaire du champ et c'est sa
        barrière (k = 20 kcal/mol, nulle dans ± 30° de 180°) qui arbitre (voir
        `STRUCTURE_CALC_FREE_OMEGA`).
     3. CHAQUE RÉSULTAT EST NOTÉ — `scoreStructureOf` : la fonction cible du ⚒, plus
        l'empilement, ω, les bassins φ/ψ et χ1. Rien n'est réinventé : c'est le champ
        de forces de l'étape 2, relu sur les coordonnées DU modèle.
     4. LES m MEILLEURES SONT GARDÉES — `rankStructureAttempts`, avec le rapport de la
        famille : ce que chaque distance y mesure, et la dispersion des m modèles après
        superposition optimale.

   TOUT SE REGARDE (`annealFrames`, `structureAttemptFrames`, `structureCalculationFrames`,
   `mdFrames`, `minimizeFrames`) : le protocole est écrit comme un GÉNÉRATEUR qui rend la
   main à chaque image. Un seul moteur, deux conducteurs — `drainFrames` (synchrone : les
   appelants et les tests) et l'écran, qui écrit chaque image et laisse peindre la page
   avant de reprendre. C'est ce qui permet de VOIR le tirage puis le recuit.

   CE QU'IL EST, ET CE QU'IL N'EST TOUJOURS PAS : l'énergie EST en kcal/mol (le champ de
   `utils/forceFieldKcal.js`, douze familles), elle porte les CHARGES PARTIELLES, elle
   porte l'ENTROPIE conformationnelle, et les hydrogènes manquants sont AJOUTÉS — le
   recuit, la dynamique, la minimisation et le score lisent tous SES fonctions. Le
   SOLVANT y est IMPLICITE seulement : les charges sont écrantées par un diélectrique
   dépendant de la distance (ε(r) = 4·r) et la surface exposée ajoute la solvatation NON
   polaire (γ·A, sonde d'eau de 1.4 Å). Il n'y a donc NI molécule d'eau, NI contre-ion,
   NI polarisabilité, NI force ionique (`forceFieldKcal.js` le dit aussi). La dynamique,
   elle, reste DIHÉDRALE : un pas = une rotation rigide autour d'une charnière, donc
   longueurs et angles sont des CONSTANTES du mouvement (elles ne peuvent pas se casser).

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
import { dihedralDeg, planTorsion, wrapDeg } from './torsionDrive.js';
/* LE CHAMP DE FORCES RÉEL — en kcal/mol, avec les charges, le solvant, l'entropie et
   les atomes ajoutés (`utils/forceFieldKcal.js`). Le recuit, la dynamique, la
   minimisation et le score lisent SES fonctions : aucun moteur n'a sa propre physique,
   et un écart n'a qu'un prix dans ce dossier. */
import {
  FORCE_FIELD_KCAL_FAMILIES, ffKcalRowsOf, ffKcalEnergyOf, ffTorsionFamilyOf,
  ffRestraintCostOf, ffRestraintWeightOf, ffRestraintKOf,
  ffBondCostOf, ffAngleCostOf, ffPlanarCostOf,
  ffOmegaCostOf, ffChiCostOf, ffRamaCostOf, ffDihedralCostOf,
  ffVdwCostOf, ffCoulombCostOf, ffSurfaceOf, ffNonbondedEnergyOf, ffPairListOf,
  /* ⚠ LES COUPLES QU'UN PAS CRÉE (voir `stepPairsOf`) SE LISENT AVEC LES FONCTIONS DU
     CHAMP : la topologie (`ffExclusionSetsOf`), la portée (`ffPairReachOf`) et le couple
     lui-même (`ffPairOf`) sont les siennes — le moteur ne peut pas juger autre chose. */
  ffPairOf, ffExclusionSetsOf, ffPairReachOf,
  hydrogenatedOf, partialChargesOf, ffEntropyOf, ffAngleDegOf, ffElementOf,
  /* 🎯 LA FONCTION CIBLE (classic / DYANA) ET LE COÛT D'UN COUPLE QU'ELLE CHOISIT — une
     seule définition (`FF_TARGET_FUNCTIONS`), lue par le champ ET par les moteurs de
     torsion. Et 💧 l'eau explicite : ses pseudo-éléments, sa géométrie, ses charges. */
  ffTargetFunctionOf, ffNonbondedCostOf, FF_TARGET_FUNCTIONS,
  /* 💧 ET LE GRADIENT D'UN COUPLE — la dérivée de ce même coût, pour les corps rigides
     d'eau (voir `waterRigidBodyOf`) : un couple n'a donc qu'UNE définition de son prix et
     qu'UNE définition de sa pente, côte à côte dans le module du champ. */
  ffNonbondedGradientOf, FF_KCAL_PER_AMU_A2_PS2,
  FF_TIP3P, ffWatersIn,
  FF_BOND_K, FF_ANGLE_K, FF_PLANAR_K, FF_NOE_K, FF_RESTRAINT_TOLERANCE,
  FF_OMEGA_K, FF_OMEGA_TARGET, FF_OMEGA_TOLERANCE, FF_CHI_K, FF_CHI_TOLERANCE,
  FF_DIHEDRAL_K, FF_DIHEDRAL_TOLERANCE, FF_DIHEDRAL_CENTRE_K,
  FF_RAMA_K, FF_RAMA_SPAN, FF_SASA_GAMMA, FF_SASA_PROBE, FF_SURFACE_CAP_OVERLAP,
  FF_PAIR_LIMIT, FF_DIELECTRIC,
  /* 🧪 LE pH ET LA FORCE IONIQUE — deux réglages de la CHIMIE du champ, descendus jusqu'ici
     pour que les quatre gestes (▶ Run, ▶ MD, ⚒ Minimise, ⟳ Energy) lisent LES MÊMES : κ de
     Debye–Hückel, la longueur de Debye, et la lecture de la charge à ce pH-là (voir §2bis et
     §4bis de utils/forceFieldKcal.js). */
  ffDebyeKappaOf, ffDebyeLengthOf, ffIonisationReportOf,
  FF_PKA, FF_PKA_ACIDS, FF_PH_DEFAULT, FF_IONIC_STRENGTH_DEFAULT, FF_DEBYE_FACTOR,
  FF_GAS_CONSTANT, FF_REFERENCE_TEMPERATURE, FF_KCAL_UNITS,
} from './forceFieldKcal.js';
/* LES BASSINS φ/ψ DU GRAPHE 🪢 — les polygones et le test d'appartenance sont ceux du
   module du graphe : le potentiel du calcul et ce que le GRAPHE peint sont donc
   littéralement les mêmes bassins (un point que le calcul vise est un point que le
   graphe ne peint pas en violet). Aucun polygone n'est recopié ici. */
import { RAMA_REGIONS, pointInPolygon, ramaRegionOf, ramaGapOf } from './ramachandran.js';
/* …et elle est RÉEXPORTÉE : rien de ce qui la lisait (le panneau 🪢, les tests) n'a à
   savoir qu'elle a déménagé d'un module à l'autre. */
export { ramaGapOf };
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
/** À partir de quel écart une distance demandée n'est plus respectée. 0.25 Å : c'est la
 *  LARGEUR DU PUITS PLAT du potentiel de contrainte (le même chiffre que
 *  `FF_RESTRAINT_TOLERANCE` du champ, D'UN SEUL endroit : le panneau affiche une
 *  colonne verte/rouge et le champ ne mord qu'en dehors — ils ne peuvent pas dire deux
 *  choses différentes). */
export const STRUCTURE_CALC_RESTRAINT_TOLERANCE = FF_RESTRAINT_TOLERANCE;
/** Combien de contraintes le module accepte (au-delà, ce n'est plus une liste qu'on
 *  relit à l'écran). */
export const STRUCTURE_CALC_MAX_RESTRAINTS = 40;
/* ⚠ LE PROTOCOLE « MODEL BUILD » N'EST PLUS CELUI DU CALCUL DE STRUCTURE. La demande :
   « The final structures are bad and I think this is due to my protocol. just forget my
   protocol and implement a standard protocol. » Les constantes qui le décrivaient
   (`STRUCTURE_CALC_PASSES`, `BUILD_PASSES`, `BUILD_DISTANCES`, `BUILD_CONTACTS`,
   `ESCAPES`, `STEPS`) ont donc DISPARU : conduire les distances une par une, avec une
   descente du ⚒ par distance, n'est plus ce que fait un départ. Le ⚒ (`geometryRelax.js`)
   reste le bouton ⚒ du panneau, il n'est plus le moteur d'un calcul de structure. */

/* 1bis · LE RECUIT EN ESPACE DIHÉDRAL — les six chiffres du plan de température.
   Un tirage uniforme est un point AU HASARD dans un espace de très grande
   dimension : presque toujours empilé ou loin des distances, et le protocole qui suit
   est LOCAL — il ne sort pas d'un creux. Le recuit accepte un pas qui empire
   (Metropolis, exp(−ΔE/(R·T))) avec T décroissant : c'est ce qui atteint une
   conformation qui SATISFAIT les distances sans la connaître d'avance (CYANA et
   XPLOR font cela en espace dihédral).
   ⚠ LA TEMPÉRATURE EST EN KELVINS, ET ELLE EST RÉELLE : l'énergie est en kcal/mol,
   donc l'énergie thermique est R·T avec R = 1.9872e-3 kcal·mol⁻¹·K⁻¹. À 300 K elle
   vaut 0.60 kcal/mol — une barrière de Ramachandran (5 kcal/mol) ne se franchit PAS à
   température ambiante, et c'est exactement pourquoi le recuit commence à 1500 K : à
   cette température l'énergie thermique vaut 3 kcal/mol, et les conformations
   s'échangent. C'est la pratique de tous les calculs de structure sous contraintes. */
export const STRUCTURE_CALC_ANNEAL_STEPS = 6;         // paliers de température
export const STRUCTURE_CALC_ANNEAL_HOT = 1500;        // K — le premier palier…
export const STRUCTURE_CALC_ANNEAL_COLD = 300;        // K — …et le dernier
export const STRUCTURE_CALC_ANNEAL_MOVES = 12;        // pas ESSAYÉS par canal et par palier
export const STRUCTURE_CALC_ANNEAL_AMPLITUDE = 180;   // ° du pas — un dièdre ordinaire
export const STRUCTURE_CALC_ANNEAL_OMEGA_AMPLITUDE = 12; // ° — une liaison peptidique
/* LE TERME ω — une liaison peptidique préfère TRANS (ω = 180°). Le plateau (± 30°)
   est le désordre réel d'une chaîne : le terme ne mord qu'au-delà, et c'est ce qui
   remplace « le ⚒ n'a aucune cible d'ω ». Les chiffres VIVENT DANS LE CHAMP
   (`utils/forceFieldKcal.js`) : ici ils sont seulement réexportés, donc le panneau, le
   recuit et le score ne peuvent pas citer deux barrières différentes. */
export const STRUCTURE_CALC_OMEGA = FF_OMEGA_TARGET;
export const STRUCTURE_CALC_OMEGA_TOLERANCE = FF_OMEGA_TOLERANCE;
export const STRUCTURE_CALC_OMEGA_WEIGHT = FF_OMEGA_K;
/* 🪢 L'OPTION « ω VARIE » (`freeOmega`), FAUSSE par défaut — la demande : « in the structure
   calculation allow the option to vary also the omega backbone angle. » Par défaut, une liaison
   peptidique est un dièdre PROTÉGÉ, et trois moteurs le protègent chacun : le recuit et la
   trempe REFUSENT un pas qui augmente son coût (`protectOmega`), la dynamique refuse le même pas
   sur ce canal-là, la minimisation aussi. C'est la bonne règle quand ω n'est qu'une CONSÉQUENCE
   (on veut des peptides TRANS), et c'est ce qui a été mesuré : sans elle, la MÊME dynamique
   chaude (3000 K) partie du plateau le quitte — ω finit à 119° après 300 pas (61° hors du
   plateau) et à 85° après 3000 (95°), au lieu de rester dans la fenêtre.
   L'option fait de ω un dièdre ORDINAIRE du protocole : plus aucune de ces trois règles ne le
   refuse, la barrière du champ reste comptée comme toutes les autres familles
   (`ffOmegaCostOf`, k = 20 kcal/mol, NULLE dans le plateau de ± 30° autour de 180°), et c'est
   donc le CHAMP qui décide — un ω ne s'écarte de trans que si quelque chose d'autre (une
   distance demandée, un φ/ψ imposé, un empilement) paie plus que sa barrière. Le PAS reste celui
   de la famille (12° au recuit, 4° en dynamique) : ω continue de se tourner par PETITS pas, il
   ne saute pas d'un conformère à l'autre, et il ne peut pas franchement s'isomériser sans que
   le champ le paie.
   ⚠ ET LE VERROU EST AUSSI DANS LE TIRAGE (`randomTorsionsOf`) : FAUSSE, la case interdit le
   seul geste que la protection ne pouvait pas rattraper. Le tirage donnait un angle uniforme à
   TOUTES les charnières, liaison peptidique comprise, et un ω tombé près de 0° n'était attrapé
   par RIEN ensuite : le terme ω du champ (`ffOmegaCostOf`) est MONOTONE (nul dans le plateau,
   k = 20 kcal/mol au cis, un seul minimum) — il TIRE donc bien vers trans, mais c'est une
   PRÉFÉRENCE jugée avec le reste du champ. Mesuré : avec une distance demandée qui ne se tient
   qu'en pliant ω, un départ à 0.4° de cis n'en revient qu'à 92° d'écart (et 77° après 3000 pas
   de dynamique) — hors du plateau, à payer sa barrière. Le tirage ne tire donc plus un peptide :
   il le POSE trans, et il le corrige même s'il arrive cis (voir `randomTorsionsOf`). Cochée, il
   le tire au hasard comme les autres. */
export const STRUCTURE_CALC_FREE_OMEGA = false;
/** Le poids du potentiel statistique φ/ψ (kcal/mol à 100° hors du bassin). */
export const STRUCTURE_CALC_RAMA_WEIGHT = FF_RAMA_K;
/** Le poids des trois puits de χ1 (kcal/mol), et la fenêtre d'un puits (degrés). */
export const STRUCTURE_CALC_CHI_WEIGHT = FF_CHI_K;
export const STRUCTURE_CALC_CHI_TOLERANCE = FF_CHI_TOLERANCE;
/* LA TREMPE FINALE — la dynamique n'a pas de cible d'ω absolue et peut laisser une
   liaison peptidique près de la barrière : après la minimisation, un dernier recuit
   FROID répare ce qui reste — avec une LONGE : aucun mouvement qui ferait sortir une
   distance DÉJÀ respectée de sa tolérance n'est accepté. Trois paliers suffisent : à
   froid, seuls les mouvements qui améliorent sont gardés. */
export const STRUCTURE_CALC_QUENCH_STEPS = 3;
/** LA TEMPÉRATURE DE LA TREMPE (K). 100 K : l'énergie thermique y vaut 0.2 kcal/mol —
 *  assez pour essayer un autre rotamère de ω (sa barrière est franchie par un saut de
 *  12°, pas par une descente), trop peu pour casser ce que la minimisation vient de
 *  poser. Une trempe à 0 K ne ferait que descendre, et ne réparerait jamais ω. */
export const STRUCTURE_CALC_QUENCH_TEMPERATURE = 100;
/** Tous les combien de pas la grille des couples non liés est refaite (les atomes ont
 *  bougé, donc les couples trop serrés ne sont plus les mêmes). */
export const STRUCTURE_CALC_CORE_REFRESH = 24;

/* 1ter · LE CHAMP DE FORCES, ET LA PARTIE QUI BOUGE ────────────────────────────────
   Le champ lui-même vit dans `utils/forceFieldKcal.js` : douze familles, en kcal/mol,
   avec les charges, le solvant et l'entropie. Ici il n'y a que ce qui DÉPEND DU MOUVEMENT
   DIHÉDRAL — une torsion rigide ne peut changer NI une longueur de liaison, NI un angle,
   NI un cycle plan, NI l'entropie (ses amplitudes sont des constantes du modèle) :
   `forceFieldEnergyOf` les compte pour le RAPPORT et le SCORE, les moteurs (recuit,
   dynamique, minimisation) ne relisent que les familles variables — le score reste
   vérifiable comme `engine.costOf() + engine.constants === rapport.total`, et un test
   le mesure. */

/** LE MUR DE LA LONGE — ce que coûte, dans la dynamique et la minimisation, une
 *  distance DÉJÀ tenue qui sort de son puits plat. Le recuit de Metropolis peut REFUSER
 *  un pas (il en essaie un autre) ; une trajectoire ne le peut pas : la longe y est
 *  donc un MUR (zéro dans la tolérance, k·(dépassement)² au-delà — le MÊME k_NOE que la
 *  contrainte, donc 20 kcal/mol/Å², une fois et demie la raideur d'une liaison), et il
 *  est MULTIPLIÉ par le poids ⚖ de la ligne gardée. */
export const STRUCTURE_CALC_LEASH_WALL = FF_NOE_K;

/** LA DYNAMIQUE MOLÉCULAIRE DIHÉDRALE (Langevin) — les chiffres du panneau et des
 *  départs. `T` est en KELVINS : l'énergie thermique est `R·T` (0.60 kcal/mol à 300 K,
 *  6 kcal/mol à 3000 K), donc une dynamique d'AFFINAGE travaille entre 300 et 4000 K —
 *  exactement la plage d'un recuit/dynamique sous contraintes. Le plan de température
 *  est GÉOMÉTRIQUE (hot → cold), avec une phase d'ÉQUILIBRATION à température haute.
 *  `dt` est en PICOSECONDES (le temps NOMINAL de la trajectoire, celui que le panneau
 *  affiche : pas × dt), `friction` le γ de Langevin en ps⁻¹, `mass` l'inertie réduite
 *  d'un degré de liberté dihédral. */
export const STRUCTURE_CALC_MD_STEPS = 300;           // pas de la dynamique, par départ
export const STRUCTURE_CALC_MD_HOT = 1500;            // K — la phase d'équilibration
export const STRUCTURE_CALC_MD_COLD = 300;            // K — la fin du refroidissement
export const STRUCTURE_CALC_MD_DT = 0.01;             // ps (le « temps » d'un pas)
export const STRUCTURE_CALC_MD_FRICTION = 2;          // γ (ps⁻¹)
/** L'INERTIE RÉDUITE D'UN DIÈDRE — et c'est ELLE qui décide si la température demandée se
 *  VOIT. La remarque de cette session : « the MD looks more like a minimisation because
 *  when it reaches a correct structure the atoms don't move anymore » — mesuré : c'était
 *  exactement vrai, et voici pourquoi.
 *
 *  Ce moteur est une dynamique de Langevin : la vitesse thermique d'un canal vaut
 *  `√(R·T/m)` et son PAS thermique `√(2·h·R·T/(γ·m))`, tandis que sa DÉRIVE vaut
 *  `τ/(γ·m)`. Avec `m = 1`, à 1500 K, `√(R·T/m) = 1.7 °/ps` : un pas de 0.01 ps déplace un
 *  dièdre de 0.017°, soit 0.02 Å par image — INVISIBLE. Le temps de relaxation d'un puits,
 *  `τ_relax ≈ γ·m/k_θ`, valait alors ~200 ps = 20 000 pas, donc en 300 pas on ne voyait que
 *  la DESCENTE : mesuré, le déplacement par image valait 0.022 Å à 1500 K et 0.024 Å à
 *  300 K — identiques, donc sans rien de thermique (un mouvement thermique scale comme
 *  √T), et le potentiel descendait MONOTONEMENT jusqu'au minimum. La molécule s'arrêtait
 *  là, et la température ne se lisait que dans les vitesses : le geste était une
 *  minimisation, exactement ce que l'utilisateur décrivait.
 *
 *  AVEC `m = 0.0025` (400 fois plus léger) : `√(R·T/m)` = 34.5 °/ps à 1500 K, le pas
 *  thermique 0.35° (visible) et `τ_relax` ~0.5 ps = 50 pas (l'équilibre est ATTEINT dans le
 *  geste), donc la température CONDUIT le mouvement : mesuré sur la sonde de
 *  `_md_thermal_motion_test.mjs`, déplacement par image 0.438 Å à 1500 K contre 0.202 Å à
 *  300 K (rapport 2.17 ≈ √5 = √(1500/300)), et le potentiel de fin reste AU-DESSUS du
 *  minimum de la trajectoire : la molécule ne se colle plus au fond du puits.
 *  ⚠ L'INERTIE NE SUFFIT PAS — il faut aussi que le plafond de couple laisse le CHAMP
 *  répondre au thermostat (`√(R·T·m)/h`, voir `capsOf`) : avec l'inertie seule et le plafond
 *  `γ·m·√(R·T/m)`, les atomes se traversaient et les chaînes latérales se bloquaient (mesuré
 *  sur un peptide à trois résidus : plus proche contact 2.07 Å et χ1 figé à 5°, contre
 *  2.52 Å et χ1 à 46° après la correction — `_md_wall_test.mjs`). */
export const STRUCTURE_CALC_MD_MASS = 0.0025;         // inertie réduite d'un dièdre
export const STRUCTURE_CALC_MD_TORQUE_STEP = 1;       // ° de la différence finie du couple
/** LA PART D'ÉQUILIBRATION — le premier tiers des pas se fait à température HAUTE
 *  constante (c'est le « equilibration » de tout protocole), le reste refroidit
 *  linéairement sur l'échelle géométrique. */
export const STRUCTURE_CALC_MD_EQUILIBRATION = 1 / 3;
export const STRUCTURE_CALC_MD_PALIERS = 8;           // paliers du plan de température
/** Combien de pas de dynamique entre DEUX IMAGES — c'est ce qui se regarde pendant la
 *  dynamique : 8 pas de 0.01 ps font 0.08 ps par image, soit 63 images pour 500 pas.
 *  Sans cela, l'écran ne verrait que le début et la fin. */
export const STRUCTURE_CALC_MD_FRAME = 8;
/** COMBIEN DE VITESSE THERMIQUE UN PAS PEUT PORTER — et la MARGE du plafond de couple.
 *  Deux rôles, un seul chiffre : le pas `v·h` est borné par `f·√(R·T/m)` (le pas thermique,
 *  sauf si `MAX_SPEED` le borne avant), et le plafond du champ vaut `f·√(R·T·m)/h` — le
 *  couple qui renverse une vitesse thermique en UN pas (voir `capsOf`).
 *
 *  ⚠ POURQUOI LE PLAFOND EST CETTE EXPRESSION, ET PAS `γ·m·v` (MESURÉ, deux mondes) :
 *  `γ·m·v` vaut 0.17 kcal/mol/deg avec l'inertie du dossier, soit 0.69 °/ps de réponse par
 *  pas à un bruit de 6.9 °/ps : le champ ne pouvait pas contenir le thermostat, donc un mur
 *  de van der Waals était TRANSPARENT. Sur le même peptide, mêmes 300 pas, même graine :
 *    • `γ·m·v`      → plus proche contact 2.07 Å (un O···C), 30 images sur 300 SOUS le
 *                     `r_min` de 2.4 Å, et les chaînes latérales (χ1) figées à 5° pendant
 *                     que le squelette balayait 67° — exactement ce que l'utilisateur a
 *                     décrit : « gli atomi si attraversano » et « solo gli angoli φ e ψ » ;
 *    • `√(R·T·m)/h` → 2.52 Å, AUCUNE image sous `r_min`, et χ1 tourne de 46° en déplaçant
 *                     ses atomes de 3.8 Å.
 *  `f = 1` est donc le MINIMUM qui fasse d'un mur un mur (et non un maximum de confort) :
 *  mesuré, `f = 6` (le plafond absolu de 50) laisse ENTRER plus profond (2.44 Å) parce que
 *  la dérive y est plus rapide, et `f = 1` donne le contact le plus haut. Un plafond plus
 *  PETIT que 1 est l'ancien régime, et il laisse passer les atomes. */
export const STRUCTURE_CALC_MD_SPEED_FACTOR = 1;
/** LES GARDE-FOUS ABSOLUS DE L'INTÉGRATEUR — les plafonds de SÉCURITÉ, ceux qui ne
 *  dépendent ni de T ni de m : un mur de Lennard-Jones rend un couple de plusieurs
 *  millions de kcal/mol/deg et une trajectoire qui saute par-dessus la conformation
 *  (mesuré : des modèles à 10⁷ kcal/mol au lieu de −60). Ils sont donc des CEILINGS des
 *  plafonds dynamiques ci-dessus, jamais des substitutions. `MAX_SPEED` est en °/ps : la
 *  vitesse thermique vaut 34.5 °/ps à 1500 K, et un dièdre qui fait un tour en 0.3 ps est
 *  déjà anormal ; `MAX_STEP_DEG` borne la ROTATION d'un pas (20° est énorme pour une
 *  trajectoire — un dièdre ordinaire se tourne par petits pas). */
export const STRUCTURE_CALC_MD_MAX_TORQUE = 50;
/** ⚖ …ET LE PLAFOND DE LA FAMILLE DES DISTANCES, QUI SUIT LE POIDS DE LA LIGNE (500).
 *  La remarque de la session précédente : « the 📏 option is not active even if ticked
 *  because giving a high weight to one constraint did not have an effect on MD. »
 *  Mesuré : la mécanique MARCHAIT (la distance se rapprochait de sa cible), mais le couple
 *  d'une contrainte était plafonné à `STRUCTURE_CALC_MD_MAX_TORQUE` comme celui d'un mur de
 *  Lennard-Jones — donc une ligne de poids 10, 100 ou 1000 tirait EXACTEMENT comme une
 *  ligne de poids 25, et le geste semblait ne rien faire. Le plafond est donc SÉPARÉ et il
 *  suit le POIDS ⚖ : `τ_max(contrainte) = poids × 50`, plafonné à 500 — dix fois le plafond
 *  d'un mur, donc un poids élevé se sent VRAIMENT sans qu'une ligne absurde puisse envoyer
 *  la molécule en l'air. Un poids de 0 ou une ligne en pause ne reçoit rien (le poids 0 n'a
 *  pas de couple, la ligne ne pèse pas).
 *  ⚠ IL NE SUIT PAS LA TEMPÉRATURE, contrairement au plafond du champ : une distance
 *  demandée est une MOLA DURE, pas une agitation thermique (voir `mdFrames`). Le contrat est
 *  TENU malgré le changement d'inertie : mesuré, une contrainte fausse de 1.5 Å laisse une
 *  erreur de 0.332 Å au poids 1 et de 0.244 Å au poids 100. */
export const STRUCTURE_CALC_MD_MAX_RESTRAINT_TORQUE = 500;
export const STRUCTURE_CALC_MD_MAX_SPEED = 200;
export const STRUCTURE_CALC_MD_MAX_STEP_DEG = 20;
/** LE PAS D'UNE LIAISON PEPTIDIQUE (4°) — sa barrière vaut 20 kcal/mol, donc un pas de
 *  20° la franchirait par diffusion dès 1500 K (mesuré : un ω à 0.4° de trans finissait à
 *  123.8° après le protocole). Un peptide se tourne par PETITS pas. */
export const STRUCTURE_CALC_MD_OMEGA_STEP_DEG = 4;
/** COMBIEN DE DIÈDRES UN PAS DE DYNAMIQUE TOURNE (24) — un pas ne balaie pas les trois
 *  cents canaux d'une protéine : il en tourne un ÉCHANTILLON dont la fenêtre avance, donc
 *  chaque degré de liberté est mis à jour tous les `canaux/24` pas, avec le même bruit.
 *  C'est ce qui rend la dynamique abordable sur une protéine sans changer son
 *  thermostat — et le rapport dit le nombre de canaux par pas (`md.budget`). */
export const STRUCTURE_CALC_MD_CHANNELS = 24;
/** ⚠ COMBIEN DE PAS LA FENÊTRE PEUT SAUTER AVANT QUE L'INTERVALLE EFFECTIF D'UN CANAL NE
 *  CESSE DE GRANDIR (25) — c'est une borne de STABILITÉ, pas un réglage : l'intégrateur
 *  amortit la vitesse par `1 − γ·h_eff`, et à `h_eff = 1/γ = 25 pas` ce facteur s'annule (au
 *  delà il change de signe et la vitesse diverge). Voir `mdFrames` : chaque canal intègre le
 *  temps qu'il a réellement sauté (`dt × canaux/24`), donc une molécule de plus de 600
 *  dièdres voit sa fenêtre plafonnée ici. */
export const STRUCTURE_CALC_MD_MAX_SKIP = 25;
/** LA LONGUEUR NOMINALE DE LA TRAJETTOIRE, en picosecondes — `pas × dt`. C'est le
 *  chiffre que le panneau affiche quand il demande « quelle est la durée totale de la
 *  simulation ? », et il est calculé ICI : le panneau ne refait pas la multiplication. */
export const structureCalcSimulationTimeOf = ({ steps = STRUCTURE_CALC_MD_STEPS, dt = STRUCTURE_CALC_MD_DT } = {}) => {
  const n = clampInt(steps, 0, 1000000, 0);
  const h = Number(dt);
  const ps = Number.isFinite(h) && h > 0 ? n * h : 0;
  return { steps: n, dt: Number.isFinite(h) && h > 0 ? h : STRUCTURE_CALC_MD_DT, ps: Number(ps.toFixed(4)), ns: Number((ps / 1000).toFixed(6)) };
};

/* ── 💧 LE SOLVANT DE LA DYNAMIQUE ISOLÉE ─────────────────────────────────────
   Le solvant d'un moteur DIHÉDRAL a deux formes, et ce choix les offre toutes les deux :
     · UN DIÉLECTRIQUE IMPLICITE — les charges sont écrantées par ε et la surface non
       polaire est une FAMILLE du champ (⚗ SASA) :
         – `implicit` — le modèle du champ, ε = 4 (le défaut : rien ne change) ;
         – `vacuum`   — ε = 1 : aucun écrantage, les charges se voient en entier ;
         – `water`    — ε = 80 : l'écrantage uniforme de l'eau en volume ;
     · UNE BOÎTE D'EAU EXPLICITE — la demande de cette session : « it would be great if you
       could add the explicit solvent as a further option with its box. » `explicit` pose
       une BOÎTE CUBIQUE de molécules d'eau TIP3P RIGIDES autour de la molécule (voir
       `explicitSolventOf`), à ε = 1 : les charges ne sont plus écrantées par un chiffre
       mais par des molécules, et chaque eau porte ses paramètres et ses charges fixes.
       Le nombre d'eaux suit l'ARÊTE de la boîte, que le panneau expose comme un réglage.
   ⚠ CE QUE LA BOÎTE EST, ET CE QU'ELLE EST DEVENUE. Un moteur dihédral tourne des
   charnières et une molécule d'eau n'en a aucune : les eaux sont donc RIGIDES (leur
   géométrie TIP3P ne bouge pas d'un chiffre), et elles le restent. Mais elles ne sont plus
   IMMOBILES : la décision de cette session (« MAKE WATER MOBILE ») leur a donné leurs six
   degrés de liberté — trois translations et trois rotations — intégrés par le même Langevin
   que les dièdres, dans les vraies unités (voir `waterRigidBodyOf`, `mdFrames`). Elles
   écrantent à ε = 1, elles poussent, elles comptent dans chaque famille du champ, ET elles
   diffusent pendant ▶ MD ; le rapport du geste donne ce qu'elles ont fait (combien ont
   bougé, de combien, et la température cinétique que leur thermostat tient vraiment).
   Sans période (minimum image), la boîte reste une FRONTIÈRE de solvatation, pas un cristal
   infini : une eau qui sort de l'arête n'y rentre pas.
   Le panneau écrit ces libellés tels quels : aucun ε n'est recopié dans le JSX. */
export const STRUCTURE_CALC_SOLVENT = 'implicit';
/** L'ARÊTE PAR DÉFAUT DE LA BOÎTE EXPLICITE (Å) — un cube de 24 Å (~38 Å³ par molécule
   d'eau en phase condensée, donc de quoi hydrater un peptide de quelques résidus). */
export const STRUCTURE_CALC_SOLVENT_BOX = 24;
export const STRUCTURE_CALC_SOLVENT_BOX_MIN = 8;
export const STRUCTURE_CALC_SOLVENT_BOX_MAX = 80;
/** L'EAU LIBRE LAISSÉE AUTOUR DE LA MOLÉCULE, au minimum (Å) — de quoi poser une couche
   d'hydratation : sans elle, une arête « automatique » collerait la boîte au soluté. */
export const STRUCTURE_CALC_SOLVENT_MARGIN = 8;
export const STRUCTURE_CALC_SOLVENTS = [
  { id: 'implicit', label: 'implicit · ε = 4', dielectric: FF_DIELECTRIC,
    of: 'the model the field already uses (charges screened by ε = 4)' },
  { id: 'vacuum', label: 'vacuum · ε = 1', dielectric: 1,
    of: 'no screening at all — the charges see each other in full' },
  { id: 'water', label: 'bulk water · ε = 80', dielectric: 80,
    of: 'uniform screening by the dielectric of bulk water' },
  { id: 'explicit', label: '💧 explicit water box · ε = 1', dielectric: 1, explicit: true,
    of: 'a cubic box of RIGID TIP3P waters (O and H are real atoms of the field, with their '
      + 'own charges at ε = 1): they screen, they push, they are counted in every family, '
      + 'and in ▶ MD they MOVE (each one translates and rotates under the same Langevin as '
      + 'the dihedrals) — the box edge sets how many there are' },
];
/** LE MODÈLE DEMANDÉ, TOUJOURS DÉFINI — un identifiant inconnu (ou absent) rend le modèle
 *  par défaut : le panneau ne peut donc ni jeter pour un identifiant qu'il n'a pas écrit
 *  lui-même, ni afficher un `undefined`. */
export const structureCalcSolventOf = (id) => STRUCTURE_CALC_SOLVENTS
  .find((s) => s.id === (id == null ? '' : String(id)))
  || STRUCTURE_CALC_SOLVENTS.find((s) => s.id === STRUCTURE_CALC_SOLVENT);
/** LE SOLVANT CHOISI EST-IL EXPLICITE ? — la question que posent les gestes du champ
 *  avant de construire une boîte (et le panneau avant d'afficher son réglage d'arête). */
export const structureCalcSolventIsExplicit = (id) => !!structureCalcSolventOf(id).explicit;

/* ── 🎯 LA FONCTION CIBLE — CE QUE LE CALCUL CHERCHE À MINIMISER ───────────────
   La demande de cette session : « if the present plan is correct I wouldn't throw it but
   I would add the option to run as dyana as well. » La liste est celle du CHAMP
   (`FF_TARGET_FUNCTIONS`, utils/forceFieldKcal.js) — le module du protocole n'en écrit pas
   une seconde : il la réexporte, la résout, et la descend dans les quatre moteurs
   (recuit, dynamique, minimisation, trempe) ET dans le score. Un départ, un geste et le
   rapport parlent donc TOUJOURS de la même fonction cible. */
export const STRUCTURE_CALC_TARGET_FUNCTIONS = FF_TARGET_FUNCTIONS;
export const STRUCTURE_CALC_TARGET_FUNCTION = 'classic';
export const structureCalcTargetFunctionOf = (id) => ffTargetFunctionOf(
  id == null || String(id) === '' ? STRUCTURE_CALC_TARGET_FUNCTION : id,
);

/* ── 💧 LA BOÎTE D'EAU EXPLICITE — LA CONSTRUIRE, UNE SEULE FOIS, ICI ──────────
   `explicitSolventOf` pose des molécules d'eau TIP3P RIGIDES sur un RÉSEAU CUBIQUE
   centré sur la molécule, à maille 3.1 Å (le σ de l'eau : deux oxygènes voisins sont
   donc au contact de van der Waals, ce qui est la densité d'un liquide), et ÉCARTE tout
   site qui toucherait la molécule (O···atome lourd < 2.6 Å) ou une eau déjà posée. La
   molécule n'est jamais traversée par une eau — un site écarté est simplement vide, et
   le rapport dit combien l'ont été.
   ⚠ LES ATOMES D'EAU SONT AJOUTÉS À LA FIN (`OW`, `HW`, `HW` par molécule), comme les
   hydrogènes du champ : les indices d'origine ne bougent pas, donc les contraintes, les
   canaux et les résidus de l'utilisateur gardent les leurs — c'est le contrat de tout
   ajout d'atomes dans ce dossier.
   ⚠ L'ORIENTATION EST LA MÊME POUR TOUTES LES EAUX (les deux H dans le plan du réseau) :
   c'est un ENVIRONNEMENT, pas une dynamique d'eau, et une orientation tirée au hasard
   rendrait le calcul non reproductible d'une exécution à l'autre. */
export const STRUCTURE_CALC_WATER_SPACING = 3.1;      // Å entre deux oxygènes voisins
export const STRUCTURE_CALC_WATER_CLEARANCE = 2.6;    // Å O···atome lourd, au minimum
export const explicitSolventOf = ({
  positions = null, elements = [], bonds = [],
  edge = STRUCTURE_CALC_SOLVENT_BOX, margin = STRUCTURE_CALC_SOLVENT_MARGIN,
} = {}) => {
  const read = flatPositions(positions);
  const out = {
    ok: false, reason: 'bad-points', edge: 0, needed: 0, sites: 0, skipped: 0,
    molecules: 0, atoms: 0, solute: 0, positions: null, elements: [], bonds: [], box: null,
  };
  if (!read || !read.count) return out;
  const x = read.flat;
  const count = read.count;
  const elsOrg = Array.from(elements || []);
  /* L'ARÊTE — celle qu'on demande, ou « la molécule + de l'eau libre » quand elle est
     absente. ⚠ UNE BOÎTE TROP PETITE POUR CONTENIR LA MOLÉCULE EST REFUSÉE, jamais
     agrandie en silence : le réglage de l'utilisateur doit vouloir dire quelque chose. */
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < count; k += 1) {
    for (let c = 0; c < 3; c += 1) {
      const v = Number(x[k * 3 + c]);
      if (v < min[c]) min[c] = v;
      if (v > max[c]) max[c] = v;
    }
  }
  const centre = [0, 1, 2].map((c) => (min[c] + max[c]) / 2);
  const span = [0, 1, 2].map((c) => max[c] - min[c]);
  const needed = Math.max(span[0], span[1], span[2]) + 2 * Math.max(0, Number(margin) || 0);
  const asked = Number(edge);
  const wanted = Number.isFinite(asked) && asked > 0 ? asked : needed;
  const size = Math.min(STRUCTURE_CALC_SOLVENT_BOX_MAX,
    Math.max(STRUCTURE_CALC_SOLVENT_BOX_MIN, wanted));
  out.edge = size;
  out.needed = Number(needed.toFixed(3));
  if (size < needed - 1e-6) { out.reason = 'box-too-small'; return out; }
  const half = size / 2;
  out.box = {
    centre, edge: size, half,
    min: [0, 1, 2].map((c) => centre[c] - half),
    max: [0, 1, 2].map((c) => centre[c] + half),
  };
  const step = STRUCTURE_CALC_WATER_SPACING;
  const n = Math.max(1, Math.floor(size / step));
  const first = [0, 1, 2].map((c) => centre[c] - ((n - 1) * step) / 2);
  const clearance2 = STRUCTURE_CALC_WATER_CLEARANCE ** 2;
  const spacing2 = (step * 0.95) ** 2;
  const sites = [];
  for (let a = 0; a < n; a += 1) {
    for (let b = 0; b < n; b += 1) {
      for (let c = 0; c < n; c += 1) {
        const o = [first[0] + a * step, first[1] + b * step, first[2] + c * step];
        /* ⚠ LE CENTRE D'UN OXYGÈNE RESTE DANS LA BOÎTE — une eau ne déborde pas de son
           arête (sinon `edge` serait une arête « à peu près »). */
        if ([0, 1, 2].some((k) => Math.abs(o[k] - centre[k]) > half - FF_TIP3P.ow.radius + 1e-6)) continue;
        let take = true;
        for (let k = 0; k < count && take; k += 1) {
          const dx = x[k * 3] - o[0]; const dy = x[k * 3 + 1] - o[1]; const dz = x[k * 3 + 2] - o[2];
          if (dx * dx + dy * dy + dz * dz < clearance2) take = false;
        }
        for (let s = 0; s < sites.length && take; s += 1) {
          const q = sites[s];
          const dx = q[0] - o[0]; const dy = q[1] - o[1]; const dz = q[2] - o[2];
          if (dx * dx + dy * dy + dz * dz < spacing2) take = false;
        }
        if (!take) { out.skipped += 1; continue; }
        sites.push(o);
      }
    }
  }
  out.sites = sites.length;
  out.molecules = sites.length;
  if (!sites.length) { out.reason = 'no-water'; return out; }
  /* LA GÉOMÉTRIE RIGIDE — deux H à 0.9572 Å de leur O, écartés de l'angle H–O–H du
     modèle (± θ/2 autour de l'axe X du réseau), et les liaisons O–H qui vont avec : une
     eau est une MOLÉCULE du graphe, pas trois atomes isolés (le champ lit ses charges
     fixes et la surface la voit entière). */
  const pos = Array.from(x);
  const els = elsOrg.slice();
  const bl = Array.from(bonds || []);
  const halfAngle = (FF_TIP3P.angle * Math.PI / 180) / 2;
  const dx = FF_TIP3P.oh * Math.cos(halfAngle);
  const dy = FF_TIP3P.oh * Math.sin(halfAngle);
  for (let s = 0; s < sites.length; s += 1) {
    const o = sites[s];
    const base = count + s * 3;
    pos[base * 3] = o[0]; pos[base * 3 + 1] = o[1]; pos[base * 3 + 2] = o[2];
    pos[(base + 1) * 3] = o[0] + dx; pos[(base + 1) * 3 + 1] = o[1] + dy; pos[(base + 1) * 3 + 2] = o[2];
    pos[(base + 2) * 3] = o[0] + dx; pos[(base + 2) * 3 + 1] = o[1] - dy; pos[(base + 2) * 3 + 2] = o[2];
    els.push('OW', 'HW', 'HW');
    bl.push({ i: base, j: base + 1, order: 1 }, { i: base, j: base + 2, order: 1 });
  }
  out.ok = true; out.reason = 'ok';
  out.positions = pos;
  out.elements = els;
  out.bonds = bl;
  out.solute = count;
  out.atoms = count + sites.length * 3;
  out.waters = ffWatersIn(els);
  return out;
};

/* ── 💧 LES EAUX COMME CORPS RIGIDES — LA MOITIÉ NON DIHÉDRALE DE LA DYNAMIQUE ─────
   LA DÉCISION DE CETTE SESSION : les eaux TIP3P de la boîte explicite DOIVENT vraiment
   diffuser pendant ▶ MD. Jusqu'ici la boîte était un DÉCOR HONNÊTE — des atomes RÉELS du
   champ (elles écrantent à ε = 1, elles poussent, elles comptent dans chaque famille,
   `costOf` les somme) dont la position ne bougeait jamais, parce que le moteur ne tourne
   que des CHARNIÈRES et qu'une molécule d'eau n'en a aucune. Ce bloc leur donne ce que le
   moteur dihédral ne peut pas leur donner : TROIS TRANSLATIONS et TROIS ROTATIONS,
   intégrées par le MÊME Langevin que les dièdres (frottement γ, bruit de
   fluctuation–dissipation) mais dans les VRAIES unités — les masses TIP3P en amu et le
   tenseur d'inertie en amu·Å², donc `√(k_B·T/M)` est une vitesse en Å/ps (le pont
   d'unités est `FF_KCAL_PER_AMU_A2_PS2`).

   CE QU'ELLES SENTENT — le gradient EXACT des couples non liés du champ
   (`ffNonbondedGradientOf`, la dérivée de `ffNonbondedCostOf`), eau–eau ET eau–soluté,
   dans la portée de la fonction cible : la force totale et son couple autour du centre de
   masse poussent le corps rigide, dont la géométrie TIP3P ne bouge pas d'un chiffre (ses
   trois atomes sont reposés par une rotation EXACTE à chaque pas, jamais par une
   intégration de leurs coordonnées).

   ⚠ CE QU'ELLES NE SENTENT PAS, ET C'EST DIT ICI :
     · le terme de SURFACE non polaire n'a pas de gradient analytique dans ce dossier : les
       eaux ne sentent donc pas SON gradient (elles comptent toujours dans le coût et dans
       le rapport, `costOf` les somme) — l'asymétrie est bornée et NOMMÉE, pas cachée ;
     · le SOLUTÉ n'est pas poussé en retour : c'est un moteur DIHÉDRAL, les degrés de
       liberté du soluté sont ses charnières, pas ses translations. Les deux moitiés se
       voient donc par GAUSS–SEIDEL — le pas de torsion lit la géométrie des eaux (elles
       sont dans sa liste de couples), le pas d'eau lit la géométrie du soluté — au lieu de
       s'échanger des forces cartésiennes. C'est la convention du moteur (une image = une
       géométrie complète), et elle reste écrite ici.

   ⚠ LE REPÈRE DU CORPS EST LE REPÈRE INITIAL — il est rigidement attaché à la molécule,
   donc le tenseur d'inertie y est CONSTANT, et aucune diagonalisation n'est nécessaire :
   le bruit du thermostat est tiré avec le CHOLESKY du tenseur (une loi normale de
   covariance `k_B·T·I`), qui rend aussi son inverse. Rien n'est approximé en « rotateur
   isotrope » : les trois rotations gardent leurs trois moments. */
export const STRUCTURE_CALC_WATER_MOBILE = true;
/** 💧 LA CADENCE DE RELECTURE DES COUPLES DES EAUX — la marche est en O(N²), elle n'est
 *  donc pas refaite à chaque pas mais tous les `WATER_REFRESH` pas : une eau qui avance de
 *  0.08 Å par pas est relue bien avant d'avoir franchi la portée du champ. */
export const STRUCTURE_CALC_WATER_REFRESH = 4;
/** LE PLAFOND ABSOLU DE VITESSE D'UNE EAU (Å/ps) — un garde-fou de dernier recours : le
 *  plafond qui compte est `speedFactor × vitesse thermique` (voir `waterRigidBodyOf`).
 *  ⚠ IL EST LARGE À DESSEIN — mesuré : coupé à 20 Å/ps (2.4 vitesses thermiques à 1500 K),
 *  il TRONQUE la gaussienne et la température lue tombe de 8 % ; 100 Å/ps (12 σ) ne coupe
 *  plus rien de physique et reste un garde-fou. */
export const STRUCTURE_CALC_WATER_MAX_SPEED = 100;
/** LE PAS ANGULAIRE MAXIMAL D'UNE EAU, PAR SOUS-ROTATION (radians ≈ 5.7°) — l'analogue du
 *  pas maximal d'un dièdre. Une eau chaude tourne à ~32 rad/ps (5 THz), donc sa ROTATION est
 *  subdivisée à son tour pour que chacune reste sous ceci (voir `waterRigidBodyOf`). */
export const STRUCTURE_CALC_WATER_MAX_TURN = 0.1;
/** LE DÉPLACEMENT MAXIMAL D'UNE EAU PAR ÉVALUATION DE FORCE (Å) — c'est lui qui décide de la
 *  SUBDIVISION DU PAS (voir `waterRigidBodyOf`). Mesuré : à 0.01 ps d'un seul tenant, deux
 *  oxygènes se traversaient jusqu'à 1.52 Å, alors que la conservation de l'énergie arrête un
 *  choc frontal à 1500 K vers 2.3 Å — c'était donc le PAS, pas le champ. À 0.02 Å par
 *  évaluation, le mur de van der Waals a le temps de monter et le rebond tombe juste. */
export const STRUCTURE_CALC_WATER_MAX_MOVE = 0.02;
/** LE NOMBRE MAXIMAL DE SOUS-PAS D'UNE EAU (translation ET rotation) — une borne de coût,
 *  pas de physique (une eau folle ne peut pas transformer le geste en boucle). */
export const STRUCTURE_CALC_WATER_MAX_SUB = 24;
/** LE FACTEUR DE VITESSE — combien de vitesses thermiques un pas peut renverser (1 : la
 *  même convention que les dièdres, `STRUCTURE_CALC_MD_SPEED_FACTOR`). */
export const STRUCTURE_CALC_WATER_SPEED_FACTOR = 1;
/** LES CEILINGS ABSOLUS DE FORCE (kcal·mol⁻¹·Å⁻¹) ET DE COUPLE (kcal/mol) — ils ne sont
 *  PAS la valeur de tous les jours (celle-ci suit T et la masse, voir `step`) ; ils sont
 *  là pour qu'un cas pathologique n'explose pas. */
export const STRUCTURE_CALC_WATER_MAX_FORCE = 2e4;
export const STRUCTURE_CALC_WATER_MAX_TORQUE = 5e3;

/* LA PETITE ALGÈBRE D'UN CORPS RIGIDE — quatre opérations sur des matrices 3×3, écrites
   ici parce que le dossier n'a pas de bibliothèque de matrices et que la rotation d'une
   eau doit rester une rotation EXACTE (aucune coordonnée d'atome n'est intégrée à la main). */
const mat3Mul = (a, b) => [
  [a[0][0] * b[0][0] + a[0][1] * b[1][0] + a[0][2] * b[2][0],
    a[0][0] * b[0][1] + a[0][1] * b[1][1] + a[0][2] * b[2][1],
    a[0][0] * b[0][2] + a[0][1] * b[1][2] + a[0][2] * b[2][2]],
  [a[1][0] * b[0][0] + a[1][1] * b[1][0] + a[1][2] * b[2][0],
    a[1][0] * b[0][1] + a[1][1] * b[1][1] + a[1][2] * b[2][1],
    a[1][0] * b[0][2] + a[1][1] * b[1][2] + a[1][2] * b[2][2]],
  [a[2][0] * b[0][0] + a[2][1] * b[1][0] + a[2][2] * b[2][0],
    a[2][0] * b[0][1] + a[2][1] * b[1][1] + a[2][2] * b[2][1],
    a[2][0] * b[0][2] + a[2][1] * b[1][2] + a[2][2] * b[2][2]],
];
/** LA MATRICE APPLIQUÉE À UN VECTEUR (`A·v`) — du repère du CORPS au LABORATOIRE. */
const mat3Vec = (a, v) => [
  a[0][0] * v[0] + a[0][1] * v[1] + a[0][2] * v[2],
  a[1][0] * v[0] + a[1][1] * v[1] + a[1][2] * v[2],
  a[2][0] * v[0] + a[2][1] * v[1] + a[2][2] * v[2],
];
/** LA TRANSPOSÉE APPLIQUÉE À UN VECTEUR (`Aᵀ·v`) — du laboratoire au CORPS. */
const mat3ApplyT = (a, v) => [
  a[0][0] * v[0] + a[1][0] * v[1] + a[2][0] * v[2],
  a[0][1] * v[0] + a[1][1] * v[1] + a[2][1] * v[2],
  a[0][2] * v[0] + a[1][2] * v[1] + a[2][2] * v[2],
];
/** LA ROTATION EXACTE D'UN VECTEUR-ROTATION (`θ·k`, radians) — Rodrigues. C'est elle qui
 *  repose les trois atomes d'une eau : une longueur O–H ne peut donc pas dériver. */
const rotMat3 = (v) => {
  const t = Math.hypot(v[0], v[1], v[2]);
  if (!(t > 1e-12)) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const x = v[0] / t; const y = v[1] / t; const z = v[2] / t;
  const c = Math.cos(t); const s = Math.sin(t); const d = 1 - c;
  return [
    [c + x * x * d, x * y * d - z * s, x * z * d + y * s],
    [y * x * d + z * s, c + y * y * d, y * z * d - x * s],
    [z * x * d - y * s, z * y * d + x * s, c + z * z * d],
  ];
};
/** LE REPÈRE DU CORPS REMIS ORTHONORMÉ (Gram–Schmidt) — 300 rotations exactes laissent une
 *  erreur d'arrondi de l'ordre de 10⁻¹⁴ ; ce nettoyage, une fois par pas, garde la matrice
 *  de rotation dans le groupe où Rodrigues l'a mise. */
const orthonormalize3 = (m) => {
  const norm = (v) => { const d = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / d, v[1] / d, v[2] / d]; };
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const x = norm([m[0][0], m[1][0], m[2][0]]);
  const raw = [m[0][1], m[1][1], m[2][1]];
  const p = dot(raw, x);
  const y = norm([raw[0] - p * x[0], raw[1] - p * x[1], raw[2] - p * x[2]]);
  const z = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
  return [[x[0], y[0], z[0]], [x[1], y[1], z[1]], [x[2], y[2], z[2]]];
};
/** LE CHOLESKY D'UN TENSEUR 3×3 SYMÉTRIQUE DÉFINI POSITIF — `L·Lᵀ = I`. C'est lui qui tire
 *  le bruit du thermostat d'un corps ANISOTROPE : `L·G` (G gaussien) a exactement la
 *  covariance `k_B·T·I`, donc chaque axe reçoit SON moment d'inertie au lieu d'une moyenne. */
const chol3 = (m) => {
  const l = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      let s = Number(m[i][j]) || 0;
      for (let k = 0; k < j; k += 1) s -= l[i][k] * l[j][k];
      if (i === j) l[i][j] = Math.sqrt(Math.max(1e-30, s));
      else l[i][j] = s / l[j][j];
    }
  }
  return l;
};
/** L'INVERSE D'UN 3×3 (cofacteurs) — `I⁻¹·L` doit rendre la vitesse angulaire d'un corps
 *  dont le tenseur n'est PAS sphérique : une moyenne isotrope ne suffirait pas. */
const inv3 = (m) => {
  const a = m[0][0]; const b = m[0][1]; const c = m[0][2];
  const d = m[1][0]; const e = m[1][1]; const f = m[1][2];
  const g = m[2][0]; const h = m[2][1]; const i = m[2][2];
  const A = e * i - f * h; const B = f * g - d * i; const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const s = Math.abs(det) > 1e-30 ? 1 / det : 0;
  return [
    [A * s, (c * h - b * i) * s, (b * f - c * e) * s],
    [B * s, (a * i - c * g) * s, (c * d - a * f) * s],
    [C * s, (b * g - a * h) * s, (a * e - b * d) * s],
  ];
};

/** 💧 LES EAUX D'UNE MOLÉCULE COMME AUTANT DE CORPS RIGIDES — la seule façon dont un
 *  moteur DIHÉDRAL peut faire bouger une eau : elle n'a pas de charnière, donc on lui
 *  donne ce qu'elle a vraiment, TROIS TRANSLATIONS et TROIS ROTATIONS, et on ne touche
 *  jamais à ses coordonnées d'atomes à la main (chaque pas REPOSE les trois atomes par une
 *  rotation exacte autour du centre de masse, voir `mat3Vec`/`rotMat3`), de sorte que sa
 *  géométrie TIP3P est invariante par construction.
 *
 *  CONSTRUIT UNE FOIS — masse, centre de masse, tenseur d'inertie (dans le repère initial,
 *  rigidement attaché, donc constant), son Cholesky et son inverse. `positions` est ÉCRIT
 *  EN PLACE : c'est le `x` vivant du moteur, donc les images d'une dynamique portent déjà
 *  les eaux qui ont bougé — rien n'est recopié entre le moteur et l'écran.
 *
 *  @returns {{ok:boolean, reason:string, molecules:number, atoms:number, positions:any,
 *             atomIndex:number[][], step:Function, stats:Function}}
 *   `step({ pairs, options, dt, temperature, friction, gaussian })` pousse les six degrés de
 *   liberté d'un pas de Langevin ; `stats()` rend ce qui a bougé et la température cinétique
 *   MESURÉE des deux moitiés (translation, rotation) — le contrôle qui dit si le thermostat
 *   tient vraiment ce qu'il annonce. */
export const waterRigidBodyOf = ({
  positions = null, elements = [], bonds = [], seed = STRUCTURE_CALC_SEED,
} = {}) => {
  const els = Array.from(elements || []);
  const count = els.length;
  const x = positions;
  const idle = (reason) => ({
    ok: false, reason, molecules: 0, atoms: 0, positions: x, atomIndex: [],
    step: () => ({ ok: false, applied: 0 }), stats: () => null,
  });
  if (!x || !count || x.length < count * 3) return idle('bad-points');
  /* LES EAUX — chaque OW et SES DEUX H, lus par le GRAPHE quand il est là (une eau peut
     être écrite dans n'importe quel ordre dans un fichier lu) ; sinon le repli par ORDRE
     (les deux HW qui suivent l'OW, l'écriture de `explicitSolventOf`). Aucun indice n'est
     deviné quand le graphe répond — et une eau incomplète n'est jamais déplacée. */
  const near = new Map();
  for (const b of Array.from(bonds || [])) {
    const i = Number(b && b.i); const j = Number(b && b.j);
    if (!Number.isInteger(i) || !Number.isInteger(j) || i === j) continue;
    if (i < 0 || j < 0 || i >= count || j >= count) continue;
    const a = near.get(i); if (a) a.push(j); else near.set(i, [j]);
    const c = near.get(j); if (c) c.push(i); else near.set(j, [i]);
  }
  const isEl = (k, want) => String(els[k] || '').trim().toUpperCase() === want;
  const found = [];
  for (let k = 0; k < count; k += 1) {
    if (!isEl(k, 'OW')) continue;
    found.push({ o: k, h: (near.get(k) || []).filter((m) => isEl(m, 'HW')).slice(0, 2) });
  }
  if (!found.length) return idle('no-water');
  const taken = new Set();
  for (const w of found) for (const h of w.h) taken.add(h);
  const spare = [];
  for (let k = 0; k < count; k += 1) if (isEl(k, 'HW') && !taken.has(k)) spare.push(k);
  let s = 0;
  const made = [];
  for (const w of found) {
    while (w.h.length < 2 && s < spare.length) { w.h.push(spare[s]); s += 1; }
    if (w.h.length === 2) made.push(w);
  }
  if (!made.length) return idle('no-water');
  /* LE BRUIT VIENT DU GÉNÉRATEUR DU DOSSIER — `makeRelaxRandom`, le seul tirage du module
     (voir `randomTorsionsOf`) : un geste rejoué avec la même graine donne donc la MÊME
     trajectoire, eaux comprises. ⚠ AUCUN `Math.random` ICI : la suite du dossier l'interdit
     (« ni mulberry32 recopié, ni Math.random ») — un second générateur caché rendrait la
     dynamique irreproductible sans le dire. */
  const random = makeRelaxRandom(seed);
  const drawNormal = () => {
    let u = 0; let v = 0;
    while (u === 0) u = random();
    while (v === 0) v = random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const n = made.length;
  const index = made.map((w) => [w.o, w.h[0], w.h[1]]);
  const atomMass = [FF_TIP3P.ow.mass, FF_TIP3P.hw.mass, FF_TIP3P.hw.mass];
  const mass = made.map(() => atomMass[0] + 2 * atomMass[1]);
  const R = new Float64Array(n * 3);      // centre de masse (Å)
  const V = new Float64Array(n * 3);      // vitesse de translation (Å/ps)
  const Lm = new Float64Array(n * 3);     // moment cinétique, repère du LABORATOIRE
  const A = [];                           // rotation corps → laboratoire
  const C = [];                           // Cholesky du tenseur d'inertie (corps)
  const Iinv = [];                        // son inverse
  const Ibar = new Float64Array(n);       // sa trace / 3 (l'échelle des plafonds)
  const body = [];                        // les trois décalages DANS le corps
  const home = [];                        // le centre de masse de départ (statistique)
  const waterOf = new Int32Array(count).fill(-1);
  /* LE CONTACT LE PLUS COURT ATTEINT PAR UNE EAU — mesuré dans la boucle des forces (donc
     GRATUIT) et jamais remis à zéro : c'est la seule façon honnête de dire si le modèle a
     laissé deux molécules se comprimer au-delà de son σ, sans le cacher derrière un mot. */
  let closest = Infinity;
  /* LA SUBDIVISION DU DERNIER PAS — rendue par `stats()` : le geste est plus cher quand les
     eaux vont vite (chaque sous-pas relit les forces), et le rapport peut donc l'expliquer
     au lieu de laisser croire à une lenteur mystérieuse. */
  let lastSub = 1;
  for (let w = 0; w < n; w += 1) {
    const at = index[w];
    const M = mass[w];
    const p = at.map((k) => [x[k * 3], x[k * 3 + 1], x[k * 3 + 2]]);
    const com = [0, 0, 0];
    for (let k = 0; k < 3; k += 1) {
      for (let c = 0; c < 3; c += 1) com[c] += (atomMass[k] * p[k][c]) / M;
    }
    const off = p.map((q) => [q[0] - com[0], q[1] - com[1], q[2] - com[2]]);
    /* LE TENSEUR D'INERTIE DANS LE REPÈRE DU CORPS — le repère INITIAL sert de repère du
       corps : il est rigidement attaché, donc le tenseur y est constant. */
    const I = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let k = 0; k < 3; k += 1) {
      const d2 = off[k][0] ** 2 + off[k][1] ** 2 + off[k][2] ** 2;
      for (let a = 0; a < 3; a += 1) {
        for (let b = 0; b < 3; b += 1) {
          I[a][b] += atomMass[k] * ((a === b ? d2 : 0) - off[k][a] * off[k][b]);
        }
      }
    }
    C.push(chol3(I));
    Iinv.push(inv3(I));
    Ibar[w] = (I[0][0] + I[1][1] + I[2][2]) / 3;
    A.push([[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
    body.push(off);
    home.push([com[0], com[1], com[2]]);
    for (const k of at) waterOf[k] = w;
    R[w * 3] = com[0]; R[w * 3 + 1] = com[1]; R[w * 3 + 2] = com[2];
  }

  /** UN PAS DE LANGEVIN SUR LES SIX DEGRÉS DE LIBERTÉ D'UNE EAU — `pairs` est la marche
   *  des couples non liés du champ (eau–eau ET eau–soluté), `options` la fonction cible du
   *  geste. La translation et la rotation sont poussées par le MÊME bruit de
   *  fluctuation–dissipation que les dièdres, chacune dans ses VRAIES unités (masse en amu,
   *  tenseur en amu·Å²), et les trois atomes sont REPOSÉS par la rotation du pas. */
  const step = ({
    pairs = [], options = {}, dt = STRUCTURE_CALC_MD_DT, temperature = 0,
    friction = STRUCTURE_CALC_MD_FRICTION, gaussian = null,
    maxSpeed = STRUCTURE_CALC_WATER_MAX_SPEED, maxTurn = STRUCTURE_CALC_WATER_MAX_TURN,
    speedFactor = STRUCTURE_CALC_WATER_SPEED_FACTOR, maxSub = STRUCTURE_CALC_WATER_MAX_SUB,
    maxMove = STRUCTURE_CALC_WATER_MAX_MOVE,
    maxForce = STRUCTURE_CALC_WATER_MAX_FORCE, maxTorque = STRUCTURE_CALC_WATER_MAX_TORQUE,
  } = {}) => {
    const h = Math.max(1e-6, Math.abs(Number(dt) || STRUCTURE_CALC_MD_DT));
    const gamma = Math.max(0, Number(friction) || 0);
    const T = Math.max(0, Number(temperature) || 0);
    /* LES UNITÉS INTERNES — l'énergie du champ (kcal/mol) est convertie en amu·Å²/ps², la
       seule écriture dans laquelle `√(k_B·T/M)` est une vitesse d'atome. */
    const kT = FF_GAS_CONSTANT * T * FF_KCAL_PER_AMU_A2_PS2;
    /* ⚠ LE TIRAGE PAR DÉFAUT EST CELUI DU DOSSIER (`drawNormal`) : `gaussian` n'existe que
       pour injecter un flux — le module ne contient AUCUN `Math.random`. */
    const noise = typeof gaussian === 'function' ? gaussian : drawNormal;
    const F = new Float64Array(n * 3);
    const Tq = new Float64Array(n * 3);
    const sf = Math.abs(Number(speedFactor)) || 1;
    const vCeil = Math.abs(Number(maxSpeed)) || Infinity;
    const tCeil = Math.abs(Number(maxTorque)) || Infinity;
    const fCeil = Math.abs(Number(maxForce)) || Infinity;
    const turnCap = Math.abs(Number(maxTurn)) || Infinity;
    /* ⚠ LE PAS EST SUBDIVISÉ, ET LE NOMBRE VIENT DE LA PLUS RAPIDE DES EAUX — une marche de
       0.01 ps est TROP LONGUE pour une collision d'eau : mesuré sur une trajectoire réelle,
       deux oxygènes se traversaient jusqu'à 1.52 Å. Ce n'est pas la faute du champ (le puits
       TIP3P de l'eau vaut 0.15 kcal/mol, et l'énergie d'un choc frontal à 1500 K —
       ½·μ·v² ≈ 5.9 kcal/mol — arrête les deux molécules à ≈ 2.3 Å : c'est ce que dit la
       conservation de l'énergie, et le potentiel y est déjà raide) : c'est l'INTÉGRATION qui
       ratait le point de rebroussement, parce que la force n'était relue qu'UNE fois par pas.
       Le pas est donc divisé pour qu'aucune eau ne se déplace de plus de
       `STRUCTURE_CALC_WATER_MAX_MOVE` Å PAR ÉVALUATION DE FORCE, et les forces sont RELUES à
       chaque sous-pas : le mur de van der Waals a alors le temps de monter, et le rebond
       tombe où la conservation de l'énergie le met. ⚠ Le frottement, le couple et le bruit
       sont RÉPARTIS sur les sous-pas (chacun a sa propre paire fluctuation–dissipation), donc
       la température reste celle du palier. */
    let vmax = 0;
    for (let k = 0; k < n * 3; k += 1) vmax = Math.max(vmax, Math.abs(V[k]));
    const subSteps = Math.max(1, Math.min(Math.abs(Number(maxSub)) || 1,
      Math.ceil((vmax * h) / (Math.abs(Number(maxMove)) || STRUCTURE_CALC_WATER_MAX_MOVE))));
    const hs = h / subSteps;
    lastSub = subSteps;
    let appliedSteps = 0;
    for (let s = 0; s < subSteps; s += 1) {
      /* LES FORCES DU SOUS-PAS — un seul parcours de la marche : chaque extrémité qui
         appartient à une eau reçoit sa force et son couple autour de son centre de masse. Un
         couple eau–eau nourrit donc LES DEUX corps ; un couple eau–soluté ne pousse que l'eau
         (voir la note de tête : le soluté avance par ses charnières, pas par des
         translations). */
      F.fill(0); Tq.fill(0);
      for (const p of pairs) {
        const wi = waterOf[p.i]; const wj = waterOf[p.j];
        if (wi < 0 && wj < 0) continue;
        const dx = x[p.j * 3] - x[p.i * 3];
        const dy = x[p.j * 3 + 1] - x[p.i * 3 + 1];
        const dz = x[p.j * 3 + 2] - x[p.i * 3 + 2];
        const r2 = dx * dx + dy * dy + dz * dz;
        if (!(r2 > 0)) continue;
        const r = Math.sqrt(r2);
        if (r < closest) closest = r;
        const dV = ffNonbondedGradientOf(r, p, options);
        if (!dV) continue;
        const fx = (dV * dx) / r; const fy = (dV * dy) / r; const fz = (dV * dz) / r;
        if (wi >= 0) {
          F[wi * 3] += fx; F[wi * 3 + 1] += fy; F[wi * 3 + 2] += fz;
          const rx = x[p.i * 3] - R[wi * 3]; const ry = x[p.i * 3 + 1] - R[wi * 3 + 1]; const rz = x[p.i * 3 + 2] - R[wi * 3 + 2];
          Tq[wi * 3] += ry * fz - rz * fy;
          Tq[wi * 3 + 1] += rz * fx - rx * fz;
          Tq[wi * 3 + 2] += rx * fy - ry * fx;
        }
        if (wj >= 0) {
          F[wj * 3] -= fx; F[wj * 3 + 1] -= fy; F[wj * 3 + 2] -= fz;
          const rx = x[p.j * 3] - R[wj * 3]; const ry = x[p.j * 3 + 1] - R[wj * 3 + 1]; const rz = x[p.j * 3 + 2] - R[wj * 3 + 2];
          Tq[wj * 3] -= ry * fz - rz * fy;
          Tq[wj * 3 + 1] -= rz * fx - rx * fz;
          Tq[wj * 3 + 2] -= rx * fy - ry * fx;
        }
      }
      for (let w = 0; w < n; w += 1) {
        const M = mass[w];
        const vThermal = Math.sqrt(kT / M);                       // Å/ps
        const vSpeed = Math.min(vCeil, sf * vThermal);
        /* ⚠ LE PLAFOND DE FORCE — le même raisonnement que le couple d'un dièdre : ce qu'il
           faut pour RENVERSER la vitesse thermique EN UN SOUS-PAS (`M·v/h_s`). Sans lui, une
           eau qui touche le mur de van der Waals partirait à des milliers d'Å/ps. */
        const fCap = Math.min(fCeil, Math.max(gamma * M * vSpeed, (sf * M * vThermal) / hs));
        const sNoise = Math.sqrt((2 * gamma * kT * hs) / M);
        for (let c = 0; c < 3; c += 1) {
          const k = w * 3 + c;
          const f = Math.max(-fCap, Math.min(fCap, F[k]));
          let v = V[k] * (1 - gamma * hs) + (f / M) * hs;
          if (sNoise > 0) v += sNoise * noise();
          /* ⚠ LE PLAFOND ABSOLU, PAS LA VITESSE THERMIQUE — mesuré : couper à `vSpeed` (une
             vitesse thermique) tronque la gaussienne en son milieu et la température cinétique
             LUE tombe à 565 K pour 1500 demandés. Le plafond qui décide du pas est celui de la
             FORCE (`fCap`, ci-dessus) ; celui-ci n'est qu'un garde-fou de dernier recours. */
          if (Math.abs(v) > vCeil) v = Math.sign(v) * vCeil;
          V[k] = v;
          R[k] += v * hs;
        }
        /* LA ROTATION — LE MOMENT CINÉTIQUE RESTE DANS LE REPÈRE DU LABORATOIRE, où il n'y a
           AUCUN terme gyroscopique : pour un corps libre `L` est CONSTANT (`dL/dt = τ`, tout
           court) et c'est l'ORIENTATION qui porte la rotation. L'équation `−ω×L` n'apparaît
           que si on l'écrit DANS le corps, et elle y est RIGIDE (`|ω|·h ≈ 0.3` pour une eau
           chaude, soit 5 THz) : l'intégrer demande un solveur implicite, et son point fixe
           DIVERGE (mesuré : 40 itérations → `NaN`, l'explicite → +24 % d'énergie).
           Ici, la seule chose intégrée est `A`, par une rotation EXACTE (Rodrigues) : elle ne
           peut donc ni amplifier ni diverger, et sans couple `|L|` est conservé au chiffre
           près ; sa relève de ω au milieu du pas la rend d'ORDRE DEUX (la version d'ordre un
           dérivait de +24 % sur 2000 pas, celle-ci de +0.7 %).
           ⚠ LE BRUIT SE TIRE DANS LE CORPS (covariance `k_B·T·I_body`, Cholesky) PUIS SE
           TOURNE : sa covariance dans le laboratoire devient `k_B·T·I_lab`, exactement ce que
           le frottement `(1−γ·h_r)` équilibre pour que la loi de Boltzmann soit la
           distribution stationnaire — c'est ce qui rend la température LUE juste (mesuré :
           1463 K de rotation pour 1500 demandés, sans aucune force). */
        const omegaOf = (mat, Lv) => mat3Vec(mat, mat3Vec(Iinv[w], mat3ApplyT(mat, Lv)));
        const Ib = Math.max(1e-9, Ibar[w]);
        const tCap = Math.min(tCeil,
          Math.max(gamma * Ib * sf * Math.sqrt(kT / Ib), (sf * Math.sqrt(kT * Ib)) / hs));
        let Ac = A[w];
        /* ⚠ LA ROTATION EST SUBDIVISÉE À SON TOUR — le sous-pas des EAUX peut encore être
           trop long pour une toupie rapide (5 THz) : on le divise pour que chaque rotation
           reste sous `maxTurn` (le pas angulaire d'une eau). */
        const probe = omegaOf(Ac, [Lm[w * 3], Lm[w * 3 + 1], Lm[w * 3 + 2]]);
        const rSub = Math.max(1, Math.min(Math.abs(Number(maxSub)) || 1,
          Math.ceil((hs * Math.hypot(probe[0], probe[1], probe[2])) / turnCap)));
        const hr = hs / rSub;
        const sNoiseR = Math.sqrt(2 * gamma * kT * hr);
        for (let r = 0; r < rSub; r += 1) {
          const nb = mat3Vec(Ac, mat3Vec(C[w], [noise(), noise(), noise()]));
          for (let c = 0; c < 3; c += 1) {
            const kk = w * 3 + c;
            const tc = Math.max(-tCap, Math.min(tCap, Tq[kk]));
            Lm[kk] = Lm[kk] * (1 - gamma * hr) + tc * hr + sNoiseR * nb[c];
          }
          /* ω RELU AU MILIEU DE LA SOUS-ROTATION (`A_mid` = la rotation de h_r/2), puis la
             rotation EXACTE : elle ne peut ni amplifier ni diverger, quel que soit le pas. */
          const Lc = [Lm[w * 3], Lm[w * 3 + 1], Lm[w * 3 + 2]];
          let om = omegaOf(Ac, Lc);
          const halfM = mat3Mul(rotMat3([(om[0] * hr) / 2, (om[1] * hr) / 2, (om[2] * hr) / 2]), Ac);
          om = omegaOf(halfM, Lc);
          Ac = orthonormalize3(mat3Mul(rotMat3([om[0] * hr, om[1] * hr, om[2] * hr]), Ac));
        }
        A[w] = Ac;
        /* LES TROIS ATOMES SONT REPOSÉS — par la rotation EXACTE et autour du centre de masse
           qui vient d'avancer, jamais par une intégration de leurs coordonnées : la géométrie
           TIP3P est donc invariante par construction (mesuré : 5·10⁻¹⁵ Å d'écart sur une
           trajectoire entière). ⚠ Le repositionnement est DANS la boucle des sous-pas : c'est
           lui qui rend les forces du sous-pas suivant justes. */
        const off = body[w];
        for (let k = 0; k < 3; k += 1) {
          const q = mat3Vec(A[w], off[k]);
          const a = index[w][k];
          x[a * 3] = R[w * 3] + q[0];
          x[a * 3 + 1] = R[w * 3 + 1] + q[1];
          x[a * 3 + 2] = R[w * 3 + 2] + q[2];
        }
        appliedSteps += 1;
      }
    }
    return { ok: true, applied: appliedSteps, subSteps };
  };

  /** CE QUI A BOUGÉ, ET À QUELLE TEMPÉRATURE — translation et rotation sont mesurées
   *  SÉPARÉMENT (`⟨M·v²⟩/(3R)` et `⟨LᵀI⁻¹L⟩/(3R)`) : elles doivent tomber sur la
   *  température demandée. C'est le contrôle qui dit si le thermostat tient ce qu'il
   *  annonce, et il est RENDU au rapport au lieu d'être gardé pour soi. */
  const stats = () => {
    let moved = 0; let net = 0; let msd = 0; let v2 = 0; let r2 = 0; let turned = 0;
    for (let w = 0; w < n; w += 1) {
      const dx = R[w * 3] - home[w][0];
      const dy = R[w * 3 + 1] - home[w][1];
      const dz = R[w * 3 + 2] - home[w][2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > 0.0025) moved += 1;                       // ≥ 0.05 Å de déplacement NET
      net += Math.sqrt(d2); msd += d2;
      v2 += mass[w] * (V[w * 3] ** 2 + V[w * 3 + 1] ** 2 + V[w * 3 + 2] ** 2);
      const Lb = mat3ApplyT(A[w], [Lm[w * 3], Lm[w * 3 + 1], Lm[w * 3 + 2]]);
      const om = mat3Vec(Iinv[w], Lb);
      r2 += Lb[0] * om[0] + Lb[1] * om[1] + Lb[2] * om[2];
      const tr = A[w][0][0] + A[w][1][1] + A[w][2][2];
      turned += Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2)));
    }
    const scale = 3 * n * FF_KCAL_PER_AMU_A2_PS2 * FF_GAS_CONSTANT;
    return {
      molecules: n, atoms: n * 3, moved,
      net: Number((net / n).toFixed(4)), msd: Number((msd / n).toFixed(4)),
      turned: Number((turned / n).toFixed(4)),
      /* LE CONTACT LE PLUS COURT DE LA TRAJECTOIRE (Å) — `null` s'il n'y a jamais eu de
         couple d'eau relu (aucune paire dans la portée), sinon le minimum mesuré. Le rapport
         le dit tel quel : un chiffre sous le σ de l'eau (3.15 Å) est un fait, pas une
         décoration. */
      closest: Number.isFinite(closest) ? Number(closest.toFixed(3)) : null,
      /* COMBIEN DE FOIS LES FORCES ONT ÉTÉ RELUES PAR PAS — `subSteps` du dernier pas : c'est
         ce qui rend le coût du geste lisible (une eau rapide se subdivise). */
      subSteps: lastSub,
      kinetic: {
        translation: Number((v2 / scale).toFixed(4)),
        rotation: Number((r2 / scale).toFixed(4)),
      },
    };
  };

  return {
    ok: true, reason: 'ok', molecules: n, atoms: n * 3,
    positions: x, atomIndex: index, step, stats,
  };
};


/** LA MINIMISATION DIHÉDRALE (l'affinage final) — une descente en coordonnées : chaque
 *  dièdre est essayé de part et d'autre d'un pas qui se divise par deux dès qu'un
 *  balayage complet n'améliore plus rien. Elle part de la fin de la dynamique et
 *  termine sur un minimum local DU MÊME champ de forces. */
export const STRUCTURE_CALC_MIN_ROUNDS = 3;           // balayages complets avant réduction
export const STRUCTURE_CALC_MIN_STEP = 8;             // ° du pas initial
export const STRUCTURE_CALC_MIN_STEP_FLOOR = 0.5;     // ° du pas le plus fin
export const STRUCTURE_CALC_MIN_TRIES = 4;            // essais par canal et par balayage

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

/** LE CONDUCTEUR D'UN CALCUL QUI SE REGARDE — il consomme un GÉNÉRATEUR d'images
 *  jusqu'au bout et rend son résultat. C'est ce qui fait qu'un moteur écrit une fois
 *  (`annealFrames`, `structureAttemptFrames`, …) se conduit de deux façons : d'un trait
 *  ici (les appelants, les tests) ou image par image à l'écran (qui laisse peindre la
 *  page entre deux). `onFrame` reçoit CHAQUE image — c'est exactement ce qu'un
 *  `onStep` recevait avant, donc aucun appelant n'a changé de contrat. */
export const drainFrames = (frames, onFrame = null) => {
  let step = frames.next();
  while (!step.done) {
    if (typeof onFrame === 'function' && step.value) {
      try { onFrame(step.value); } catch { /* un rapport qui se plaint n'arrête pas le calcul */ }
    }
    step = frames.next();
  }
  return step.value;
};

/**
 * LA LISTE DES CONTRAINTES, NORMALISÉE — `{list, dropped, count}`.
 * `list` = `{i, j, target, weight, order}` dans l'ordre reçu (le numéro `order` est
 * celui que le rapport affiche : « 1 = 12–48 à 6.00 Å »), `dropped` = combien
 * d'entrées ont été écartées (mauvais indices, couple dégénéré, cible non finie ou
 * ≤ 0, doublon d'un couple déjà imposé, au-delà de STRUCTURE_CALC_MAX_RESTRAINTS).
 *
 * ⚖ `weight` = LE POIDS de la ligne, tel que la colonne du panneau 🧬 l'écrit : il
 * MULTIPLIE la raideur du puits plat (`k = FF_NOE_K × poids`, voir
 * `ffRestraintWeightOf`) et il est transporté jusqu'au moteur. Absent ou illisible il
 * vaut 1 — la ligne se comporte donc exactement comme avant cette colonne — et 0 est
 * une valeur LÉGALE : la ligne est encore mesurée et rapportée, elle ne pèse RIEN.
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
    list.push({ i, j, target, weight: ffRestraintWeightOf(r.weight), order: list.length + 1 });
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
 *
 * ⚖ Chaque entrée porte AUSSI son `weight` (le poids de la ligne, 1 par défaut) : la
 * mesure est GÉOMÉTRIQUE (rien ici ne dépend du poids) mais le rapport dit le poids de
 * chaque ligne, parce que c'est lui qui décide de ce qu'elle coûte — et une ligne de
 * poids 0 est bien une ligne que le champ ne pousse pas, ce que le panneau doit
 * pouvoir dire au lieu de faire croire à une contrainte oubliée.
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
      i: r.i, j: r.j, order: r.order, target: r.target, weight: r.weight,
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
 * 🪢 LA LIAISON PEPTIDIQUE N'EST PAS TIRÉE. Un canal dont la liaison est un ω
 * (`peptideOmegasOf` : un C qui porte un O lié à un N) n'est pas un canal comme les
 * autres : quand `freeOmega` est faux — le défaut — l'angle ne lui est plus TIRÉ, il
 * lui est POSÉ, à la valeur TRANS de cette liaison, et un ω reçu cis est RAMENÉ à
 * trans. C'est le seul endroit qui pouvait le faire, et voici pourquoi, depuis que le
 * terme ω du champ est MONOTONE (`ffOmegaCostOf` : nul dans le plateau de ± 30°,
 * k = 20 kcal/mol au cis, aucun second minimum) : le champ TIRE donc un ω tiré de
 * travers vers trans, mais c'est une PRÉFÉRENCE jugée avec le reste du champ — rien ne
 * garantit qu'elle l'emporte sur une distance demandée, et MESURÉ, un départ cis n'en
 * revient qu'à 92° d'écart après six balayages (77° après 3000 pas de dynamique). Le
 * tirage ne laisse donc plus un départ NAÎTRE hors du plateau : il naît trans, et y
 * reste — le plateau est un CLIQUET, son coût y est nul et la protection refuse tout
 * pas qui le monterait. Le rapport le dit canal par canal (`locked`, `omegaTarget`,
 * `omegaBefore`, `omegaAfter`), et `omegaLocked` en donne le compte. La case cochée
 * (`freeOmega` vrai) rend ω au tirage comme les autres charnières.
 *
 * `rng` permet d'injecter un tirage ; sans lui, `makeRelaxRandom(graine)` — le
 * générateur du ⚒, il n'y en a pas d'autre dans le dossier. Le générateur est appelé
 * pour TOUS les canaux, verrouillés compris : la suite qu'il rend ne dépend donc pas du
 * verrou, et un tirage garde ses autres dièdres au chiffre près.
 */
export const randomTorsionsOf = ({
  positions = null, elements = [], bonds = [], atomCount = 0,
  seed = STRUCTURE_CALC_SEED, rng = null, channels = null,
  omegas = null, freeOmega = STRUCTURE_CALC_FREE_OMEGA,
} = {}) => {
  const read = flatPositions(positions);
  if (!read) {
    return {
      ok: false, reason: 'bad-points', positions: null, channels: [], channelCount: 0,
      counts: null, turned: [], skipped: [], drawn: 0, omegaLocked: 0, omegaFree: !!freeOmega,
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
  /* 🪢 LES CANAUX ω, RETROUVÉS PAR LEUR LIAISON — un canal est un couple d'atomes (i, j),
     un ω aussi : la clé les apparie. Sans `omegas` fourni, on les relit du graphe comme
     partout ailleurs, sur le MÊME `atomCount` que les charnières (sinon le verrou
     ignorerait un ω que le tirage, lui, tourne). */
  const omegaKeyOf = (i, j) => (i < j ? `${i}-${j}` : `${j}-${i}`);
  const omegaByBond = new Map();
  if (!freeOmega) {
    const bound = asked > 0 ? Math.min(asked, count) : count;
    const listOmega = omegas
      ? Array.from(omegas)
      : peptideOmegasOf({ elements, bonds, atomCount: bound });
    for (const o of listOmega) omegaByBond.set(omegaKeyOf(o.i, o.j), o);
  }
  const x = read.flat.slice();
  const pt = (i) => [x[i * 3], x[i * 3 + 1], x[i * 3 + 2]];
  const turned = [];
  const skipped = [];
  let locked = 0;
  for (const ch of chan) {
    /* ARRONDI AU MILLIÈME DE DEGRÉ — un rapport se lit, et rien d'autre ne change :
       le même tirage donne le même nombre pour tout le monde. Le tirage est demandé même
       quand le canal est VERROUILLÉ : l'angle est jeté, mais le générateur a bien avancé
       d'un cran, donc la suite reste celle qu'elle aurait été sans le verrou. */
    const angle = Number((draw() * 360 - 180).toFixed(3));
    const omega = omegaByBond.get(omegaKeyOf(ch.i, ch.j)) || null;
    /* LE QUADRUPLET ET L'ANGLE DEMANDÉS — un canal ordinaire demande au tirage son propre
       dièdre ; un canal ω demande SA liaison peptidique, à la valeur TRANS. */
    const follows = omega ? ch.moving.indexOf(omega.probeAtoms[3]) >= 0 : false;
    const points = !omega
      ? ch.probeAtoms
      : (follows
        ? omega.probeAtoms
        : [omega.probeAtoms[3], omega.probeAtoms[2], omega.probeAtoms[1], omega.probeAtoms[0]]);
    const request = !omega
      ? { angleDeg: angle }
      : { angleDeg: follows ? omega.target : wrapDeg(-omega.target) };
    const [A, B, C, D] = ch.probeAtoms;
    const before = omega ? dihedralDeg(pt(A), pt(B), pt(C), pt(D)) : null;
    const plan = planTorsion({
      points: points.map(pt),
      moved: ch.moving.map(pt),
      request,
    });
    if (!plan.ok) { skipped.push({ i: ch.i, j: ch.j, why: plan.reason }); continue; }
    ch.moving.forEach((k, c) => {
      const p = plan.positions[c];
      x[k * 3] = p[0]; x[k * 3 + 1] = p[1]; x[k * 3 + 2] = p[2];
    });
    if (!omega) {
      turned.push({
        i: ch.i, j: ch.j, axis: ch.axis, atoms: ch.movingCount,
        drawn: angle, before: plan.beforeDeg, after: plan.afterDeg,
        turned: Number(plan.deltaDeg.toFixed(3)),
      });
      continue;
    }
    /* LE CANAL VERROUILLÉ, RACONTÉ — ce que la liaison peptidique vaut MAINTENANT, relu
       par le MÊME lecteur que le rapport ω (`dihedralDeg` sur les coordonnées écrites),
       ce qu'elle valait, et ce que le canal porte. Le quadruplet retourné (le côté mobile
       porte le CA de l'amide) lit l'ω changé de signe : `omegaVal` le remet dans la
       convention de l'amide, pour que le rapport dise un ω et pas son reflet. */
    locked += 1;
    const omegaVal = (deg) => (deg == null ? null : wrapDeg(follows ? deg : -deg));
    const after = dihedralDeg(pt(A), pt(B), pt(C), pt(D));
    turned.push({
      i: ch.i, j: ch.j, axis: ch.axis, atoms: ch.movingCount,
      drawn: after == null ? null : Number(after.toFixed(3)),
      before, after,
      turned: before == null || after == null ? null : Number(wrapDeg(after - before).toFixed(3)),
      locked: true, omegaTarget: omega.target, omegaFollows: follows,
      omegaBefore: omegaVal(plan.beforeDeg), omegaAfter: omegaVal(plan.afterDeg),
      omegaTurned: omegaVal(plan.deltaDeg),
    });
  }
  return {
    ok: true, reason: 'ok', positions: x, channels: chan,
    channelCount: list.count == null ? chan.length : list.count,
    counts: {
      ring: list.ring || 0, multiple: list.multiple || 0,
      terminal: list.terminal || 0, unknown: list.unknown || 0,
    },
    turned, skipped, drawn: turned.length, omegaLocked: locked, omegaFree: !!freeOmega,
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
    /* ⚠ LES DEUX CARBONES SONT CHOISIS, PAS PRIS AU HASARD — une PROLINE porte son CD
       sur le même azote que son CA, et un ω mesuré sur CD n'est plus l'angle de la
       liaison peptidique (le cycle l'en décale d'une constante). Le CA est donc :
       du côté du carbonyle, LE CARBONE QUI PORTE L'AZOTE DE SON RÉSIDU (son propre N,
       distinct de l'amide de la liaison) ; du côté de l'amide, LE CARBONE QUI PORTE UN
       CARBONYLE (le résidu suivant). Faute de mieux, le premier carbone — c'était la
       règle d'avant, et elle n'est pas perdue. */
    const carries = (k, want) => graph.neighbours(k).some((m) => m !== c && m !== n && want(m));
    const isCarbonyl = (k) => els[k] === 'C' && graph.neighbours(k).some((m) => els[m] === 'O');
    const carbonsOf = (list) => list.filter((k) => els[k] === 'C');
    const caC = carbonsOf(nbC).find((k) => carries(k, (m) => els[m] === 'N'))
      ?? carbonsOf(nbC)[0];
    const caN = carbonsOf(nbN).find((k) => carries(k, isCarbonyl))
      ?? carbonsOf(nbN)[0];
    if (!Number.isInteger(caC) || !Number.isInteger(caN)) continue;
    out.push({ i: c, j: n, c, n, probeAtoms: [caC, c, n, caN], target: STRUCTURE_CALC_OMEGA });
  }
  return out;
};

/** CE QUE LE TERME ω COÛTE SUR CES COORDONNÉES — `{count, penalty, violations, worst,
 *  list}`, EN kcal/mol. Le plateau fait le travail : un ω à ± 30° de 180° ne coûte RIEN
 *  (c'est le désordre d'une vraie chaîne), au-delà il paie la barrière du champ
 *  (`ffOmegaCostOf`, k = 20 kcal/mol). */
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
    const cost = ffOmegaCostOf(deg, { target: o.target });
    penalty += cost;
    if (over > 0) violations += 1;
    const row = { i: o.i, j: o.j, deg, target: o.target, dev, over, cost };
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
 *  charnière, le cœur dur, ω, les bassins φ/ψ et χ1 peuvent changer. C'est pour cela
 *  qu'un recuit en espace dihédral est abordable : un pas ne relit qu'une poignée de
 *  termes.
 *
 *  Un pas est accepté s'il n'empire pas, ou avec la probabilité exp(−Δ/T) — la loi de
 *  Metropolis — T étant le palier courant (chaud d'abord : les conformations
 *  s'échangent ; froid à la fin : la dernière est un minimum local). Le tirage vient
 *  d'un `makeRelaxRandom(graine)` : mêmes paliers, mêmes pas, même résultat.
 *
 *  ⚠ C'EST UN GÉNÉRATEUR (`annealFrames`) : il rend la main à chaque image — le
 *  palier, et `perFrame` pas à l'intérieur d'un palier — ce qui permet à l'écran de
 *  peindre la molécule EN TRAIN de recuire. `annealTorsionsOf` est le même recuit
 *  conduit jusqu'au bout d'un trait (voir `drainFrames`).
 *
 *  Rend `{ok, reason, positions, channels, omegas, rama, chi, schedule, tried,
 *  accepted, skipped, cost:{before, after}, omega}` : `schedule` porte une ligne par
 *  palier (`{step, temperature, tried, accepted, cost, of}`) — un recuit se LIT.
 */
export function* annealFrames({
  positions = null, elements = [], bonds = [], restraints = [],
  channels = null, omegas = null, leash = null, dihedrals = [],
  seed = STRUCTURE_CALC_SEED, rng = null,
  steps = STRUCTURE_CALC_ANNEAL_STEPS,
  hot = STRUCTURE_CALC_ANNEAL_HOT, cold = STRUCTURE_CALC_ANNEAL_COLD,
  moves = STRUCTURE_CALC_ANNEAL_MOVES,
  amplitude = STRUCTURE_CALC_ANNEAL_AMPLITUDE,
  omegaAmplitude = STRUCTURE_CALC_ANNEAL_OMEGA_AMPLITUDE,
  refresh = STRUCTURE_CALC_CORE_REFRESH,
  protectOmega = false,
  /* 🪢 ω VARIE — l'option de l'utilisateur : voir `STRUCTURE_CALC_FREE_OMEGA`. Avec elle,
     `protectOmega` ne refuse plus rien : la barrière d'ω reste comptée dans le champ, donc
     c'est le champ qui décide. */
  freeOmega = STRUCTURE_CALC_FREE_OMEGA,
  torsions = null,
  ramaWeight = STRUCTURE_CALC_RAMA_WEIGHT, chiWeight = STRUCTURE_CALC_CHI_WEIGHT,
  perFrame = 0, hydrogen = null,
  /* 🧪 LE pH ET LA FORCE IONIQUE — les deux réglages de la CHIMIE du champ (voir §2bis et §4bis
     de utils/forceFieldKcal.js) : ils descendent tels quels dans le moteur commun
     (`torsionEngineOf`), donc le recuit ne peut pas conduire un autre monde que celui affiché. */
  ph = FF_PH_DEFAULT, ionicStrength = FF_IONIC_STRENGTH_DEFAULT,
  /* 🎯 LA FONCTION CIBLE — la même clé pour les quatre moteurs du protocole (voir
     `STRUCTURE_CALC_TARGET_FUNCTIONS`) : le recuit ne peut donc pas conduire un autre
     champ que celui qu'affiche le panneau. */
  targetFunction = STRUCTURE_CALC_TARGET_FUNCTION,
} = {}) {
  /* ⚠ LE RECUIT TOURNE SUR LE MOTEUR DU CHAMP (`torsionEngineOf`) — il ne réimplémente
     AUCUNE physique : ses pas sont des rotations rigides (`engine.mapFor`), son énergie
     est celle du champ (kcal/mol), sa longe est celle du moteur. Un pas est accepté par
     la loi de METROPOLIS, `exp(−ΔE/(R·T))`, avec ΔE en kcal/mol et T en KELVINS — donc
     R·T, l'énergie thermique (0.60 kcal/mol à 300 K, 3 kcal/mol à 1500 K). */
  const engine = torsionEngineOf({
    positions, elements, bonds, restraints, channels, leash, torsions, omegas, dihedrals,
    ramaWeight, chiWeight, hydrogen, targetFunction, ph, ionicStrength,
  });
  if (!engine) {
    return {
      ok: false, reason: 'bad-points', positions: null, channels: 0, omegas: 0,
      omegaFree: !!freeOmega,
      schedule: [], tried: 0, accepted: 0, skipped: 0,
      cost: { before: 0, after: 0 }, omega: null, rama: null, chi: null,
    };
  }
  const chan = engine.chan;
  const x = engine.x;
  const out = {
    ok: true, reason: 'ok', positions: engine.heavyPositions(), channels: chan.length,
    omegas: engine.omega.length,
    omegaFree: !!freeOmega,
    /* 🎯 LA FONCTION CIBLE CONDUITE — chaque moteur du protocole la DIT dans son rapport. */
    targetFunction: engine.targetFunction, switchedOff: engine.switchedOff,
    unitedAtoms: engine.unitedAtoms,
    schedule: [], tried: 0, accepted: 0, skipped: 0, cost: { before: 0, after: 0 },
    omega: null, rama: null, chi: null,
  };
  const nStep = clampInt(steps, 0, 64, STRUCTURE_CALC_ANNEAL_STEPS);
  if (!chan.length || !nStep) { out.reason = chan.length ? 'no-step' : 'no-channel'; return out; }
  const random = typeof rng === 'function' ? rng : makeRelaxRandom(wrapSeed(seed));
  /* QUEL CANAL EST UNE LIAISON PEPTIDIQUE — ω a son propre pas (12°, pas 180°) : ce
     n'est pas un dièdre ordinaire, il ne doit pas sauter d'un conformère à l'autre. */
  const omegaBond = new Set(engine.omega.map((o) => (o.c < o.n ? `${o.c}-${o.n}` : `${o.n}-${o.c}`)));
  const isPeptide = (ch) => omegaBond.has(ch.i < ch.j ? `${ch.i}-${ch.j}` : `${ch.j}-${ch.i}`);

  const amp = Math.max(1, Math.abs(Number(amplitude) || STRUCTURE_CALC_ANNEAL_AMPLITUDE));
  const ampO = Math.max(0.5, Math.abs(Number(omegaAmplitude) || STRUCTURE_CALC_ANNEAL_OMEGA_AMPLITUDE));
  const perStep = Math.max(1, clampInt(moves, 1, 512, STRUCTURE_CALC_ANNEAL_MOVES)) * chan.length;
  const rebuild = Math.max(1, Math.round(refresh) || STRUCTURE_CALC_CORE_REFRESH);
  /* COMBIEN D'IMAGES PAR PALIER — `perFrame` veut dire « N images par palier » : N − 1 en
     cours de palier PLUS celle de la fin ; 0 (le défaut) veut dire « une seule, à la fin
     du palier » (le comportement d'avant). Le pas d'image est déduit du nombre de gestes
     d'un palier (`moves × canaux`), jamais inventé. ⚠ UNE IMAGE EST DUE À UN INDICE, PAS À
     UN INDICE *GARDÉ* : la condition `m % frameEvery === frameEvery - 1` se lisait dans la
     branche des pas acceptés, donc une échéance tombant sur un pas REFUSÉ ne montrait rien
     — mesuré : 1 image en cours de palier au lieu des 3 demandées (40 pas gardés sur 84 à
     1500 K). Le panneau promettait N images par palier et en donnait la moitié. */
  const framesPerPalier = clampInt(perFrame, 0, Math.max(1, perStep), 0) || 1;
  const frameEvery = Math.max(1, Math.floor(perStep / framesPerPalier));
  let cost = engine.costOf();
  out.cost.before = cost;

  for (let s = 0; s < nStep; s += 1) {
    const frac = nStep === 1 ? 1 : s / (nStep - 1);
    const T = Math.max(0, hot + (cold - hot) * frac);      // KELVINS
    const kT = FF_GAS_CONSTANT * T;                        // kcal/mol
    let tried = 0; let accepted = 0;
    /* L'ÉCHÉANCE DE L'IMAGE DE CE PALIER (voir la règle du nombre d'images ci-dessus). */
    let frameDue = frameEvery;
    for (let m = 0; m < perStep; m += 1) {
      if (m > 0 && m % rebuild === 0) engine.refreshCore();
      const pick = Math.min(chan.length - 1, Math.floor(random() * chan.length));
      const ch = chan[pick];
      const cur = engine.dihedralOf(ch.probeAtoms, null);
      if (!Number.isFinite(cur)) { out.skipped += 1; continue; }
      const delta = (random() * 2 - 1) * (isPeptide(ch) ? ampO : amp);
      const move = engine.mapFor(ch, ((cur + delta + 540) % 360) - 180);
      tried += 1;
      if (!move.ok) { out.skipped += 1; continue; }
      /* ⚠ LE CTX PORTE AUSSI LES COUPLES QUE CE PAS **CRÉE** (`move.map`) — les murs de la
         longe, le coût d'ω et le coût du pas sont donc jugés sur la géométrie d'ESSAI, pas
         sur la marche d'il y a vingt-quatre gestes. Sans cela le recuit ACCEPTE l'empilement
         qu'il vient de poser : le couple neuf n'est pas dans le `dv`, qui reste ≤ 0. */
      const ctx = engine.ctxOf(ch, move.map);
      /* LA LONGE D'ABORD — un pas qui ferait sortir de son puits plat une distance DÉJÀ
         respectée n'est même pas évalué (c'est ce qui permet à une trempe de réparer ω
         SANS lâcher ce qui est tenu). */
      let leashed = false;
      for (const w of ctx.walls) {
        if (Math.abs(engine.gap(w.i, w.j, null) - w.target) > w.tolerance) continue;
        if (Math.abs(engine.gap(w.i, w.j, move.map) - w.target) > w.tolerance) { leashed = true; break; }
      }
      if (leashed) { out.skipped += 1; continue; }
      /* ω NE SE DÉGRADE JAMAIS (la trempe) — un pas qui abîmerait ω est refusé même
         s'il répare un empilement : il y a assez d'autres pas pour faire les deux.
         🪢 …SAUF si l'utilisateur a demandé que ω VARIE (`freeOmega`) : la règle tombe, et
         c'est le champ qui arbitre — la barrière d'ω est dans le coût du pas, donc un ω ne
         s'écarte de trans que si ce pas-là y gagne ailleurs. */
      if (protectOmega && !freeOmega
        && engine.omegaCrossCost(ctx, move.map) - engine.omegaCrossCost(ctx, null) > 1e-12) {
        out.skipped += 1; continue;
      }
      const dv = engine.crossCost(ctx, move.map) - engine.crossCost(ctx, null);
      const kept = dv <= 0 || (kT > 0 && random() < Math.exp(-dv / kT));
      if (kept) {
        engine.commit(move.map);
        cost += dv;
        accepted += 1;
      } else {
        out.skipped += 1;
      }
      /* L'IMAGE DU PAS — le pas gardé est montré tel quel : c'est ce que l'écran écrit,
         donc ce qu'on regarde est la conformation qui existe vraiment, pas une
         interpolation entre deux états. Un pas REFUSÉ n'a rien changé, donc l'image est
         celle du moment — la même que la précédente, ce qui est la vérité du recuit. */
      if (frameDue < perStep && m + 1 >= frameDue) {
        /* LES ÉCHÉANCES DÉPASSÉES SONT SAUTÉES — deux images identiques ne montreraient
           rien de plus que la première. */
        do { frameDue += frameEvery; } while (frameDue < perStep && m + 1 >= frameDue);
        yield {
          phase: 'anneal', positions: engine.heavyPositions(), step: s + 1, of: nStep,
          part: m + 1, parts: perStep,
          temperature: Number(T.toFixed(6)), tried: 0, accepted: 0, cost: Number(cost.toFixed(6)),
        };
      }
    }
    out.tried += tried;
    out.accepted += accepted;
    const row = {
      step: s + 1, temperature: Number(T.toFixed(6)), tried, accepted,
      cost: Number(cost.toFixed(6)), of: nStep,
    };
    out.schedule.push(row);
    yield { phase: 'anneal', positions: engine.heavyPositions(), ...row, part: perStep, parts: perStep };
  }
  /* ⚠ LA LISTE DES COUPLES EST REFaite AVANT LE COÛT D'ARRIVÉE — un rapport comparable
     à celui de l'étape suivante doit être relu sur une liste FRAÎCHE : la liste est fixe
     pendant une trajectoire (c'est ce qui la rend abordable), donc le dernier chiffre
     serait sinon calculé sur des couples périmés et deux étapes qui se suivent ne
     tomberaient pas d'accord au chiffre près. */
  engine.refreshCore();
  out.cost.after = engine.costOf();
  out.omega = omegaPenaltyOf({ positions: x, omegas: engine.omega });  out.rama = ramaPenaltyOf({ positions: x, torsions: engine.backbone, weight: engine.wRama });
  out.chi = chiPenaltyOf({ positions: x, chis: engine.chis, weight: engine.wChi });
  out.molecule = engine.moleculeOf();
  /* 🧪 CE QUE LA CHIMIE A LU — le recuit le DIT comme les autres moteurs (`chemistry`). */
  out.chemistry = engine.chemistry;
  return out;
}

/** LE RECUIT, D'UN TRAIT — le même générateur, conduit jusqu'au bout (les appelants
 *  qui veulent le résultat, et les tests). `onStep` reçoit chaque image. */
export const annealTorsionsOf = (spec = {}) => drainFrames(annealFrames(spec), spec.onStep);

/* ── 3bis · LE SQUELETTE ET LES CHAÎNES LATÉRALES — φ, ψ, ω, χ1 PAR LA CHIMIE ───
   « the final structures have very bad Ramachandran plots » : les distances seules ne
   distinguent pas une hélice d'un enchaînement au hasard. Ce bloc lit les dièdres du
   squelette SANS AUCUN NOM D'ATOME — un carbonyle sur une amide (la règle de
   `peptideOmegasOf`, la même) suffit à reconnaître une liaison peptidique, et tout le
   reste se déduit du graphe : le CA est le carbone du carbonyle qui porte l'azote de
   son résidu, ψ est le dièdre N–CA–C–N(suivant), φ le dièdre C(précédent)–N–CA–C, χ1
   le dièdre N–CA–CB–X du côté le plus lourd. Ce qui n'est pas lisible n'est pas
   inventé : un résidu de bout de chaîne n'a que son ψ, et il est COMPTÉ (`partial`). */

const DEG2RAD = Math.PI / 180;

/** LE SQUELETTE D'UNE MOLÉCULE — `{count, residues, partial, phi, psi, omega, chi,
 *  classes, checked}`.
 *  `phi` / `psi` / `chi` / `omega` sont des listes de `{atoms:[a,b,c,d], ca, kind,
 *  klass}` : le quadruplet à lire (dans l'ordre IUPAC, donc par `dihedralDeg`), le CA
 *  du résidu (la CLEF qui apparie un φ et un ψ du MÊME résidu), et la classe de
 *  résidu que la chimie seule permet de voir — `gly` (aucun CB), `pro` (l'azote de son
 *  résidu porte deux carbones en plus du carbonyle précédent, donc il est dans un
 *  cycle), `prePro` (le résidu SUIVANT est une proline : son amide porte aussi son
 *  CD), `general`. Ce sont les mêmes classes de bassins que le graphe 🪢 distingue.
 *  `classes` compte les résidus par classe, `residues` le nombre de résidus vus,
 *  `partial` ceux qui n'ont qu'un des deux angles (un bout de chaîne). */
export const backboneTorsionsOf = ({ elements = [], bonds = [], atomCount = 0 } = {}) => {
  const els = Array.from(elements || []).map((e) => String(e == null ? '' : e).trim().toUpperCase());
  const count = clampInt(atomCount || els.length, 0, Number.MAX_SAFE_INTEGER, 0);
  const graph = bondGraphOf({ bonds, atomCount: count });
  const out = {
    count: 0, residues: 0, partial: 0,
    phi: [], psi: [], omega: [], chi: [],
    classes: { general: 0, gly: 0, pro: 0, prePro: 0 },
    checked: graph.list.length,
  };
  const nb = (a) => graph.neighbours(a).map(Number)
    .filter((k) => Number.isInteger(k) && k >= 0 && k < count).sort((p, q) => p - q);
  const el = (k) => els[k] || '';
  const carbonsOf = (a, except = -1) => nb(a).filter((k) => k !== except && el(k) === 'C');
  const isCarbonylCarbon = (k) => el(k) === 'C' && nb(k).some((m) => el(m) === 'O');
  /* LA LISTE DES RÉSIDUS — par leur CA, jamais deux fois : un résidu est vu par la
     liaison peptidique qui le suit ET par celle qui le précède, et c'est le CA qui dit
     que c'est le même. Le carbonyle du résidu vient de la même lecture. */
  const residues = new Map();
  for (const s of peptideOmegasOf({ elements: els, bonds, atomCount: count })) {
    const [caC, c, n, caN] = s.probeAtoms || [];
    if (!residues.has(caC)) residues.set(caC, { ca: caC, c });
    const cNext = carbonsOf(caN, n).find((k) => isCarbonylCarbon(k));
    if (Number.isInteger(cNext) && !residues.has(caN)) residues.set(caN, { ca: caN, c: cNext });
    /* ⚠ `probeAtoms` EN PLUS DE `atoms` POUR LES ω — c'est la clef que `omegaPenaltyOf`
       lit, donc la liste rendue ici peut se donner telle quelle au terme ω (le panneau
       se sert du même jeu pour le rapport et pour le calcul). */
    out.omega.push({
      atoms: [caC, c, n, caN], probeAtoms: [caC, c, n, caN],
      ca: caC, kind: 'omega', klass: 'general', target: STRUCTURE_CALC_OMEGA,
    });
  }
  /* LE PLUS LOURD DES VOISINS — c'est lui qui définit χ1 : pour une cystéine le soufre,
     pour une sérine ou une thréonine l'oxygène, sinon le carbone (V, I, L, K…). */
  const HEAVY_RANK = { S: 4, O: 3, N: 2, C: 1 };
  const heaviestOf = (list) => list
    .slice().sort((a, b) => ((HEAVY_RANK[el(b)] || 0) - (HEAVY_RANK[el(a)] || 0)) || (a - b))[0];
  for (const { ca, c } of residues.values()) {
    const nI = nb(ca).find((k) => el(k) === 'N');
    const cPrev = Number.isInteger(nI) ? carbonsOf(nI, ca).find((k) => isCarbonylCarbon(k)) : undefined;
    const nNext = nb(c).find((k) => el(k) === 'N' && k !== nI);
    const gly = carbonsOf(ca, c).length === 0;                    // aucun CB : une glycine
    const pro = Number.isInteger(nI) && carbonsOf(nI, cPrev).length >= 2;   // N dans un cycle
    const nextPro = Number.isInteger(nNext) && carbonsOf(nNext, c).length >= 2;
    const klass = gly ? 'gly' : (pro ? 'pro' : (nextPro ? 'prePro' : 'general'));
    out.classes[klass] = (out.classes[klass] || 0) + 1;
    out.residues += 1;
    const hasPhi = Number.isInteger(cPrev) && Number.isInteger(nI);
    const hasPsi = Number.isInteger(nI) && Number.isInteger(nNext);
    if (hasPhi) out.phi.push({ atoms: [cPrev, nI, ca, c], ca, kind: 'phi', klass });
    if (hasPsi) out.psi.push({ atoms: [nI, ca, c, nNext], ca, kind: 'psi', klass });
    if (!hasPhi || !hasPsi) out.partial += 1;
    const cb = carbonsOf(ca, c)[0];
    if (Number.isInteger(cb) && Number.isInteger(nI)) {
      const x = heaviestOf(nb(cb).filter((k) => k !== ca));
      if (Number.isInteger(x)) out.chi.push({ atoms: [nI, ca, cb, x], ca, kind: 'chi1', klass });
    }
  }
  out.count = out.phi.length + out.psi.length + out.omega.length + out.chi.length;
  return out;
};

/* LA MESURE φ/ψ ELLE-MÊME EST CELLE DU MODULE DU GRAPHE 🪢 — `ramaGapOf` a été écrite
   une fois, dans `utils/ramachandran.js` (son vrai propriétaire : c'est une mesure sur
   ses polygones), et elle est RÉEXPORTÉE ici : le calcul de structure, son recuit, sa
   dynamique et ses tests lisent tous la même fonction, et le champ de forces en
   kcal/mol (`utils/forceFieldKcal.js`) aussi. */

/** LES RÉSIDUS À (φ, ψ) — les deux angles du MÊME résidu, appariés par leur CA : le
 *  potentiel de Ramachandran porte sur le COUPLE, jamais sur un angle seul (un bassin
 *  est une tache dans le plan φ×ψ). Un résidu de bout de chaîne n'a qu'un angle : il
 *  est compté `partial` et ne porte aucun terme. */
const ramaPairsOf = (torsions) => {
  const t = torsions || {};
  const byCa = new Map();
  const add = (entry, slot) => {
    if (!entry || !entry.atoms || !Number.isInteger(entry.ca)) return;
    const row = byCa.get(entry.ca) || { ca: entry.ca, klass: entry.klass || 'general' };
    row[slot] = entry.atoms;
    byCa.set(entry.ca, row);
  };
  for (const e of Array.from(t.phi || [])) add(e, 'phiAtoms');
  for (const e of Array.from(t.psi || [])) add(e, 'psiAtoms');
  return [...byCa.values()];
};

/** ⛓ LA STRUCTURE SECONDAIRE IMPOSÉE → DES CONTRAINTES DE DIHÈDRE (φ et ψ).

 *  LA DEMANDE, mot pour mot : « In MD and “structure calculation” allow the
 *  conversion of the secondary structure imposed in the “sequence and structure”
 *  subsection into dihedral angle constraints. »
 *
 *  Ce que la sous-section « Sequence and structure » impose, c'est UNE LETTRE PAR
 *  RÉSIDU (la peinture 🖌️ : H hélice α, E feuillet β, C/S pelote). Chaque lettre a,
 *  en chimie des protéines, un couple de dièdres de squelette qui la caractérise —
 *  ce sont les deux bassins du graphe 🪢, à leur centre :
 *
 *    H (α)  φ −57°   ψ −47°      (Pauling–Corey : l'hélice α droite)
 *    L (α)  φ +57°   ψ +47°      (l'hélice α GAUCHE : le miroir exact de H)
 *    E (β)  φ −139°  ψ +135°     (le feuillet β parallèle/antiparallèle)
 *    C · S  aucune contrainte    (une pelote n'impose rien : c'est le silence)
 *
 *  et la contrainte est un PUITS PLAT de ± 30° autour de cette cible
 *  (`FF_DIHEDRAL_TOLERANCE`, le même chiffre que le champ et que la ligne du panneau) :
 *  une hélice imposée autorise donc φ entre −87° et −27°, ce qui laisse au calcul la
 *  liberté de tourner autour de l'idéal sans pouvoir en sortir.
 *
 *  ⚠ CE MODULE NE CONNAÎT PAS LA SÉQUENCE DE LA PAGE : il reçoit la chaîne de lettres
 *  et la lecture du squelette de LA MOLÉCULE À L'ÉCRAN (`backboneTorsionsOf`), et il
 *  apparie les deux PAR ORDRE — la k-ième lettre pour le k-ième résidu lu, comme la
 *  page écrit son modèle (proteinSequenceToPdbText peint la même chaîne dans le même
 *  ordre). Le rapport du panneau DIT ce que l'appariement a donné (combien de résidus,
 *  combien de contraintes), et rien n'est inventé quand les deux listes n'ont pas la
 *  même longueur : les lettres en trop sont comptées, pas devinées.
 */
export const SS_DIHEDRALS = {
  H: { phi: -57, psi: -47 },
  /* ⚠ L'HÉLICE α GAUCHE — la lettre L de la peinture (🖌️). C'est le MIROIR exact de H :
     φ/ψ positifs. Elle existe parce que la demande le dit (« il bottone alfa elica impone
     una struttura elicacea left-handed. aggiungi anche la right-handed. ») : les deux mains
     se peignent donc, et la conversion porte la bonne cible sur chacune. */
  L: { phi: 57, psi: 47 },
  E: { phi: -139, psi: 135 },
  /* ⚠ LE TOUR — la lettre T de la peinture. C'est la conformation du TOUR γ de la
     littérature (Rose–Matthews, φ +75° / ψ −65°) : la seule conformation de tour
     qu'UN résidu puisse imposer, et celle dont le modèle bâti fait vraiment le pont
     C7 (O(i)···N(i+2) = 2,72 Å mesuré, contre 3,77 Å pour une pelote). Le couple est
     le MÊME que SS_TORSIONS.T de NMRSections.jsx : un tour peint se construit à 0° de
     la cible que cette conversion lui impose (la règle déjà tenue pour E). */
  T: { phi: 75, psi: -65 },
};
/** Les lettres de la peinture qui IMPOSENT quelque chose (les autres sont le silence). */
export const SS_DIHEDRAL_LETTERS = Object.keys(SS_DIHEDRALS);
/* Le même chiffre que le champ de forces : une seule définition de la fenêtre — et du
   fond du puits (`FF_DIHEDRAL_CENTRE_K` : la fenêtre seule n'a pas de minimum, donc
   la cible s'y rappelle par un centre). */
export {
  FF_DIHEDRAL_TOLERANCE as SS_DIHEDRAL_TOLERANCE, FF_DIHEDRAL_K as SS_DIHEDRAL_K,
  FF_DIHEDRAL_CENTRE_K as SS_DIHEDRAL_CENTRE_K,
  /* 🧪 …ET LES DEUX RÉGLAGES DE LA CHIMIE, réexportés — le panneau, ses tests et les gestes
     n'importent qu'un module (`structureCalc.js`) pour lire ce que le champ a lu, comme ils le
     font déjà du champ de forces entier. */
  ffDebyeKappaOf, ffDebyeLengthOf, ffIonisationReportOf,
  FF_PKA, FF_PKA_ACIDS, FF_PH_DEFAULT, FF_IONIC_STRENGTH_DEFAULT,
  FF_DEBYE_FACTOR,
  /* 🧪 LA CHARGE ELLE-MÊME, réexportée pour le panneau — la note à côté de ses deux cases lit
     la molécule à l'écran sans payer le champ entier. */
  partialChargesOf,
};

/** LA CONVERSION — `{ ok, reason, constraints, letters, residues, unmatched, matched }`.
 *  `constraints` est prêt à être donné au champ (`dihedrals`), au recuit, à la
 *  dynamique, à la minimisation et au calcul de structure : `{kind, letter, ca, atoms,
 *  target, tolerance, centreK}`. Une lettre sans cible (C, S, un tiret, une lettre
 *  inconnue) ne produit RIEN — c'est ce qui fait d'un feuillet peint au milieu d'une
 *  hélice deux contraintes qui ne se contredisent pas.
 *
 *  ⚠ `centreK` N'EST PAS UNE DÉCORATION : c'est le fond du puits (`FF_DIHEDRAL_CENTRE_K`).
 *  La fenêtre seule n'a aucun minimum — le protocole complet s'arrêtait donc SUR la
 *  paroi (hélice défaite, voir la constante). Le centre est donné ici, à la conversion,
 *  pour que TOUS les lecteurs d'une même contrainte (recuit, dynamique, minimisation,
 *  note, panneau) lisent le même chiffre. */
export const secondaryDihedralRestraintsOf = ({
  secondaryStructure = '', torsions = null, tolerance = FF_DIHEDRAL_TOLERANCE,
  centreK = FF_DIHEDRAL_CENTRE_K,
} = {}) => {
  const letters = String(secondaryStructure == null ? '' : secondaryStructure).toUpperCase().replace(/\s+/g, '');
  /* LES RÉSIDUS DE LA MOLÉCULE À L'ÉCRAN, DANS L'ORDRE DE LEURS CA — c'est l'ordre que
     la page peint (son modèle écrit les résidus dans l'ordre de la séquence, donc
     l'indice du CA y croît) et c'est donc celui qui apparie les lettres. */
  const byCa = new Map();
  const add = (entry, slot) => {
    if (!entry || !Array.isArray(entry.atoms) || !Number.isInteger(entry.ca)) return;
    const row = byCa.get(entry.ca) || { ca: entry.ca };
    row[slot] = entry.atoms;
    byCa.set(entry.ca, row);
  };
  for (const e of Array.from((torsions && torsions.phi) || [])) add(e, 'phiAtoms');
  for (const e of Array.from((torsions && torsions.psi) || [])) add(e, 'psiAtoms');
  const rows = [...byCa.values()].sort((a, b) => a.ca - b.ca);
  /* Le centre se donne en paramètre (l'appelant peut l'éteindre avec 0) mais le défaut
     est celui du champ : une contrainte ne peut pas naître sans fond. Le rapport porte
     le chiffre EFFECTIF, celui que les contraintes portent. */
  const kc = Number.isFinite(Number(centreK)) && Number(centreK) > 0 ? Number(centreK) : 0;
  const out = {
    ok: false, reason: 'no-structure', constraints: [], letters: letters.length,
    residues: rows.length, matched: 0, unmatched: 0, tolerance: Number(tolerance) || FF_DIHEDRAL_TOLERANCE,
    centreK: kc,
  };
  if (!letters) return out;
  if (!rows.length) { out.reason = 'no-backbone'; return out; }
  const tol = Number.isFinite(Number(tolerance)) && Number(tolerance) >= 0
    ? Number(tolerance) : FF_DIHEDRAL_TOLERANCE;
  /* UNE CONTRAINTE PAR ANGLE — φ et ψ séparément, parce que le champ les juge
     séparément (le puits plat d'un angle ne dit rien de l'autre) ; un bout de chaîne
     n'a qu'un des deux, et il porte donc la seule contrainte qu'il puisse porter. */
  const push = (letter, ca, kind, atoms, target) => out.constraints.push({
    kind, letter, ca, atoms, target, tolerance: tol, centreK: kc,
  });
  for (let k = 0; k < rows.length; k += 1) {
    const letter = letters[k] || '';
    const spec = SS_DIHEDRALS[letter];
    if (!spec) continue;
    out.matched += 1;
    const row = rows[k];
    if (row.phiAtoms) push(letter, row.ca, 'phi', row.phiAtoms, spec.phi);
    if (row.psiAtoms) push(letter, row.ca, 'psi', row.psiAtoms, spec.psi);
  }
  out.unmatched = Math.max(0, rows.length - out.matched);
  if (letters.length !== rows.length) out.reason = 'length-mismatch';
  else out.reason = out.constraints.length ? 'ok' : 'no-letter-imposes';
  out.ok = out.constraints.length > 0;
  return out;
};

/** ⛓ CE QUE LES CONTRAINTES DE DIHÈDRE (structure secondaire imposée) COÛTENT SUR CES
 *  COORDONNÉES — `{count, satisfied, violations, penalty, tolerance, worst, list}`.
 *  Le MÊME puits plat que le champ (`ffDihedralCostOf`), relu ici pour les rapports :
 *  la dynamique et la minimisation disent donc, geste par geste, combien de φ/ψ
 *  imposés sont dans leur fenêtre — et de combien le pire en sort. Le rapport relit le
 *  puits ENTIER : le fond du puits (`centreK`) est celui de la contrainte, donc la
 *  relecture du panneau et la note du champ ne peuvent pas porter deux chiffres. */
export const dihedralPenaltyOf = ({
  positions = null, dihedrals = [], tolerance = FF_DIHEDRAL_TOLERANCE,
} = {}) => {
  const read = flatPositions(positions);
  const out = {
    count: 0, satisfied: 0, violations: 0, penalty: 0,
    tolerance: Number.isFinite(Number(tolerance)) ? Number(tolerance) : FF_DIHEDRAL_TOLERANCE,
    /* LE FOND DU PUITS, comme la fenêtre : c'est le défaut du champ, et chaque ligne de
       `list` porte le sien — un appelant qui resserre la fenêtre (ou creuse le fond)
       pour ses propres contraintes le lit donc ligne par ligne. */
    centreK: FF_DIHEDRAL_CENTRE_K,
    worst: null, list: [],
  };
  const list = Array.from(dihedrals || []);
  if (!read) return out;
  const x = read.flat;
  const pt = (k) => [x[k * 3], x[k * 3 + 1], x[k * 3 + 2]];
  for (const raw of list) {
    const d = raw && typeof raw === 'object' ? raw : {};
    const atoms = Array.from(d.atoms || []);
    if (atoms.length !== 4 || !atoms.every((k) => Number.isInteger(k))) continue;
    const target = Number(d.target);
    if (!Number.isFinite(target)) continue;
    const tol = Number.isFinite(Number(d.tolerance)) ? Number(d.tolerance) : out.tolerance;
    const centreK = Number.isFinite(Number(d.centreK)) ? Math.max(0, Number(d.centreK)) : 0;
    out.count += 1;
    const deg = dihedralDeg(pt(atoms[0]), pt(atoms[1]), pt(atoms[2]), pt(atoms[3]));
    if (!Number.isFinite(deg)) continue;
    const dev = Math.abs(((deg - target + 540) % 360) - 180);
    const over = Math.max(0, dev - tol);
    const line = {
      kind: d.kind || '', letter: String(d.letter || '').toUpperCase(), ca: d.ca,
      atoms, target, tolerance: tol, centreK, deg, dev, over,
      satisfied: dev <= tol, cost: ffDihedralCostOf(deg, { target, tolerance: tol, centreK }),
    };
    out.penalty += line.cost;
    if (line.satisfied) out.satisfied += 1; else out.violations += 1;
    out.list.push(line);
    if (!out.worst || line.over > out.worst.over) out.worst = line;
  }
  out.penalty = Number(out.penalty.toFixed(6));
  return out;
};

/** CE QUE LES BASSINS φ/ψ COÛTENT SUR CES COORDONNÉES — `{count, measured, partial,
 *  penalty, violations, worst, list, weight}`. `penalty` = `weight × (distance au
 *  bord)²` par résidu SORTI, exactement zéro dedans (le bassin entier est un plateau,
 *  comme les ± 30° de ω). `list` porte, par résidu : son CA, sa classe, ses deux
 *  angles, son écart et la région où il tombe (`ramaRegionOf` du module du graphe — le
 *  rapport du calcul nomme donc les bassins comme le graphe les nomme). */
export const ramaPenaltyOf = ({
  positions = null, torsions = null, weight = STRUCTURE_CALC_RAMA_WEIGHT,
} = {}) => {
  const read = flatPositions(positions);
  const w = Number.isFinite(Number(weight)) ? Math.max(0, Number(weight)) : STRUCTURE_CALC_RAMA_WEIGHT;
  const out = {
    count: 0, measured: 0, partial: 0, penalty: 0, violations: 0, worst: null, list: [], weight: w,
  };
  if (!read) return out;
  const x = read.flat;
  const pt = (k) => [x[k * 3], x[k * 3 + 1], x[k * 3 + 2]];
  for (const row of ramaPairsOf(torsions)) {
    if (!row.phiAtoms || !row.psiAtoms) { out.partial += 1; continue; }
    out.count += 1;
    const phi = dihedralDeg(pt(row.phiAtoms[0]), pt(row.phiAtoms[1]), pt(row.phiAtoms[2]), pt(row.phiAtoms[3]));
    const psi = dihedralDeg(pt(row.psiAtoms[0]), pt(row.psiAtoms[1]), pt(row.psiAtoms[2]), pt(row.psiAtoms[3]));
    if (!Number.isFinite(phi) || !Number.isFinite(psi)) continue;
    out.measured += 1;
    const gap = ramaGapOf(phi, psi, row.klass);
    const cost = ffRamaCostOf(gap, w);
    out.penalty += cost;
    if (gap > 0) out.violations += 1;
    const line = {
      ca: row.ca, klass: row.klass, phi, psi, gap, cost, over: gap,
      region: ramaRegionOf(phi, psi, row.klass),
    };
    out.list.push(line);
    if (!out.worst || gap > out.worst.gap) out.worst = line;
  }
  return out;
};

/** CE QUE LES TROIS CONFORMÈRES DE χ1 COÛTENT — le potentiel à trois puits du dossier,
 *  `w·(1 + cos 3χ)/2` : il s'annule PILE sur 60°, 180° et −60° (les trois conformères
 *  décalés) et vaut `w` pile entre deux. `violations` compte les χ1 plus loin que
 *  `tolerance` degrés d'un des trois puits — c'est le chiffre que le panneau lit, la
 *  forme de la barrière n'en dépend pas. `dev` est cet écart réel, en degrés. */
export const chiPenaltyOf = ({
  positions = null, chis = [], weight = STRUCTURE_CALC_CHI_WEIGHT,
  tolerance = STRUCTURE_CALC_CHI_TOLERANCE,
} = {}) => {
  const read = flatPositions(positions);
  const w = Number.isFinite(Number(weight)) ? Math.max(0, Number(weight)) : STRUCTURE_CALC_CHI_WEIGHT;
  const tol = Number.isFinite(Number(tolerance)) ? Math.max(0, Number(tolerance)) : STRUCTURE_CALC_CHI_TOLERANCE;
  const out = {
    count: 0, measured: 0, penalty: 0, violations: 0, worst: null, list: [], weight: w, tolerance: tol,
  };
  if (!read) return out;
  const x = read.flat;
  const pt = (k) => [x[k * 3], x[k * 3 + 1], x[k * 3 + 2]];
  for (const entry of Array.from(chis || [])) {
    const [a, b, c, d] = entry && entry.atoms ? entry.atoms : [];
    if (![a, b, c, d].every((k) => Number.isInteger(k))) continue;
    out.count += 1;
    const deg = dihedralDeg(pt(a), pt(b), pt(c), pt(d));
    if (!Number.isFinite(deg)) continue;
    out.measured += 1;
    out.penalty += ffChiCostOf(deg, w);
    /* L'ÉCART AU PUITS LE PLUS PROCHE — les trois puits sont à 120° l'un de l'autre :
       c'est donc l'écart au multiple de 120° le plus proche à partir de 60°. */
    const dev = Math.abs(((deg - 60 + 180) % 120) - 60);
    const line = {
      ca: entry.ca, atoms: [a, b, c, d], deg, dev, inWell: dev <= tol,
      over: Math.max(0, dev - tol), cost: ffChiCostOf(deg, w),
    };
    out.list.push(line);
    if (!line.inWell) out.violations += 1;
    if (!out.worst || dev > out.worst.dev) out.worst = line;
  }
  return out;
};

/* ── 3ter · LE CHAMP DE FORCES — LES FAMILLES, ET L'ÉNERGIE ────────────────────
   « add the force field ». Le champ est UNE fonction et une liste de familles NOMMÉES :
   elle vit dans `utils/forceFieldKcal.js` (douze familles, en kcal/mol, avec les charges,
   le solvant, l'entropie et les atomes ajoutés), et ce module ne fait que la BRANCHER
   sur ses coordonnées et son squelette. `forceFieldRowsOf` est réexporté tel quel : le
   panneau affiche exactement ce que le champ dit de lui-même, jamais un chiffre recopié
   dans le JSX. */

/** LES FAMILLES DU CHAMP, DANS L'ORDRE OÙ ELLES SE LISENT — l'identifiant est aussi la
 *  clef du rapport (`forceFieldEnergyOf(...).bond`, `.elec`, …). */
export const FORCE_FIELD_FAMILIES = FORCE_FIELD_KCAL_FAMILIES;

/** LES LIGNES DU CHAMP DE FORCES POUR LE PANNEAU — `{id, icon, label, k, unit, rule,
 *  of}` par famille : le module du champ les écrit, le panneau les affiche. */
export const forceFieldRowsOf = (spec = {}) => ffKcalRowsOf(spec);

/**
 * L'ÉNERGIE DU CHAMP DE FORCES RÉEL SUR CES COORDONNÉES — EN kcal/mol.
 *
 * Toutes les familles sont calculées par `utils/forceFieldKcal.js` (liaisons, angles,
 * cycles plans, van der Waals, électrostatique avec les charges partielles, solvant non
 * polaire, potentiel statistique φ/ψ, χ1, ω, vos distances en PUITS PLAT, entropie) ;
 * ce module-ci lui fournit ce que lui seul sait lire — le squelette (`backboneTorsionsOf`)
 * et les liaisons peptidiques (`peptideOmegasOf`) — et lui rend son rapport tel quel.
 * Les atomes ajoutés (hydrogènes) et les charges sont comptés dans `added`/`charges` :
 * rien n'est caché.
 *
 * @returns {{ok:boolean, reason:string, total:number, enthalpy:number, freeEnergy:number,
 *            bond:number, angle:number, planar:number, vdw:number, elec:number,
 *            solv:number, rama:number, chi:number, omega:number, restraint:number,
 *            entropy:number, rows:object[], added:object, charges:object, surface:object,
 *            nonbonded:object, bondReport:object, angleReport:object, planarReport:object,
 *            ramaReport:object, chiReport:object, omegaReport:object,
 *            restraintReport:object, entropyReport:object, torsions:object,
 *            omegas:object[], restraints:object[], worstVdw:object|null,
 *            worstElec:object|null}}
 *   `total` = `enthalpy` (la somme des douze familles d'énergie) ; `freeEnergy` ajoute
 *   l'entropie (−T·S). ⚠ Cette fonction est la RÉFÉRENCE : les moteurs (recuit,
 *   dynamique, minimisation) relisent les mêmes fonctions de coût terme par terme, et
 *   `engine.costOf() + engine.constants` doit lui être égal — un test le mesure sur une
 *   molécule et sur une protéine.
 */
export const forceFieldEnergyOf = ({
  positions = null, elements = [], bonds = [], restraints = [],
  torsions = null, omegas = null, dihedrals = [], temperature = FF_REFERENCE_TEMPERATURE,
  exactSurface = false, hydrogenate = true,
  /* 🧪 LE pH ET LA FORCE IONIQUE — les deux réglages de la CHIMIE du champ (voir §2bis et §4bis
     de utils/forceFieldKcal.js) : le ⟳ Energy et la note d'un modèle les portent, donc la
     lecture à l'écran est celle du champ qui a tourné. */
  ph = FF_PH_DEFAULT, ionicStrength = FF_IONIC_STRENGTH_DEFAULT,
  /* 🎯 LA FONCTION CIBLE — `classic` (le défaut) ou `dyana` : le champ lu ici est celui
     que la fonction cible décrit, et le rapport DIT ce qu'elle a éteint. */
  targetFunction = STRUCTURE_CALC_TARGET_FUNCTION,
} = {}) => {
  const read = flatPositions(positions);
  const els = Array.from(elements || []);
  const rows = ffKcalRowsOf({ temperature });
  const empty = {
    ok: false, reason: 'bad-points', total: Infinity, enthalpy: Infinity, freeEnergy: Infinity,
    bond: 0, angle: 0, planar: 0, vdw: 0, elec: 0, solv: 0, rama: 0, chi: 0, omega: 0,
    restraint: 0, entropy: 0,
    added: { ok: false, heavy: 0, hydrogens: 0, atoms: 0, skipped: 0 },
    charges: { net: 0, method: 'zero', groups: [], unknown: 0 },
    surface: { estimate: 0, exact: null, energy: 0 }, nonbonded: { count: 0, repulsive: 0, topology: {}, unknown: 0 },
    bondReport: {}, angleReport: {}, planarReport: {},
    ramaReport: ffTorsionFamilyOf([]), chiReport: ffTorsionFamilyOf([]), omegaReport: ffTorsionFamilyOf([]),
    restraintReport: { count: 0, satisfied: 0, violations: 0, penalty: 0, worst: null, list: [] },
    entropyReport: ffEntropyOf({}),
    torsions: backboneTorsionsOf({}), omegas: [], restraints: [], rows,
    worstVdw: null, worstElec: null,
    /* 🧪 LES DEUX RÉGLAGES DE LA CHIMIE, POSÉS MÊME SUR UN REFUS — un appelant qui lit
       `field.kappa` sur une molécule sans coordonnées lit 0, jamais `undefined`. */
    ph: null, ionisation: null,
    ionicStrength: Number(ionicStrength) > 0 ? Number(ionicStrength) : 0,
    kappa: Number(ffDebyeKappaOf(ionicStrength).toFixed(6)), debyeLength: null,
  };
  if (!read) return empty;
  /* LE SQUELETTE ET LES LIAISONS PEPTIDIQUES — lus par CE module (c'est son métier) et
     passés au champ, qui n'apprend pas la chimie des protéines mais la reçoit. */
  const backbone = torsions || backboneTorsionsOf({ elements: els, bonds, atomCount: read.count });
  const omegaList = Array.from(omegas || peptideOmegasOf({ elements: els, bonds, atomCount: read.count }));
  const clean = restraintListOf({ restraints, atomCount: read.count }).list;
  const ramaPairs = ramaPairsOf(backbone).filter((r) => r.phiAtoms && r.psiAtoms);
  const field = ffKcalEnergyOf({
    positions: read.flat, elements: els, bonds, restraints: clean,
    ramaPairs, omegas: omegaList, chis: Array.from(backbone.chi || []),
    dihedrals, temperature, exactSurface, hydrogenate, targetFunction, ph, ionicStrength,
  });
  return {
    ...field,
    torsions: backbone, omegas: omegaList, restraints: clean,
    rows,
    /* LA MÉTROLOGIE φ/ψ DU MODULE (`partial` : les résidus de bout de chaîne, qui n'ont
       pas les deux angles) — le graphe 🪢 et le panneau la lisent telle quelle. */
    ramaReport: { ...field.ramaReport, partial: backbone.partial || 0 },
  };
};

/* ── 4 · LA NOTE D'UN RÉSULTAT — « the final result is scored » ───────────────
   LE CHAMP DE FORCES de §3ter (`forceFieldEnergyOf`), SANS la longe — n départs sont là
   pour explorer —, plus la pénalité d'empilement des 🎲 échappées
   (`RELAX_CLASH_WEIGHT` × gravité). Les familles de l'énergie sont rendues À PART : un
   score n'est pas une boîte noire, il se lit. */

/**
 * @returns {{ok:boolean, reason:string, score:number, target:number, total:number,
 *            bond:number, angle:number, planar:number, pair:number, contact:number,
 *            omega:number, rama:number, chi:number, forceField:object,
 *            bondRms:number, angleRms:number, planarRms:number, contactRms:number,
 *            worstBond:object|null, worstAngle:object|null, worstPlanar:object|null,
 *            worstContact:object|null, clashPenalty:number, omegaPenalty:number,
 *            ramaPenalty:number, chiPenalty:number, omega:object, ramaPlot:object,
 *            chiWells:object, clashes:object, contacts:object, restraint:object}}
 *   `score` = `total + clashPenalty` — le seul chiffre du classement ; `total` = le
 *   CHAMP DE FORCES entier (liaisons, angles, plans, distances demandées, cœur dur, ω,
 *   bassins φ/ψ, χ1) ; `target` = la fonction cible du ⚒ seule ; `restraint` = la
 *   lecture des distances demandées (`restraintReportOf`, relue sur ces coordonnées).
 *   `ramaPlot` = la lecture φ/ψ résidu par résidu : c'est ELLE que le graphe 🪢 relit
 *   après un calcul, donc le graphe et le score ne peuvent pas parler de deux
 *   conformations.
 */
export const scoreStructureOf = ({
  positions = null, elements = [], bonds = [], restraints = [],
  weights = RELAX_WEIGHTS, clashDistance = RELAX_CLASH_DISTANCE,
  tolerance = STRUCTURE_CALC_RESTRAINT_TOLERANCE, omegas = null, torsions = null,
  dihedrals = [],
  ramaWeight = STRUCTURE_CALC_RAMA_WEIGHT, chiWeight = STRUCTURE_CALC_CHI_WEIGHT,
  /* 🧪 LE pH ET LA FORCE IONIQUE — la note d'un modèle est prise sous le MÊME champ que son
     protocole (voir §2bis et §4bis de utils/forceFieldKcal.js) : deux modèles d'une même
     famille ne peuvent donc pas être notés dans deux chimies différentes. */
  ph = FF_PH_DEFAULT, ionicStrength = FF_IONIC_STRENGTH_DEFAULT,
  /* 🎯 LA FONCTION CIBLE DE LA NOTE — la même que celle du départ (voir
     `STRUCTURE_CALC_TARGET_FUNCTIONS`) : la note ne peut pas juger un autre champ que
     celui que le protocole vient de conduire. */
  targetFunction = STRUCTURE_CALC_TARGET_FUNCTION,
} = {}) => {
  const read = flatPositions(positions);
  if (!read) {
    return {
      ok: false, reason: 'bad-points', score: Infinity, target: Infinity, total: Infinity,
      bond: 0, angle: 0, planar: 0, pair: 0, contact: 0, omega: 0, rama: 0, chi: 0,
      bondRms: 0, angleRms: 0, planarRms: 0, contactRms: 0,
      worstBond: null, worstAngle: null, worstPlanar: null, worstContact: null,
      clashPenalty: 0, omegaPenalty: 0, ramaPenalty: 0, chiPenalty: 0,
      forceField: forceFieldEnergyOf({}),
      omega: { count: 0, penalty: 0, violations: 0, worst: null },
      ramaPlot: { count: 0, measured: 0, partial: 0, penalty: 0, violations: 0, worst: null, list: [] },
      chiWells: { count: 0, measured: 0, penalty: 0, violations: 0, worst: null, list: [] },
      dihedralWells: { count: 0, satisfied: 0, violations: 0, penalty: 0, worst: null, list: [] },
      clashes: { count: 0, worst: null, severity: 0, minDistance: clashDistance },
      contacts: { count: 0, severity: 0, worst: null, checked: 0, unknownElements: 0 },
      restraint: restraintReportOf({ positions: null, restraints, tolerance }),
    };
  }
  const x = read.flat;
  const clean = restraintListOf({ restraints, atomCount: read.count }).list;
  /* LE CHAMP, LU ICI SUR CES COORDONNÉES-LÀ — le même constructeur que le recuit, la
     dynamique et la minimisation emploient (aucun moteur n'a sa propre physique). Tout
     est en kcal/mol. */
  const field = forceFieldEnergyOf({
    positions: x, elements, bonds, restraints: clean, torsions, omegas, dihedrals, targetFunction,
    ph, ionicStrength,
  });
  /* ⚠ LA PÉNALITÉ D'EMPILEMENT N'EST PLUS UN TERME À PART : l'empilement a un prix DANS
     le champ (le mur répulsif du Lennard-Jones, famille `vdw`, qui rend des dizaines de
     kcal/mol dès que deux atomes se traversent). Le chiffre reste RENDU — `clashes` et
     `contacts` sont des LECTURES, pas des additions — et `clashPenalty` vaut 0 : ajouter
     une pénalité en plus du mur compterait deux fois le même atome. */
  const clashes = clashReportOf({ positions: x, bonds, minDistance: clashDistance });
  const contacts = badContactsOf({
    positions: x, elements, bonds, tolerance: RELAX_CONTACT_TOLERANCE,
  }) || { count: 0, severity: 0, worst: null, checked: 0, unknownElements: 0 };
  const clashPenalty = 0;
  /* ⚠ LES LECTURES DE LA GÉOMÉTRIE COVALENTE — `bondRms`, `angleRms`, `planarRms`,
     `contactRms` et les quatre « pires écarts » étaient ANNONCÉS dans le contrat ci-dessus
     et dans AUCUN champ de l'objet rendu : le rapport du 🧬 (`calcReportOf`) et le tableau
     du panneau les lisent pourtant (`r.bondRms.toFixed(3)`), donc `undefined.toFixed`
     tuait le calcul À LA FIN — le rapport de cette session : « The structure calculation
     can never be completed … Cannot read properties of undefined (reading 'toFixed') ».
     Ils sont RELUS ICI, par le même `energyOf` et les mêmes cibles du ⚒ que tout le
     dossier (`buildRelaxTerms` : longueurs et angles des tables, cycles plans à 0°, et la
     marche de contact du cœur dur) — donc le chiffre affiché est celui du modèle, pas une
     seconde vérité inventée pour l'écran. */
  const geomRead = energyOf(
    buildRelaxTerms({ elements, bonds, pairs: [], weights, positions: x }), x,
  );
  const om = field.omegaReport;
  const ra = field.ramaReport;
  const ch = field.chiReport;
  const dh = field.dihedralReport;
  return {
    ok: true,
    reason: 'ok',
    /* LE SCORE EST LA FREE ENERGY DU MODÈLE — l'enthalpie du champ plus l'entropie
       (−T·S), en kcal/mol. C'est ce que le classement trie. */
    score: field.freeEnergy,
    total: field.total,
    enthalpy: field.enthalpy,
    freeEnergy: field.freeEnergy,
    target: field.restraint,
    restraintEnergy: field.restraint,
    bond: field.bond, angle: field.angle, planar: field.planar,
    vdw: field.vdw, elec: field.elec, solv: field.solv,
    entropyEnergy: field.entropy,
    entropy: field.entropy,
    omegaPenalty: field.omega,
    ramaPenalty: field.rama,
    chiPenalty: field.chi,
    dihedralPenalty: field.dihedral,
    clashPenalty,
    /* LES LECTURES DE LA GÉOMÉTRIE COVALENTE DU MODÈLE — le tableau du panneau en affiche
       deux, le rapport du 🧬 deux autres (voir `geomRead` plus haut : une seule relecture,
       avec les cibles du ⚒). */
    bondRms: geomRead.bondRms, angleRms: geomRead.angleRms,
    planarRms: geomRead.planarRms, contactRms: geomRead.contactRms,
    worstBond: geomRead.worstBond ? { ...geomRead.worstBond } : null,
    worstAngle: geomRead.worstAngle ? { ...geomRead.worstAngle } : null,
    worstPlanar: geomRead.worstPlanar ? { ...geomRead.worstPlanar } : null,
    worstContact: geomRead.worstContact ? { ...geomRead.worstContact } : null,
    added: field.added, charges: field.charges, surface: field.surface,
    nonbonded: field.nonbonded, rows: field.rows,
    worstVdw: field.worstVdw ? { ...field.worstVdw } : null,
    worstElec: field.worstElec ? { ...field.worstElec } : null,
    forceField: field,
    /* LE RAPPORT ω — le même terme que celui de la note, avec le pire écart en degrés. */
    omega: {
      count: om.count, violations: om.violations,
      worst: om.worst ? { ...om.worst } : null,
    },
    /* LA LECTURE φ/ψ DU MODÈLE — un point par résidu, la région où il tombe, et son
       écart au bassin : c'est ce que le graphe 🪢 affiche, dit par le calcul. */
    ramaPlot: {
      count: ra.count, measured: ra.measured, partial: ra.partial,
      penalty: ra.penalty, violations: ra.violations,
      worst: ra.worst ? { ...ra.worst } : null,
      list: ra.list.map((l) => ({ ...l })),
    },
    chiWells: {
      count: ch.count, measured: ch.measured, penalty: ch.penalty, violations: ch.violations,
      worst: ch.worst ? { ...ch.worst } : null,
      list: ch.list.map((l) => ({ ...l })),
    },
    /* ⛓ LES CONTRAINTES DE DIHÈDRE ISSUES DE LA STRUCTURE SECONDAIRE IMPOSÉE — le
       même puits plat que la note, avec le pire écart en degrés : c'est ce que le
       panneau 🧬 affiche (combien de φ/ψ dans leur fenêtre, lesquels en sortent). */
    dihedralWells: {
      count: dh.count, satisfied: dh.satisfied, violations: dh.violations, penalty: dh.penalty,
      tolerance: dh.tolerance,
      worst: dh.worst ? { ...dh.worst } : null,
      list: dh.list.map((l) => ({ ...l })),
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
    restraint: field.restraintReport,
    restraintList: field.restraintReport,
    /* LES TROIS CHIFFRES QUE LE PANNEAU LIT SUR UN DÉPART — « combien de distances sont
       tenues » — rendus AUSSI au premier niveau : deux façons de les lire ne peuvent pas
       donner deux valeurs, elles viennent du même rapport. */
    satisfied: field.restraintReport.satisfied,
    violations: field.restraintReport.violations,
    rmsd: field.restraintReport.rmsd,
  };
};

/* ── 4bis · LA MÉCANIQUE DIHÉDRALE — LE MOTEUR DE LA DYNAMIQUE ET DE LA MINIMISATION ──
   Un pas de torsion ne change QUE les termes qui traversent sa charnière : un couple
   dont un atome tourne et l'autre non, un dièdre dont un des quatre atomes tourne.
   Ce moteur-là rassemble, POUR une molécule, ses canaux et ses contraintes : la
   lecture d'une géométrie « à plat » (`mapFor`), le coût des termes qui traversent une
   charnière (`crossCost`), la liste de ces termes (`crossingOf`) et le coût total
   (`costOf`, la même composition que le recuit de Metropolis : distances + cœur dur +
   ω + bassins + χ1).
   ⚠ LES FONCTIONS DE COÛT SONT CELLES DU DOSSIER (`ramaGapOf`, la barrière à trois
   puits de χ1, le plateau de ω, `contactDistanceOf`, les poids du ⚒) : la dynamique ne
   peut donc pas optimiser autre chose que ce que la note juge. Ce qui diffère d'avec le
   recuit, c'est la LONGE : Metropolis peut REFUSER un pas qui casse une distance tenue
   (il en essaie un autre) ; une trajectoire ne le peut pas, donc la longe y est un MUR
   (`STRUCTURE_CALC_LEASH_WALL`), zéro dans la tolérance et quadratique au-delà. */
const torsionEngineOf = ({
  positions = null, elements = [], bonds = [], restraints = [], weights = RELAX_WEIGHTS,
  channels = null, leash = null, torsions = null, omegas = null, dihedrals = [],
  ramaWeight = STRUCTURE_CALC_RAMA_WEIGHT, chiWeight = STRUCTURE_CALC_CHI_WEIGHT,
  leashWall = STRUCTURE_CALC_LEASH_WALL, hydrogenate = true,
  dielectric = FF_DIELECTRIC, tolerance = STRUCTURE_CALC_RESTRAINT_TOLERANCE,
  /* 🧪 LE pH ET LA FORCE IONIQUE (voir utils/forceFieldKcal.js §2bis et §4bis) — les deux
     réglages de la CHIMIE, lus ICI et nulle part ailleurs pour les quatre moteurs de torsion
     (le recuit, la dynamique, la minimisation et la trempe tournent tous sur ce moteur) :
       · `ph` dit ce que la molécule PORTE (le degré d'ionisation des groupes que le graphe
         montre) — `null` (le défaut) veut dire « la chimie telle que le graphe la montre » ;
       · `ionicStrength` (mol/L) dit COMMENT deux charges se voient (l'atmosphère ionique) —
         `0` (le défaut) rend exactement le Coulomb d'avant. */
  ph = FF_PH_DEFAULT, ionicStrength = FF_IONIC_STRENGTH_DEFAULT,
  hydrogen = null,
  /* 🎯 LA FONCTION CIBLE — `classic` (le défaut) ou `dyana` : elle décide des familles
     non liées, de la portée des couples, du terme de surface ET de l'ajout d'hydrogènes
     (voir `FF_TARGET_FUNCTIONS`). ⚠ C'est le SEUL endroit où elle est lue pour les
     moteurs : le recuit, la dynamique et la minimisation tournent tous sur ce moteur. */
  targetFunction = STRUCTURE_CALC_TARGET_FUNCTION,
} = {}) => {
  const tf = structureCalcTargetFunctionOf(targetFunction);
  /* 🌊 κ DE LA FORCE IONIQUE — un seul chiffre pour tout ce moteur (le prix d'un couple, sa
     pente dans le corps rigide d'eau, le rapport) : `ffDebyeKappaOf(0)` vaut 0. */
  const kappa = ffDebyeKappaOf(ionicStrength);
  const read = flatPositions(positions);
  if (!read) return null;
  /* ⚠ LA MOLÉCULE DU MOTEUR EST CELLE DU CHAMP : les ATOMES AJOUTÉS (hydrogènes) y sont.
     Les canaux, les contraintes et les résidus gardent leurs INDICES D'ORIGINE (les H
     sont ajoutés à la FIN du tableau), et chaque canal emmène dans sa rotation les
     hydrogènes de SES atomes : un H est une fonction rigide de son atome lourd, donc la
     rotation l'emporte exactement comme le champ le relit (`hydrogenatedOf`).
     ⚠ `hydrogen` — la molécule complète d'une ÉTAPE PRÉCÉDENTE (le recuit, puis la
     dynamique, puis la minimisation) : les H y sont portés D'UN BOUT À L'AUTRE du
     protocole, au lieu d'être replacés à chaque étape. Sans cela, la PHASE d'un
     hydrogène terminal (les trois H d'un méthyle) se redéfinit à chaque moteur, et le
     modèle change de rotamère de H entre deux étapes (mesuré : 274 kcal/mol de coût
     pour une conformation que le recuit venait de poser à 9.7). */
  const elsHeavy = Array.from(elements || []);
  const heavyBonds = Array.from(bonds || []);
  const carried = hydrogen && Array.isArray(hydrogen.positions) && hydrogen.positions.length >= read.flat.length
    ? hydrogen : null;
  /* 🎯 LES ATOMES UNIS — une fonction cible `dyana` ne veut AUCUN hydrogène ajouté : la
     molécule est lue telle qu'elle est (`unitedAtoms`), donc le moteur tourne sur le
     squelette lourd, exactement comme DYANA/CYANA. Une molécule COMPLÈTE déjà portée par
     l'appelant (`hydrogen`) reste utilisée telle quelle : c'est elle qui a servi à
     l'étape précédente du protocole, on ne la jette pas en route. */
  const addHydrogens = hydrogenate && !tf.unitedAtoms;
  const mol = carried
    ? {
      ok: true, reason: 'ok', positions: Array.from(carried.positions),
      elements: Array.from(carried.elements || []), bonds: Array.from(carried.bonds || []),
      added: Math.max(0, (carried.elements || []).length - read.count), heavy: read.count,
      atoms: (carried.elements || []).length, skipped: 0,
      hydrogens: Array.from(carried.hydrogens || []),
    }
    : (addHydrogens
      ? hydrogenatedOf({ positions: read.flat, elements: elsHeavy, bonds: heavyBonds })
      : {
        ok: true, reason: 'ok', positions: Array.from(read.flat), elements: elsHeavy.slice(),
        bonds: heavyBonds.slice(), added: 0, heavy: read.count, atoms: read.count,
        skipped: 0, hydrogens: [],
      });
  const els = mol.elements;
  const count = mol.atoms;
  const heavyCount = read.count;
  const bondsOf = mol.bonds;
  const chargeReport = partialChargesOf({ elements: els, bonds: bondsOf, ph });
  const charges = chargeReport.charges;
  const x = mol.positions.slice();
  const hydrogensOf = new Map();
  for (const h of mol.hydrogens) {
    const bucket = hydrogensOf.get(h.parent);
    if (bucket) bucket.push(h.index); else hydrogensOf.set(h.parent, [h.index]);
  }
  /* LES DISTANCES DEMANDÉES PORTENT LEUR PUITS PLAT — le même `ffRestraintCostOf` que le
     score, donc le même nombre (zéro dans la tolérance, k·over² au-delà), et le MÊME k :
     `ffRestraintKOf` multiplie la raideur du champ par le poids ⚖ de la ligne (un poids
     de 0 la rend inerte — le moteur ne peut alors pas la pousser, comme le score ne la
     compte pas). */
  const clean = restraintListOf({ restraints, atomCount: heavyCount }).list;
  const pairTerms = clean.map((t) => ({
    ...t, tolerance: Number.isFinite(Number(t.tolerance)) ? Number(t.tolerance) : tolerance,
  }));
  const list = Array.isArray(channels)
    ? { channels }
    : (channels || rotatableBondsOf({ elements: elsHeavy, bonds: heavyBonds, atomCount: heavyCount }));
  /* LES CANAUX EMMÈNENT LEURS HYDROGÈNES — `movingAll` est la liste des atomes qu'une
     rotation rigide autour de la charnière déplace, ajoutés compris. */
  const chan = Array.from(list.channels || []).map((ch) => {
    const extra = [];
    for (const k of ch.moving || []) {
      const h = hydrogensOf.get(k);
      if (h) extra.push(...h);
    }
    return { ...ch, movingAll: (ch.moving || []).concat(extra) };
  });
  const backbone = torsions || backboneTorsionsOf({ elements: elsHeavy, bonds: heavyBonds, atomCount: heavyCount });
  const ramaRows = ramaPairsOf(backbone).filter((r) => r.phiAtoms && r.psiAtoms);
  const chis = Array.from(backbone.chi || []);
  /* ⛓ LES CONTRAINTES DE DIHÈDRE ISSUES DE LA STRUCTURE SECONDAIRE IMPOSÉE — une
     liste de φ et/ou ψ avec leur cible et leur fenêtre (voir
     `secondaryDihedralRestraintsOf`, qui les construit à partir de la peinture 🖌️ de
     « Sequence and structure »). Elles entrent dans le champ par `ffDihedralCostOf` :
     le moteur ne peut donc pas minimiser autre chose que ce que la note juge. */
  const dihedralRows = Array.from(dihedrals || [])
    .filter((d) => d && Array.isArray(d.atoms) && d.atoms.length === 4)
    .map((d) => ({
      ...d,
      target: Number(d.target),
      tolerance: Number.isFinite(Number(d.tolerance)) ? Number(d.tolerance) : FF_DIHEDRAL_TOLERANCE,
      /* ⚠ LE FOND DU PUITS PASSE AUSSI (il est déjà dans `...d`, mais il est NORMALISÉ
         ici comme la fenêtre : un chiffre illisible ou négatif vaut le puits plat). Sans
         lui, ce moteur s'arrêterait SUR la paroi de la fenêtre au lieu de la cible. */
      centreK: Number.isFinite(Number(d.centreK)) && Number(d.centreK) > 0 ? Number(d.centreK) : 0,
    }));
  const omega = Array.from(omegas || peptideOmegasOf({ elements: elsHeavy, bonds: heavyBonds, atomCount: heavyCount }));
  const wRama = Number.isFinite(Number(ramaWeight)) ? Math.max(0, Number(ramaWeight)) : STRUCTURE_CALC_RAMA_WEIGHT;
  const wChi = Number.isFinite(Number(chiWeight)) ? Math.max(0, Number(chiWeight)) : STRUCTURE_CALC_CHI_WEIGHT;
  const wWall = Number.isFinite(Number(leashWall)) ? Math.max(0, Number(leashWall)) : STRUCTURE_CALC_LEASH_WALL;
  const at = (k, map) => (map && map.has(k) ? map.get(k) : [x[k * 3], x[k * 3 + 1], x[k * 3 + 2]]);
  const gap = (i, j, map) => {
    const a = at(i, map); const b = at(j, map);
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  };
  const dihedralOf = (atoms, map) => dihedralDeg(at(atoms[0], map), at(atoms[1], map),
    at(atoms[2], map), at(atoms[3], map));
  /* LES TERMES — chaque famille est LA fonction du champ (kcal/mol), relue sur une
     géométrie « à plat ». Le moteur ne peut donc pas minimiser autre chose que le score. */
  const costRestraint = (t, map) => ffRestraintCostOf(gap(t.i, t.j, map), t, ffRestraintKOf(t.weight));
  /* 🎯 LE COUPLE NON LIÉ SELON LA FONCTION CIBLE — le MÊME lecteur que le champ
     (`ffNonbondedCostOf`) : en mode DYANA, la répulsion seule, sans charge, et aucune
     attraction. Le moteur ne peut donc pas minimiser autre chose que le score. */
  const costNonbonded = (p, map) => ffNonbondedCostOf(gap(p.i, p.j, map), p, {
    dielectric, repulsionOnly: tf.repulsionOnly, electrostatics: tf.electrostatics, kappa,
  });
  const costOmega = (o, map) => {
    const deg = dihedralOf(o.probeAtoms, map);
    return Number.isFinite(deg) ? ffOmegaCostOf(deg, { target: o.target }) : 0;
  };
  const costRama = (r, map) => {
    const phi = dihedralOf(r.phiAtoms, map);
    const psi = dihedralOf(r.psiAtoms, map);
    if (!Number.isFinite(phi) || !Number.isFinite(psi)) return 0;
    return ffRamaCostOf(ramaGapOf(phi, psi, r.klass), wRama);
  };
  const costChi = (e, map) => {
    const deg = dihedralOf(e.atoms, map);
    return Number.isFinite(deg) ? ffChiCostOf(deg, wChi) : 0;
  };
  const costDihedral = (d, map) => ffDihedralCostOf(dihedralOf(d.atoms, map), d);
  /* LE MUR DE LA LONGE — zéro dans la tolérance, k·over² au-delà, avec le MÊME poids ⚖
     que la contrainte de la ligne (une ligne qui compte double est aussi gardée deux
     fois plus fermement ; un poids de 0 n'est pas gardé du tout, ce qui est cohérent :
     elle ne pèse rien). */
  const costWall = (w, map) => {
    const over = Math.max(0, Math.abs(gap(w.i, w.j, map) - w.target) - w.tolerance);
    return over > 0 ? wWall * ffRestraintWeightOf(w.weight) * over * over : 0;
  };

  /* LA MARCHE DES COUPLES NON LIÉS, ET LA SURFACE — les listes du CHAMP (1-2 et 1-3
     exclus, 1-4 atténué, portée 8 Å), refaites régulièrement : les atomes bougent, donc
     les couples qui se touchent ne sont plus les mêmes. La liste de SURFACE, elle, porte
     TOUS les couples de la portée (une liaison enterre la moitié de la sphère d'un H). */
  let walk = ffPairListOf({
    positions: x, elements: els, bonds: bondsOf, charges,
    limit: tf.pairLimit, surface: tf.surface,
  });
  let surfaceNear = new Map();
  let constants = { bond: 0, angle: 0, planar: 0, total: 0 };
  const rebuild = () => {
    walk = ffPairListOf({
      positions: x, elements: els, bonds: bondsOf, charges,
      limit: tf.pairLimit, surface: tf.surface,
    });
    surfaceNear = new Map();
    for (const p of walk.surface) {
      const a = surfaceNear.get(p.i); if (a) a.push(p.j); else surfaceNear.set(p.i, [p.j]);
      const b = surfaceNear.get(p.j); if (b) b.push(p.i); else surfaceNear.set(p.j, [p.i]);
    }
    /* LES FAMILLES CONSTANTES DU MOUVEMENT — une torsion rigide ne change NI une
       longueur, NI un angle, NI un cycle plan : le moteur les calcule UNE fois et les
       rend (`engine.constants`), donc `costOf() + constants.total` EST le total du champ
       — un test le mesure. */
    const geom = buildRelaxTerms({
      elements: els, bonds: bondsOf, pairs: [], weights: RELAX_WEIGHTS, positions: x,
    });
    let bond = 0; let angle = 0; let planar = 0;
    for (const t of geom.bonds) bond += ffBondCostOf(gap(t.i, t.j, null), t.target);
    for (const t of geom.angles) {
      const deg = ffAngleDegOf(at(t.i, null), at(t.j, null), at(t.k, null));
      angle += Number.isFinite(deg) ? ffAngleCostOf(deg, t.target) : 0;
    }
    for (const t of geom.planars) {
      const deg = dihedralOf([t.i, t.j, t.k, t.l], null);
      const dev = Number.isFinite(deg) ? Math.min(Math.abs(deg), 180 - Math.abs(deg)) : 0;
      planar += ffPlanarCostOf(dev, 0);
    }
    constants = {
      bond: Number(bond.toFixed(6)), angle: Number(angle.toFixed(6)),
      planar: Number(planar.toFixed(6)),
      total: Number((bond + angle + planar).toFixed(6)),
    };
  };
  rebuild();
  /* LA SURFACE D'UN ATOME — le produit des fractions restantes de ses calottes
     voisines, exactement comme le champ le lit (`ffSurfaceOf`) : le moteur ne peut pas
     optimiser une autre surface que celle du score. */
  const radii = new Float64Array(count);
  for (let k = 0; k < count; k += 1) {
    radii[k] = ffElementOf(els[k]).radius + FF_SASA_PROBE;
  }
  const capOf = (ri, rj, d) => {
    if (!(d > 0) || !(ri > 0)) return 0;
    const cos = (ri * ri + d * d - rj * rj) / (2 * d * ri);
    if (cos >= 1) return 0;
    if (cos <= -1) return 1;
    return (1 - cos) / 2;
  };
  const surfaceCostAt = (i, map) => {
    const neighbours = surfaceNear.get(i);
    if (!neighbours || !neighbours.length) return FF_SASA_GAMMA * 4 * Math.PI * radii[i] * radii[i];
    let share = 1;
    for (const j of neighbours) {
      const d = gap(i, j, map);
      share *= 1 - FF_SURFACE_CAP_OVERLAP * capOf(radii[i], radii[j], d);
      if (share <= 1e-9) { share = 0; break; }
    }
    return FF_SASA_GAMMA * 4 * Math.PI * radii[i] * radii[i] * share;
  };
  /* LA LONGE, EN MUR — les distances DÉJÀ tenues au moment où la dynamique part : leur
     tolérance devient un puits (« aucune distance déjà tenue n'est lâchée »). Une
     distance qui n'était PAS tenue n'a pas de mur : c'est la contrainte du panneau qui
     la porte, et elle y gagne. */
  const walls = [];
  for (const r of Array.from(leash || [])) {
    const li = Number(r && r.i); const lj = Number(r && r.j);
    if (!Number.isInteger(li) || !Number.isInteger(lj)) continue;
    const row = clean.find((t) => (t.i === li && t.j === lj) || (t.i === lj && t.j === li));
    const target = Number.isFinite(Number(r.target)) ? Number(r.target) : (row ? row.target : NaN);
    if (!Number.isFinite(target)) continue;
    const tol = Number(r.tolerance);
    walls.push({
      i: li, j: lj, target,
      tolerance: Number.isFinite(tol) && tol >= 0 ? tol : STRUCTURE_CALC_RESTRAINT_TOLERANCE,
      /* ⚖ LE POIDS VIENT DE LA LIGNE DE LA TABLE quand elle est là (c'est elle qui a un
         poids), sinon de ce que l'appelant a donné : un mur ne peut donc pas être plus
         raide ni plus mou que la contrainte qu'il garde. */
      weight: row ? row.weight : r.weight,
    });
  }
  const crossingOf = (ch) => {
    /* ⚠ LE MOUVEMENT VA AUX ATOMES AJOUTÉS (`movingAll`) — un H traverse la charnière de
       son atome et son couple, sa charge et sa surface changent avec lui. */
    const set = new Set(ch.movingAll || ch.moving || []);
    const straddles = (atoms) => Array.from(atoms || []).some((k) => set.has(k));
    const surfaceAtoms = new Set();
    for (const p of walk.surface) {
      if (set.has(p.i) === set.has(p.j)) continue;
      surfaceAtoms.add(p.i); surfaceAtoms.add(p.j);
    }
    return {
      restraints: pairTerms.filter((t) => set.has(t.i) !== set.has(t.j)),
      walls: walls.filter((w) => set.has(w.i) !== set.has(w.j)),
      /* LE VAN DER WAALS ET L'ÉLECTROSTATIQUE COMPTENT ICI AUSSI — sans eux, une
         trajectoire pousserait deux atomes l'un dans l'autre. */
      nonbonded: walk.pairs.filter((p) => set.has(p.i) !== set.has(p.j)),
      surface: Array.from(surfaceAtoms),
      omegas: omega.filter((o) => straddles(o.probeAtoms)),
      ramas: ramaRows.filter((r) => straddles(r.phiAtoms) || straddles(r.psiAtoms)),
      chis: chis.filter((e) => straddles(e.atoms)),
      dihedrals: dihedralRows.filter((d) => straddles(d.atoms)),
    };
  };
  /* ⚠ LES COUPLES QU'UN PAS **CRÉE** — `walk` est la liste du champ, refaite tous les
     `rebuild` gestes : entre deux, les atomes ont bougé, donc un pas peut amener deux
     atomes à portée SANS que la marche le sache. Une décision prise sur elle seule ne peut
     donc pas voir l'empilement qu'elle vient de poser — c'est le défaut rapporté (« atoms
     can come too close and the LJ potential is not considered ») : le moteur gardait un
     couple à 1.34 Å et annonçait 46 kcal/mol là où le champ en lit 4737.
     LA RÉPONSE EST LOCALE ET EXACTE : les couples qui TRAVERSENT la charnière du pas se
     lisent sur la GÉOMÉTRIE VIVANTE — l'atome qui bouge à sa place d'ESSAI (`map`), celui
     qui ne bouge pas à sa place COURANTE (`x`) — et la topologie comme la portée sont
     celles du CHAMP (`ffExclusionSetsOf`, `ffPairReachOf`) : le moteur ne peut pas juger
     autre chose que la marche. Le coût est d'un test de distance par atome déplacé, pas
     une reconstruction de la marche (mesuré : 3.2 ms pour la marche entière d'un peptide à
     3.5 Å, contre quelques dizaines de µs ici — et le recuit fait 2448 pas).
     ⚠ DEUX ATOMES DU MÊME CÔTÉ SUBISSENT LA MÊME ROTATION RIGIDE : leur distance ne bouge
     pas d'un chiffre, c'est déjà la règle de `crossingOf` — ces couples-là n'entrent donc
     pas ici (et la marche les porte déjà quand elle les connaît). */
  const reach = ffPairReachOf(tf.pairLimit);
  const excl = ffExclusionSetsOf({ bonds: bondsOf, atomCount: count });
  const stepPairsOf = (ch, ctx, maps) => {
    const set = new Set(ch.movingAll || ch.moving || []);
    const known = new Set();
    for (const p of ctx.nonbonded) known.add(p.i < p.j ? p.i * count + p.j : p.j * count + p.i);
    const out = [];
    const seen = new Set();
    for (const map of maps) {
      if (!map || !map.size) continue;
      for (const [m, p] of map) {
        const one = excl.nb1[m]; const two = excl.nb2[m]; const three = excl.nb3[m];
        for (let j = 0; j < count; j += 1) {
          if (j === m || set.has(j)) continue;
          if (one.has(j) || two.has(j)) continue;          // 1-2, 1-3 : aucune physique
          const i = m < j ? m : j; const k = m < j ? j : m;
          const key = i * count + k;
          if (known.has(key) || seen.has(key)) continue;   // déjà dans la marche
          const d = Math.hypot(p[0] - x[j * 3], p[1] - x[j * 3 + 1], p[2] - x[j * 3 + 2]);
          if (!(d <= reach)) continue;                     // hors portée : le champ ne le lit pas non plus
          seen.add(key);
          out.push(ffPairOf(i, k, els, charges, three.has(j)));
        }
      }
    }
    return out;
  };
  /* ⚖ LE PLUS GRAND POIDS PARMI LES CONTRAINTES QUI TRAVERSENT UNE CHARNIÈRE — c'est lui
     qui décide du budget de couple que la dynamique accorde à la FAMILLE DES DISTANCES
     (voir `mdFrames`) : une ligne qui compte cent fois doit pouvoir tirer plus fort qu'une
     ligne qui compte une fois, sans que le plafond protégeant des murs de van der Waals ne
     l'en empêche. Rend 1 quand aucune contrainte ne traverse (le budget ordinaire). */
  const crossRestraintWeightOf = (ctx) => {
    let w = 1;
    for (const t of ctx.restraints) w = Math.max(w, ffRestraintWeightOf(t.weight));
    for (const x of ctx.walls) w = Math.max(w, ffRestraintWeightOf(x.weight));
    return w;
  };
  const crossCost = (ctx, map) => {
    let v = 0;
    for (const t of ctx.restraints) v += costRestraint(t, map);
    for (const w of ctx.walls) v += costWall(w, map);
    for (const p of ctx.nonbonded) v += costNonbonded(p, map);
    for (const i of ctx.surface) v += surfaceCostAt(i, map);
    for (const o of ctx.omegas) v += costOmega(o, map);
    for (const r of ctx.ramas) v += costRama(r, map);
    for (const e of ctx.chis) v += costChi(e, map);
    for (const d of ctx.dihedrals) v += costDihedral(d, map);
    return v;
  };
  /** LE COÛT DES SEULES CONTRAINTES QUI TRAVERSENT — les puits plats de la table ET les
   *  murs de la longe. Le couple de la dynamique en a besoin À PART : c'est la seule
   *  famille dont le plafond doit suivre le POIDS ⚖ de la ligne (voir `mdFrames`). */
  const crossRestraintCost = (ctx, map) => {
    let v = 0;
    for (const t of ctx.restraints) v += costRestraint(t, map);
    for (const w of ctx.walls) v += costWall(w, map);
    return v;
  };
  /* CE QU'UN PAS FAIT AU SEUL ω — la trempe refuse tout pas qui l'abîme, même s'il
     répare un empilement : elle a besoin de le lire À PART, donc le moteur le rend. */
  const omegaCrossCost = (ctx, map) => {
    let v = 0;
    for (const o of ctx.omegas) v += costOmega(o, map);
    return v;
  };
  /* LE COÛT TOTAL — la composition du champ, sans les murs de la longe ni les familles
     CONSTANTES du mouvement (liaisons, angles, cycles plans : `constants` les porte) :
     `costOf() + constants.total` EST l'enthalpie du champ, et un rapport avant/après
     reste donc comparable à celui du score. */
  const costOf = () => {
    let v = 0;
    for (const t of pairTerms) v += costRestraint(t, null);
    for (const p of walk.pairs) v += costNonbonded(p, null);
    /* 🎯 SANS TERME DE SURFACE, LA BOUCLE N'EXISTE PAS — 91 % du travail d'un pas, mesuré :
       une fonction cible qui n'a pas de famille non polaire (DYANA) ne la paie pas. */
    if (tf.surface) for (let i = 0; i < count; i += 1) v += surfaceCostAt(i, null);
    for (const o of omega) v += costOmega(o, null);
    for (const r of ramaRows) v += costRama(r, null);
    for (const e of chis) v += costChi(e, null);
    for (const d of dihedralRows) v += costDihedral(d, null);
    return v;
  };
  const wallCostOf = () => {
    let v = 0;
    for (const w of walls) v += costWall(w, null);
    return v;
  };
  /** LA GÉOMÉTRIE « À PLAT » D'UN CANAL PORTÉ À UN ANGLE DONNÉ — `{ok, reason, map,
   *  positions}`. La rotation est RIGIDE (`planTorsion`) et emmène les ATOMES AJOUTÉS
   *  de la partie qui tourne (`movingAll`) : longueurs, angles et cycles ne bougent pas
   *  d'un chiffre, donc rien de ce que le champ porte sur la chimie ne change. */
  const mapFor = (ch, angleDeg) => {
    const moving = ch.movingAll || ch.moving;
    const probe = ch.probeAtoms.map((k) => [x[k * 3], x[k * 3 + 1], x[k * 3 + 2]]);
    const plan = planTorsion({
      points: probe,
      moved: moving.map((k) => [x[k * 3], x[k * 3 + 1], x[k * 3 + 2]]),
      request: { angleDeg },
    });
    if (!plan.ok) return { ok: false, reason: plan.reason, map: null, positions: null };
    const map = new Map();
    const positions = new Float64Array(moving.length * 3);
    moving.forEach((k, c) => {
      const p = plan.positions[c];
      map.set(k, [p[0], p[1], p[2]]);
      positions[c * 3] = p[0]; positions[c * 3 + 1] = p[1]; positions[c * 3 + 2] = p[2];
    });
    return { ok: true, reason: 'ok', map, positions };
  };
  const commit = (map) => {
    for (const [k, p] of map) { x[k * 3] = p[0]; x[k * 3 + 1] = p[1]; x[k * 3 + 2] = p[2]; }
  };
  /* LES TRAVERSÉES SONT CACHÉES PAR CANAL — la molécule change, la liste des couples
     qui traversent une charnière non : la relire à chaque pas serait payer deux fois. */
  const ctxCache = new Map();
  const ctxOf = (ch, maps = null) => {
    const key = `${ch.i}-${ch.j}`;
    let ctx = ctxCache.get(key);
    if (!ctx) { ctx = crossingOf(ch); ctxCache.set(key, ctx); }
    if (!maps) return ctx;
    /* LES COUPLES DU PAS SONT AJOUTÉS À UNE COPIE — le ctx caché reste la marche du canal
       (les couples qui la traversent, lus une fois), et la copie ne coûte qu'un tableau.
       Le coût relu sur `null` (la géométrie ENGAGÉE) ne les compte pas : ils y sont hors de
       portée, donc à zéro dans le champ. C'est le PAS qui est jugé, pas le passé. */
    const extra = stepPairsOf(ch, ctx, Array.isArray(maps) ? maps : [maps]);
    if (!extra.length) return ctx;
    return { ...ctx, nonbonded: ctx.nonbonded.concat(extra) };
  };
  return {
    count, heavyCount, els, clean, chan, backbone, ramaRows, chis, omega, dihedralRows,
    x, weights, wRama, wChi, wWall, constants,
    /* ⚠ LES COORDONNÉES DU CALLER — LES ATOMES AJOUTÉS RESTENT DANS LE MOTEUR. Un
       appelant donne des atomes LOURDS et reçoit des atomes LOURDS : sans cette
       frontière, les hydrogènes ajoutés reviendraient dans la molécule de l'écran, qui
       les recompterait comme des atomes lourds et en rajouterait d'autres (mesuré :
       un couple « C–C » à 1.09 Å et un score de 10⁷ kcal/mol). */
    heavyPositions: () => x.slice(0, heavyCount * 3),
    /* LA MOLÉCULE PORTÉE — de quoi reconstruire un moteur à l'étape suivante SANS
       replacer les hydrogènes (voir le commentaire de tête). */
    moleculeOf: () => ({
      positions: Array.from(x), elements: els.slice(), bonds: bondsOf.map((b) => ({ ...b })),
      hydrogens: mol.hydrogens.map((h) => ({ parent: h.parent, index: h.index })),
    }),
    charges, added: { heavy: mol.heavy, hydrogens: mol.added, atoms: mol.atoms, skipped: mol.skipped },
    /* 🧪 LA CHIMIE QUE CE MOTEUR A LUE — le pH, l'écrasage ionique et la charge NETTE, tels
       quels : c'est ce que le rapport d'un geste cite (`chemistry`), donc un lecteur ne peut
       pas confondre le réglage qu'il a demandé avec celui qui a tourné. */
    chargeReport,
    chemistry: {
      ph: chargeReport.ph,
      ionicStrength: Number(ionicStrength) > 0 ? Number(ionicStrength) : 0,
      kappa: Number(kappa.toFixed(6)),
      debyeLength: kappa > 0 ? Number(ffDebyeLengthOf(kappa).toFixed(4)) : null,
      net: chargeReport.net, method: chargeReport.method,
      groups: chargeReport.ionisation ? chargeReport.ionisation.groups : [],
      atWork: !!(chargeReport.ionisation && chargeReport.ionisation.atWork),
    },
    /* 🎯 LA FONCTION CIBLE QUE CE MOTEUR A LUE — le rapport d'un geste la DIT, donc un
       lecteur ne peut pas prendre une famille éteinte pour une famille oubliée. */
    targetFunction: tf.id, targetFunctionLabel: tf.label, switchedOff: Array.from(tf.off || []),
    unitedAtoms: !addHydrogens,
    nonbondedCount: () => walk.pairs.length,
    /* 💧 CE QU'UN CORPS RIGIDE D'EAU A BESOIN DE LIRE — la marche VIVANTE des couples
       (`pairs`, refaite par `refreshCore`) et les trois réglages avec lesquels ils se
       lisent (le diélectrique et la fonction cible). Le module ne recopie donc rien : la
       PENTE d'un couple d'eau est celle du champ, terme à terme (`ffNonbondedGradientOf`).
       `bonds` est donné tel quel pour qu'une eau se reconnaisse par le GRAPHE (son O et ses
       deux H), jamais par une position devinée. */
    pairs: () => walk.pairs,
    nonbonded: { dielectric, repulsionOnly: tf.repulsionOnly, electrostatics: tf.electrostatics, kappa },
    bonds: bondsOf,
    at, gap, dihedralOf, mapFor, commit, crossingOf, ctxOf, crossCost, omegaCrossCost,
    crossRestraintCost, crossRestraintWeightOf,
    costOf, wallCostOf, walls,
    /* LA GRILLE DES COUPLES NON LIÉS EST REFaite PÉRIODIQUEMENT — les atomes ont bougé,
       donc les couples qui se touchent ne sont plus les mêmes. Les traversées CACHÉES
       sont jetées avec elle : elles portaient l'ANCIENNE liste, et une liste périmée vaut
       un moteur qui ne surveille plus rien. */
    refreshCore: () => {
      rebuild();
      ctxCache.clear();
      return walk.pairs.length;
    },
  };
};

/* ── 4ter · LA DYNAMIQUE MOLÉCULAIRE DIHÉDRALE (Langevin) ──────────────────────
   « add the force field and a Molecular dynamics option. this will help the final
   energy refinement. » La dynamique se fait dans l'espace des dièdres, comme le recuit
   et comme le protocole standard (XPLOR/CNS, CYANA) : un pas = une rotation RIGIDE
   autour d'une charnière. Il n'y a donc pas d'atome à déplacer librement, aucune
   liaison à recasser, et l'équation du mouvement tient en trois lignes.

   LE COUPLE est lu par DIFFÉRENCE FINIE — `τ = −[E(θ+δ) − E(θ−δ)] / 2δ`, avec δ =
   `torqueStep` degrés, sur les seuls termes qui traversent la charnière (c'est ce qui
   rend un pas abordable). La température est celle du palier courant, l'intégration est
   une Euler–Maruyama semi-implicite (le thermostat de Langevin : frottement γ et bruit
   dont l'amplitude `√(2γkT·dt/m)` est la relation de fluctuation–dissipation — il n'y a
   donc pas de second thermostat à recaler), et la masse `m` est l'inertie d'un dièdre.
   ⚠ `T` est en UNITÉS RÉDUITES (`k_B = 1`, l'énergie étant celle du champ) : ce n'est
   pas une température en kelvins, et le module ne prétend pas le contraire.
   ⚠ Les canaux sont balayés EN GAUSS–SEIDEL : chaque dièdre voit la géométrie qui
   existe au moment de son pas. C'est le choix de tous les moteurs en coordonnées
   internes, et c'est stable à ce pas de temps.

   GÉNÉRATEUR, comme le recuit : une image toutes les `perFrame` pas (et à la dernière),
   avec la température cinétique (`kinetic`), le potentiel (`potential`, la composition
   du recuit) et les murs de la longe rendus à part. `molecularDynamicsOf` le conduit
   d'un trait.
   🪢 `freeOmega` (voir `STRUCTURE_CALC_FREE_OMEGA`) fait tomber la seule règle qui visait
   ω : un pas qui augmente le coût d'une liaison peptidique est refusé TANT QUE l'option est
   fausse — c'est ce qui garde les peptides trans à 1500 K. Avec elle, la barrière d'ω reste
   une famille du champ (donc elle pèse dans le couple et l'énergie), et c'est le champ qui
   arbitre. Le plafond de 4° par pas, lui, ne bouge pas : ω se tourne toujours par petits pas. */

/** Le refus d'un mouvement — la même forme pour la dynamique et la minimisation : les
 *  coordonnées reçues sont rendues TELLES QUELLES (rien n'a bougé), et la raison est
 *  celle du module (`no-channel` : aucune charnière ; `no-step` : aucun pas demandé).
 *  `omegaFree` y est dit aussi : un refus doit porter le même réglage que le mouvement
 *  qu'il remplace, sinon rien ne se relit. */
const refusedMotion = (reason, engine = null, omegaFree = false) => ({
  ok: false,
  reason,
  positions: engine ? engine.x : null,
  channels: engine ? engine.chan.length : 0,
  omegaFree: !!omegaFree,
  steps: 0, applied: 0, skipped: 0, moved: 0,
  temperature: null,
  cost: { before: engine ? engine.costOf() : 0, after: engine ? engine.costOf() : 0 },
  walls: { before: 0, after: 0, count: 0 },
  trace: [],
  omega: null, rama: null, chi: null,
});

export function* mdFrames({
  positions = null, elements = [], bonds = [], restraints = [], weights = RELAX_WEIGHTS,
  channels = null, leash = null, torsions = null, omegas = null, dihedrals = [],
  ramaWeight = STRUCTURE_CALC_RAMA_WEIGHT, chiWeight = STRUCTURE_CALC_CHI_WEIGHT,
  seed = STRUCTURE_CALC_SEED, rng = null,
  steps = STRUCTURE_CALC_MD_STEPS,
  hot = STRUCTURE_CALC_MD_HOT, cold = STRUCTURE_CALC_MD_COLD,
  temperature = null,
  dt = STRUCTURE_CALC_MD_DT, friction = STRUCTURE_CALC_MD_FRICTION,
  mass = STRUCTURE_CALC_MD_MASS, torqueStep = STRUCTURE_CALC_MD_TORQUE_STEP,
  maxTorqueLimit = STRUCTURE_CALC_MD_MAX_TORQUE,
  maxRestraintTorqueLimit = STRUCTURE_CALC_MD_MAX_RESTRAINT_TORQUE,
  speedLimit = STRUCTURE_CALC_MD_MAX_SPEED,
  speedFactorLimit = STRUCTURE_CALC_MD_SPEED_FACTOR,
  stepLimitDeg = STRUCTURE_CALC_MD_MAX_STEP_DEG,
  omegaStepLimitDeg = STRUCTURE_CALC_MD_OMEGA_STEP_DEG,
  /* 🪢 ω VARIE — l'option de l'utilisateur (`STRUCTURE_CALC_FREE_OMEGA`) : la dynamique ne
     refuse plus un pas qui augmente le coût d'une liaison peptidique, et c'est la barrière du
     champ qui décide. ⚠ Le PLAFOND de 4° par pas reste : ω se tourne par PETITS pas, l'option
     dit seulement qu'il a le DROIT de s'écarter de trans. */
  freeOmega = STRUCTURE_CALC_FREE_OMEGA,
  channelBudget = STRUCTURE_CALC_MD_CHANNELS,
  perFrame = STRUCTURE_CALC_MD_FRAME, coreRefresh = STRUCTURE_CALC_CORE_REFRESH,
  /* 💧 LE DIÉLECTRIQUE — le seul réglage de solvant que ce moteur possède vraiment,
     plus 🎯 LA FONCTION CIBLE (classic / DYANA). Les deux traversent le couple par
     `torsionEngineOf`, qui les comprend depuis toujours. Le défaut est le modèle du champ
     (ε = 4, fonction `classic`), donc les appels qui ne les demandent pas ne changent pas
     de physique d'un iota. */
  dielectric = FF_DIELECTRIC,
  targetFunction = STRUCTURE_CALC_TARGET_FUNCTION,
  /* ⚠ LE SEUIL DES CLASH — la MÊME constante que le calcul de structure
     (`RELAX_CLASH_DISTANCE`, 1,45 Å : « deux atomes que le graphe ne lie pas et qui se
     retrouvent plus près que ça : ce n'est pas deux atomes côte à côte, c'est un atome
     passé À TRAVERS un autre »). La dynamique LIT ce chiffre et l'ÉCRIT dans son rapport
     (voir `clashes` ci-dessous) : la demande de cette session est exactement celle-là —
     « riporta solo i clash » — parce que l'œil voit des sphères qui se compénètrent et
     que le rapport, lui, se taisait. Un appelant peut poser un autre seuil, jamais un
     autre lecteur : `clashReportOf` reste la seule définition d'un empilement. */
  clashDistance = RELAX_CLASH_DISTANCE,
  hydrogen = null,
  /* 💧 LES EAUX BOUGENT — l'option du module (`STRUCTURE_CALC_WATER_MOBILE`, vraie) : s'il
     y a des eaux EXPLICITES, elles ont leurs six degrés de liberté (voir
     `waterRigidBodyOf`) et avancent à CHAQUE pas, pendant que les dièdres font ce qu'ils
     font. Un moteur SANS eau ne paie rien — ni objet, ni tirage — donc sa trajectoire est,
     au chiffre près, exactement celle d'avant cette décision. */
  waterMobile = STRUCTURE_CALC_WATER_MOBILE,
  waterRefresh = STRUCTURE_CALC_WATER_REFRESH,
  /* 🧪 LE pH ET LA FORCE IONIQUE — les deux réglages de la CHIMIE du champ (voir §2bis et §4bis
     de utils/forceFieldKcal.js) : cette fenêtre les reçoit du panneau ⚙ et les descend au
     moteur commun, le même que le ▶ Run et le ⚒ — un geste ne peut donc pas tourner dans une
     autre chimie que celle que la molécule affiche. */
  ph = FF_PH_DEFAULT, ionicStrength = FF_IONIC_STRENGTH_DEFAULT,
} = {}) {
  const engine = torsionEngineOf({
    positions, elements, bonds, restraints, weights, channels, leash, torsions, omegas, dihedrals,
    ramaWeight, chiWeight, hydrogen, dielectric, targetFunction, ph, ionicStrength,
  });
  if (!engine) return refusedMotion('bad-points', null, freeOmega);
  const chan = engine.chan;
  const n = clampInt(steps, 0, 1000000, STRUCTURE_CALC_MD_STEPS);
  if (!chan.length || !n) return refusedMotion(chan.length ? 'no-step' : 'no-channel', engine, freeOmega);
  /* 💧 LES EAUX DEVIENNENT DES CORPS RIGIDES — la décision de cette session : la boîte
     explicite n'est plus un décor, ses molécules TRANSLATENT et TOURNENT sous le même
     Langevin que les dièdres (voir `waterRigidBodyOf`). Le corps est construit sur `x` VIVANT
     du moteur, donc il écrit ses positions au même endroit que le champ les lit : chaque
     image de la dynamique les porte déjà. ⚠ Un moteur sans eau rend `null` et RIEN de ce
     bloc n'a lieu (`water` nul dans le rapport) — le geste d'une molécule nue est celui
     d'avant, au chiffre près. */
  const waters = waterMobile === false ? null : (() => {
    const body = waterRigidBodyOf({
      positions: engine.x, elements: engine.els, bonds: engine.bonds,
      /* ⚠ LA GRAINE DES EAUX EST DÉCALÉE de celle des dièdres (`+ 137`, la convention des
         paliers du protocole qui font `+ 23` et `+ 29`) : les deux moitiés du moteur ne
         tirent donc pas LES MÊMES nombres, et la trajectoire reste reproductible au chiffre
         près (le bruit des eaux vient de `makeRelaxRandom`, pas de `Math.random`). */
      seed: wrapSeed(Number(seed) + 137),
    });
    return body.ok ? body : null;
  })();
  /* LA CADENCE DE RELECTURE DES COUPLES DES EAUX — la marche est en O(N²), elle n'est donc
     pas refaite à chaque pas ; une eau avance de ~0.08 Å par pas, donc elle est relue bien
     avant d'avoir franchi la portée du champ. */
  const waterEvery = Math.max(1, Math.round(
    Number.isFinite(Number(waterRefresh)) ? Number(waterRefresh) : STRUCTURE_CALC_WATER_REFRESH));
  /* ⚠ LE BUDGET DE CANAUX PAR PAS — un pas de dynamique ne tourne PAS les trois cents
     dièdres d'une protéine : il en tourne un ÉCHANTILLON (24 par défaut). Chaque degré
     de liberté est donc mis à jour tous les `(canaux/24)` pas, avec le MÊME bruit : le
     thermostat ne change pas, le coût d'un pas, si (mesuré sur une chaîne de vingt
     carbones : 9.5 ms par pas à dix-sept canaux). La fenêtre TOURNE (`t·budget` modulo le
     nombre de canaux), donc aucun canal n'est oublié et la trajectoire reste déterministe. */
  const budget = Math.max(1, Math.min(chan.length,
    clampInt(channelBudget, 1, 1000000, STRUCTURE_CALC_MD_CHANNELS)));
  const turnOf = (t) => {
    if (budget >= chan.length) return chan;
    const from = (t * budget) % chan.length;
    const out = [];
    for (let k = 0; k < budget; k += 1) out.push(chan[(from + k) % chan.length]);
    return out;
  };
  /** LES INDICES DE LA FENÊTRE — la vitesse d'un dièdre est indexée par SA place dans la
   *  liste des canaux, donc la fenêtre se parcourt en indices (pas en références). */
  const turnIndexes = (t) => {
    if (budget >= chan.length) return chan.map((_, k) => k);
    const from = (t * budget) % chan.length;
    const out = [];
    for (let k = 0; k < budget; k += 1) out.push((from + k) % chan.length);
    return out;
  };
  /* QUEL CANAL EST UNE LIAISON PEPTIDIQUE — son pas est plus fin que les autres. */
  const omegaBond = new Set(engine.omega.map((o) => (o.c < o.n ? `${o.c}-${o.n}` : `${o.n}-${o.c}`)));
  const random = typeof rng === 'function' ? rng : makeRelaxRandom(wrapSeed(seed));
  /* LE BRUIT — deux tirages uniformes par composante (Box–Muller), tirés du générateur
     du dossier : la même graine donne donc la même trajectoire, au pas près. */
  const gaussian = () => {
    let u = 0; let v = 0;
    while (u === 0) u = random();
    while (v === 0) v = random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const h = Math.max(1e-4, Number(dt) || STRUCTURE_CALC_MD_DT);
  /* ⚠ LE PAS EFFECTIF D'UN CANAL — LE TEMPS QU'IL A RÉELLEMENT SAUTÉ.
     La fenêtre ne tourne que `budget` canaux par pas : un canal est donc mis à jour tous les
     `canaux/budget` pas. L'intégrer avec `dt` comme s'il avait été tourné à CHAQUE pas lui
     fait vivre une trajectoire `canaux/budget` fois plus courte que celle que le rapport
     annonce (« pas × dt ») — et c'est MESURÉ : sur l'ubiquitine (378 canaux, fenêtre de 24,
     300 pas de 0.01 ps), l'excursion TOTALE de chaque dièdre pendant toute la trajectoire
     valait 1.4° en moyenne pour les χ1 (pendant que le squelette atteignait 13.6°) — les
     chaînes latérales paraissent BLOQUÉES, exactement la remarque de cette session (« I think
     that only phi and psi are varied, all the other dihedrals look blocked ») et la même
     signature que la session du plafond de couple (« χ1 figé à 5° »).
     Chaque canal intègre donc l'intervalle qu'il a sauté, `h_eff = dt × canaux/budget`
     (borné par `STRUCTURE_CALC_MD_MAX_SKIP`, une borne de stabilité) : le bruit, la friction
     ET la réponse au champ portent sur le même intervalle, ce qui est cohérent au sens de
     Langevin (le plafond de couple suit `√(R·T·m)/h_eff`, comme il suit `.../h` — c'est le
     couple qui renverse UNE vitesse thermique EN UN pas, donc il tient encore le thermostat).
     ⚠ AUCUN COÛT EN PLUS : c'est le même nombre d'évaluations, seule l'ÉCHELLE change. Et
     ⚠ UNE MOLÉCULE DONT TOUS LES CANAUX TIENNENT DANS LA FENÊTRE (`canaux ≤ 24`) A
     `h_eff = h` EXACTEMENT : sa trajectoire est, au chiffre près, celle d'avant ce
     changement — c'est pourquoi les sondes et les tests du dossier (8 à 17 canaux) ne
     bougent pas. */
  const skip = Math.min(chan.length / Math.max(1, budget), STRUCTURE_CALC_MD_MAX_SKIP);
  const hEff = h * skip;
  const gamma = Math.max(0, Number(friction) || STRUCTURE_CALC_MD_FRICTION);
  const m = Math.max(1e-6, Number(mass) || STRUCTURE_CALC_MD_MASS);
  const delta = Math.max(0.05, Math.abs(Number(torqueStep) || STRUCTURE_CALC_MD_TORQUE_STEP));
  /* ⚠ LES PLAFONDS SONT DES CEILINGS, PLUS DES PLAFONDS EN DUR — et sans plancher
     arbitraire : le plafond qui COMPTE est dynamique (`capsOf`, il suit T et m), ceux-ci ne
     sont là que pour qu'un cas pathologique n'explose pas. L'ancien `Math.max(1, …)` rendait
     d'ailleurs le plafond dynamique INOPÉRANT : mesuré, deux budgets de couple différents
     (1 et 2 vitesses thermiques) donnaient des trajectoires identiques, parce que les deux
     tombaient sous 1. */
  const maxTorque = Math.abs(Number(maxTorqueLimit)) || STRUCTURE_CALC_MD_MAX_TORQUE;
  const maxRestTorque = Math.max(maxTorque,
    Math.abs(Number(maxRestraintTorqueLimit)) || STRUCTURE_CALC_MD_MAX_RESTRAINT_TORQUE);
  const maxSpeed = Math.max(0.1, Math.abs(Number(speedLimit) || STRUCTURE_CALC_MD_MAX_SPEED));
  const speedFactor = Math.max(0.1, Math.abs(Number(speedFactorLimit) || STRUCTURE_CALC_MD_SPEED_FACTOR));
  const maxStepDeg = Math.max(0.1, Math.abs(Number(stepLimitDeg) || STRUCTURE_CALC_MD_MAX_STEP_DEG));
  const omegaStepDeg = Math.max(0.1, Math.abs(Number(omegaStepLimitDeg) || STRUCTURE_CALC_MD_OMEGA_STEP_DEG));
  /* ⚠ `temperature == null` D'ABORD — `Number(null)` vaut 0, et un thermostat à 0 °
     réduit gèlerait la dynamique au lieu de la laisser recuire : le défaut est le PLAN
     (hot → cold), et une température FIXE n'existe que si on la demande vraiment. */
  const fixedT = temperature == null || !Number.isFinite(Number(temperature))
    ? null : Math.max(0, Number(temperature));
  /* ⚠ MÊME RÈGLE POUR LES DEUX BOUTS DU PLAN : un `null` n'est pas un zéro. */
  const numOr = (v, fallback) => (v == null || !Number.isFinite(Number(v)) ? fallback : Number(v));
  const hotT = Math.max(0, numOr(hot, STRUCTURE_CALC_MD_HOT));
  const coldT = Math.max(0, numOr(cold, STRUCTURE_CALC_MD_COLD));
  const every = Math.max(1, clampInt(perFrame, 0, Math.max(1, n), 0) || STRUCTURE_CALC_MD_FRAME);
  const rebuildEvery = Math.max(1, Math.round(coreRefresh) || STRUCTURE_CALC_CORE_REFRESH);
  /* LE SEUIL DES CLASH, normalisé comme tous les réglages de ce geste — un nombre
     illisible retombe sur la constante du module, et c'est CE chiffre-là que le rapport
     écrit (`clashes.minDistance`), donc un lecteur ne peut pas confondre le seuil annoncé
     avec celui qu'il a demandé. */
  const clashMin = Number(clashDistance) > 0 ? Number(clashDistance) : RELAX_CLASH_DISTANCE;
  /* LE PLAN DE TEMPÉRATURE, EN KELVINS — géométrique (chaud d'abord, froid à la fin), ou
     FIXE quand une température est demandée : c'est la phase d'ÉQUILIBRATION d'un
     protocole standard (la dynamique tient T le temps que la conformation s'installe),
     et le refroidissement est ce qui la pose dans un minimum. */
  const targetAt = (t) => {
    if (fixedT != null) return fixedT;
    if (n <= 1) return coldT;
    return hotT * Math.pow(Math.max(1e-9, coldT / Math.max(1e-9, hotT)), t / (n - 1));
  };
  /* L'ÉCHELLE DU MOTEUR — LA VITESSE THERMIQUE, ET LE PLAFOND QUI DOIT LA RENVERSER.
     `√(R·T/m)` est la vitesse d'un canal à la température du palier ; c'est elle qui donne
     le bruit (fluctuation–dissipation) et le pas thermique. Le plafond du couple n'est PAS
     `γ·m·v` : c'est CE QU'IL FAUT POUR RENVERSER cette vitesse EN UN PAS, `m·v/h =
     √(R·T·m)/h`. La différence n'est pas cosmétique, elle est MESURÉE :
       • avec `γ·m·v` (0.17 kcal/mol/deg à 1500 K), le champ ne pouvait répondre que
         0.69 °/ps par pas à un bruit de 6.9 °/ps — un mur de van der Waals était donc
         TRANSPARENT : deux atomes se traversaient, restaient empilés (1.3 Å mesuré) et le
         potentiel restait figé à 12 000 kcal/mol après 300 pas ;
       • avec `√(R·T·m)/h` (8.6 kcal/mol/deg à 1500 K), le mur renverse la vitesse
         thermique DANS le pas, et c'est un mur : la même trajectoire ne descend plus sous
         `r_min` (voir `_md_wall_test.mjs`).
     ⚠ LE PLAFOND SUIT TOUJOURS T (et m) : il grandit comme √T, c'est-à-dire avec le bruit
     qu'il doit contenir. Un plafond ABSOLU de 50 kcal/mol/deg reste le CEILING ; il n'est
     plus la valeur de tous les jours. ⚠ LA FAMILLE DES DISTANCES, elle, garde son budget
     absolu (voir `STRUCTURE_CALC_MD_MAX_RESTRAINT_TORQUE`). */
  const capsOf = (T) => {
    const kT = FF_GAS_CONSTANT * Math.max(0, T);
    const vThermal = Math.sqrt(kT / m);
    const vSpeed = Math.min(maxSpeed, speedFactor * vThermal);
    /* `√(R·T·m)/h` — le couple qui annule une vitesse thermique en UN pas. ⚠ `hEff` (et non
       `h`) : « un pas » veut dire l'intervalle que le canal intègre VRAIMENT (voir `hEff`). */
    const vReverse = Math.sqrt(kT * m) / hEff;
    const wall = speedFactor * vReverse;
    return {
      vThermal, vSpeed, wall,
      torque: Math.min(maxTorque, Math.max(gamma * m * vSpeed, wall)),
    };
  };
  const vel = new Float64Array(chan.length);
  const trace = [];
  const readAll = () => ({
    cost: engine.costOf(),
    walls: engine.wallCostOf(),
    omega: omegaPenaltyOf({ positions: engine.x, omegas: engine.omega }),
    rama: ramaPenaltyOf({ positions: engine.x, torsions: engine.backbone, weight: engine.wRama }),
    chi: chiPenaltyOf({ positions: engine.x, chis: engine.chis, weight: engine.wChi }),
    dihedral: dihedralPenaltyOf({ positions: engine.x, dihedrals: engine.dihedralRows }),
  });
  /* ⚠ LES CLASH DE LA DYNAMIQUE — LE MÊME LECTEUR QUE LE CALCUL DE STRUCTURE
     (`clashReportOf`, `RELAX_CLASH_DISTANCE`), lu sur la géométrie que CE GESTE ÉCRIT :
     `engine.heavyPositions()` est ce que l'appelant a donné (donc ce qui s'écrit à
     l'écran et ce que le geste suivant relit), et les liaisons sont les SIENNES — le
     graphe du fichier, jamais celui des hydrogènes que le champ ajoute pour lui. Un
     rapport qui compterait les atomes ajoutés parlerait d'atomes que PERSONNE ne voit
     (mesuré sur la sonde du dossier : le compte change du simple au double selon la
     géométrie donnée) ; c'est pourquoi le chiffre rendu est celui de l'écran, et la
     phrase du panneau le DIT (voir le rapport du 🌡 dans le viewer).
     ⚠ CE N'EST PAS UNE CONTRAINTE : la dynamique ne refuse rien pour ça — elle MESURE
     (la décision de cette session : « riporta solo i clash »). Le mur qui repousse les
     atomes reste le Lennard-Jones du champ, plafonné comme avant. */
  const clashReadingOf = () => clashReportOf({
    positions: engine.heavyPositions(), bonds, minDistance: clashMin,
  });
  const before = readAll();
  let applied = 0; let skipped = 0; let kinetic = 0;
  /* COMBIEN D'IMAGES DU GESTE ONT MONTRE UN EMPILEMENT, ET LE PIRE VU PENDANT LA
     TRAJECTOIRE — l'écran montre une image toutes les `perFrame` pas : un empilement qui
     vit trois pas entre deux images ne se voit pas plus qu'il ne se lisait. Celui-ci se
     compte donc AUX IMAGES, sur la même géométrie qu'elles.
     ⚠ À DISTANCE ÉGALE, LE RAPPORT GARDE LA PREMIÈRE IMAGE (`<`, jamais `<=`) : le pas
     cité est donc reproductible, et il ne saute pas d'une exécution à l'autre parce que
     deux images portaient le même empilement. */
  let clashFrames = 0; let clashImages = 0; let worstClash = null;
  for (let t = 0; t < n; t += 1) {
    const target = targetAt(t);
    const caps = capsOf(target);
    /* LE PAS — les canaux de la FENÊTRE du moment, un après l'autre (Gauss–Seidel). */
    const woken = turnIndexes(t);
    for (const k of woken) {
      const ch = chan[k];
      const cur = engine.dihedralOf(ch.probeAtoms, null);
      if (!Number.isFinite(cur)) { skipped += 1; continue; }
      const up = engine.mapFor(ch, cur + delta);
      const down = engine.mapFor(ch, cur - delta);
      if (!up.ok || !down.ok) { skipped += 1; continue; }
      /* ⚠ LE CTX PORTE AUSSI LES COUPLES QUE CE PAS **CRÉE** (`stepPairsOf` sur les DEUX
         pas d'essai) : le mur de van der Waals qui vient de se former est alors DANS le
         couple, lu sur la géométrie vivante, au lieu d'attendre la réfection de la marche
         (vingt-quatre pas). C'est lui qui repousse les deux atomes — et il est plafonné
         comme le reste (`capped`), donc l'intégrateur ne fait pas de bond. */
      const ctx = engine.ctxOf(ch, [up.map, down.map]);
      /* LE COUPLE, PAR DIFFÉRENCE FINIE CENTRÉE — la pente du champ le long de CE
         dièdre, prise sur les seuls termes qui le traversent. */
      const torque = -(engine.crossCost(ctx, up.map) - engine.crossCost(ctx, down.map)) / (2 * delta);
      /* ⚖ LA FAMILLE DES DISTANCES GARDE SON PROPRE BUDGET, ABSOLU, ET IL SUIT LE POIDS ⚖
         DE LA LIGNE (voir `STRUCTURE_CALC_MD_MAX_RESTRAINT_TORQUE`) : elle ne suit PAS la
         température, et c'est voulu — une distance demandée est une MOLA DURE (« la distance
         demandée est bien respectée à l'arrivée »), pas une agitation thermique. Tant qu'une
         ligne est violée, c'est ELLE qui conduit le pas ; dès qu'elle est tenue son couple
         tombe à zéro et c'est la thermostate — la vitesse du palier — qui reprend la main :
         c'est précisément la structure CORRECTE de la remarque de cette session, où la
         molécule bougeait encore. Mesuré : une ligne de poids 100 tire plus fort qu'une ligne
         de poids 1 (erreur finale 0.244 Å contre 0.332 Å sur une contrainte fausse de 1.5 Å). */
      const torqueRest = -(engine.crossRestraintCost(ctx, up.map)
        - engine.crossRestraintCost(ctx, down.map)) / (2 * delta);
      const restCap = Math.min(maxRestTorque, maxTorque * engine.crossRestraintWeightOf(ctx));
      const clampT = (v, cap) => Math.max(-cap, Math.min(cap, v));
      /* ⚠ LE COUPLE EST PLAFONNÉ — un mur de Lennard-Jones à 1 Å d'un autre atome vaut
         des millions de kcal/mol/deg, et l'intégrateur ferait un bond de plusieurs tours :
         c'est la cause des modèles empilés (mesuré : des scores de 10⁷ kcal/mol après une
         dynamique à 3000 K). Le plafond du palier, lui, vaut `γ·m·f·√(R·T/m)` : à 1500 K
         c'est 0.52 kcal/mol/deg, soit la vitesse `f·√(R·T/m)` = 103 °/ps. Le garde-fou
         absolu (`maxTorque`) reste le ceiling, jamais le plafond de tous les jours. */
      const capped = clampT(torqueRest, restCap) + clampT(torque - torqueRest, caps.torque);
      /* ⚠ `hEff` (et non `h`) DANS LES TROIS TERMES — le bruit, la friction et la réponse au
         champ portent sur l'intervalle que ce canal a réellement sauté (voir `hEff`). */
      const noise = Math.sqrt((2 * gamma * FF_GAS_CONSTANT * target * hEff) / m) * gaussian();
      const v = vel[k] * (1 - gamma * hEff) + (capped / m) * hEff + noise;
      vel[k] = v;
      if (Math.abs(v) > maxSpeed) vel[k] = Math.sign(v) * maxSpeed;
      if (Math.abs(vel[k] * hEff) < 1e-9) continue;
      /* …ET LE PAS AUSSI — quel que soit le couple, un dièdre ne tourne pas de plus d'un
         pas MAX par itération (`maxStepDeg`) : la rotation reste une rotation, jamais un
         saut de conformation. ⚠ UNE LIAISON PEPTIDIQUE A SON PROPRE PAS (4°) : sa barrière
         vaut 20 kcal/mol à 90° de trans, et un pas de 20° la franchirait par diffusion à
         1500 K (mesuré : un ω posé à 0.4° de trans finissait à 123.8° après le protocole).
         C'est le même choix que le recuit, qui tourne ω par pas de 12°. */
      const cap = omegaBond.has(ch.i < ch.j ? `${ch.i}-${ch.j}` : `${ch.j}-${ch.i}`)
        ? omegaStepDeg : maxStepDeg;
      const turn = Math.max(-cap, Math.min(cap, vel[k] * hEff));
      /* ⚠ UNE LIAISON PEPTIDIQUE NE S'ISOMÉRISE PAS DANS CETTE DYNAMIQUE — à 1500 K le
         plateau de ± 30° de ω laisse un ω franchir sa barrière par diffusion (mesuré : un ω
         à 0.4° de trans finissait CIS après 300 pas) alors qu'un vrai peptide reste trans à
         cette température. Un pas qui AUGMENTE le coût d'ω est donc refusé pour ce
         canal-là — les φ/ψ et les χ1, eux, explorent librement. C'est le même choix que la
         trempe (`protectOmega`), appliqué à toute la dynamique.
         🪢 …SAUF si l'utilisateur a demandé que ω VARIE (`freeOmega`) : la règle tombe pour
         ce canal, la barrière reste une famille du champ (donc elle pèse dans le couple), et
         c'est le champ qui arbitre. */
      const isPeptideCh = omegaBond.has(ch.i < ch.j ? `${ch.i}-${ch.j}` : `${ch.j}-${ch.i}`);
      if (isPeptideCh && !freeOmega) {
        const now = ffOmegaCostOf(cur, { target: STRUCTURE_CALC_OMEGA });
        const next = ffOmegaCostOf(((cur + turn + 540) % 360) - 180, { target: STRUCTURE_CALC_OMEGA });
        if (next > now + 1e-9) { skipped += 1; continue; }
      }
      const move = engine.mapFor(ch, ((cur + turn + 540) % 360) - 180);
      if (!move.ok) { skipped += 1; continue; }
      engine.commit(move.map);
      applied += 1;
    }
    if (t % rebuildEvery === rebuildEvery - 1) engine.refreshCore();
    /* 💧 LES EAUX, APRÈS LES DIÈDRES — GAUSS–SEIDEL : le pas qui vient de tourner les
       charnières a lu la géométrie des eaux (elles sont dans sa liste de couples), et les
       eaux lisent maintenant la géométrie que ce pas vient de poser. ⚠ La marche est
       refaite tous les `waterEvery` pas (elle est en O(N²)) : une eau avance de ~0.08 Å par
       pas, donc elle est relue bien avant d'avoir franchi la portée du champ. ⚠ Le pas des
       eaux est `h`, PAS `hEff` : une eau bouge à CHAQUE pas (voir `waterRigidBodyOf`). */
    if (waters) {
      if (t % waterEvery === 0) engine.refreshCore();
      waters.step({
        pairs: engine.pairs(), options: engine.nonbonded,
        dt: h, temperature: target, friction: gamma,
      });
    }
    /* LA TEMPÉRATURE CINÉTIQUE — équipartition dans les unités du champ : l'énergie
       cinétique moyenne d'un dièdre vaut ½·m·v² = ½·R·T, donc T[cine] = m·Σv²/(n·R). */
    let sum = 0;
    for (let k = 0; k < chan.length; k += 1) sum += m * vel[k] * vel[k];
    kinetic = chan.length ? sum / (chan.length * FF_GAS_CONSTANT) : 0;
    if (t % every === every - 1 || t === n - 1) {
      const potential = engine.costOf();
      const walls = engine.wallCostOf();
      /* L'IMAGE QUI S'ÉCRIT VA ÊTRE VUE — elle est donc lue comme un empilement ELLE
         AUSSI, par le même lecteur et sur la même géométrie (voir `clashReadingOf`) : un
         seul `clashReportOf` par image, jamais un par pas. */
      const seen = clashReadingOf();
      clashImages += 1;
      if (seen.count) clashFrames += 1;
      if (seen.worst && (!worstClash || seen.worst.distance < worstClash.distance)) {
        worstClash = {
          i: seen.worst.i, j: seen.worst.j,
          distance: seen.worst.distance, step: t + 1,
        };
      }
      const frame = {
        phase: 'md', positions: engine.heavyPositions(), step: t + 1, of: n,
        temperature: Number(target.toFixed(6)), kinetic: Number(kinetic.toFixed(6)),
        potential: Number(potential.toFixed(6)), walls: Number(walls.toFixed(6)),
        total: Number((potential + walls).toFixed(6)),
        applied, skipped, dt: h,
        /* 💧 LES EAUX DE CETTE IMAGE — ce qu'elles ont fait depuis le départ (`null` quand
           il n'y en a pas : le rapport n'invente pas un zéro). La température cinétique est
           MESURÉE sur leurs vitesses, translation et rotation séparément. */
        water: waters ? waters.stats() : null,
      };
      trace.push({
        step: frame.step, temperature: frame.temperature,
        kinetic: frame.kinetic, potential: frame.potential,
      });
      yield frame;
    }
  }
  /* …ET LA MÊME RÈGLE ICI : la liste est refaite avant le dernier chiffre, pour que le
     coût rendu soit comparable à celui de l'étape suivante du protocole. */
  engine.refreshCore();
  const after = readAll();
  let moved = 0;
  for (let k = 0; k < chan.length; k += 1) if (Math.abs(vel[k]) > 1e-12) moved += 1;
  /* LES PLAFONDS DU DERNIER PALIER — ce sont EUX que la trajectoire a réellement subis, et
     ils suivent T et m : le rapport les donne à côté des garde-fous absolus, donc un lecteur
     peut refaire le calcul (`τ = γ·m·f·√(R·T/m)`) au lieu de croire à un chiffre en dur. */
  const endCaps = capsOf(targetAt(Math.max(0, n - 1)));
  /* LE CLASH DE LA GÉOMÉTRIE RENDUE — celle que ce geste laisse à l'écran et que le geste
     suivant relira : le même lecteur que le calcul de structure, le même seuil, et la
     géométrie que l'œil voit (voir `clashReadingOf`). */
  const finalClashes = clashReadingOf();
  return {
    ok: true, reason: 'ok',
    positions: engine.heavyPositions(),
    channels: chan.length,
    omegaFree: !!freeOmega,
    steps: n, applied, skipped, moved,
    /* 💧 CE QUE LES EAUX ONT FAIT — `null` quand il n'y en a pas (le rapport le DIT au lieu
       d'inventer un zéro) : combien de molécules, combien ont bougé, de combien en moyenne
       (déplacement net et carré moyen), de quel angle elles ont tourné, et la température
       cinétique MESURÉE des deux moitiés du thermostat — translation ET rotation. C'est la
       vérification que le rapport peut citer au lieu de promettre. */
    water: waters ? waters.stats() : null,
    waterMobile: !!waters,
    /* 🧪 LA CHIMIE DE CETTE TRAJECTOIRE — le pH lu, l'écrantage ionique et la charge nette du
       modèle : la fenêtre 🌡 les écrit au lieu de laisser croire que le réglage a été oublié. */
    chemistry: engine.chemistry,
    /* ⚠ LA FENÊTRE ET SON PAS EFFECTIF — `budget` canaux tournés par pas (la constante du
       dossier), donc un canal est mis à jour tous les `skip` pas et il intègre `dtEff = dt ×
       skip` (voir `hEff`) : le rapport peut donc dire la VRAIE échelle du moteur au lieu de
       laisser croire que chaque canal a vécu les `steps` pas annoncés. `window: false` quand
       tous les canaux tiennent dans la fenêtre — c'est alors la dynamique d'avant, au chiffre
       près. */
    budget,
    skip: Number(skip.toFixed(6)),
    dtEff: Number(hEff.toFixed(6)),
    windowed: skip > 1,
    temperature: {
      mode: fixedT != null ? 'fixed' : 'annealed',
      hot: fixedT != null ? fixedT : hotT, cold: fixedT != null ? fixedT : coldT,
      kinetic: Number(kinetic.toFixed(6)),
      mean: Number((trace.reduce((s, r) => s + r.kinetic, 0) / Math.max(1, trace.length)).toFixed(6)),
      dt: h, friction: gamma, mass: m, torqueStep: delta,
      /* LA VITESSE THERMIQUE DU DERNIER PALIER — `√(R·T/m)`, l'échelle du moteur : c'est
         elle qui dit si le palier peut bouger (34.5 °/ps à 1500 K avec l'inertie du dossier). */
      thermal: Number(endCaps.vThermal.toFixed(6)),
      speed: Number(endCaps.vSpeed.toFixed(6)),
      factor: speedFactor,
      units: FF_KCAL_UNITS.temperature,
    },
    /* LA LONGUEUR NOMINALE DE LA TRAJECTOIRE — pas × dt, en picosecondes : c'est le
       chiffre que le panneau appelle « total simulation time », et il est calculé ICI
       (une seule multiplication dans le dossier). */
    time: structureCalcSimulationTimeOf({ steps: n, dt: h }),
    /* LES FAMILLES QUE LE MOUVEMENT NE PEUT PAS CHANGER (liaisons, angles, cycles
       plans) — le coût rendu par le moteur est celui qui BOUGE, et le score ajoute ces
       constantes : `cost + constants.total` est l'enthalpie du champ. */
    constants: engine.constants,
    added: engine.added,
    /* 🎯 LA FONCTION CIBLE CONDUITE, ET 💧 SI LE MOTEUR A LU DES EAUX EXPLICITES —
       le rapport les écrit, donc un lecteur sait dans quel monde la trajectoire a couru. */
    targetFunction: engine.targetFunction,
    targetFunctionLabel: engine.targetFunctionLabel,
    switchedOff: engine.switchedOff,
    unitedAtoms: engine.unitedAtoms,
    waters: ffWatersIn(engine.els || []),
    /* ⚖ LES PLAFONDS DE COUPLE — les GARDE-FOUS ABSOLUS (le champ, la table) et ceux du
       DERNIER PALIER, qui suivent T et m : montrés pour que le rapport puisse dire QUE le
       poids ⚖ d'une ligne a un effet mesurable sur la trajectoire, ET que le mur de van der
       Waals avait de quoi répondre au thermostat (`wall` = le couple qui renverse une
       vitesse thermique en un pas ; `dynamic` = ce que la trajectoire a réellement subi). */
    torque: {
      field: maxTorque, restraint: maxRestTorque,
      dynamic: Number(endCaps.torque.toFixed(6)), factor: speedFactor,
      wall: Number(endCaps.wall.toFixed(6)),
    },
    /* ⚠ LES CLASH — CE QUE LE GESTE A LAISSÉ, ET CE QUE LA TRAJECTOIRE A MONTRÉ.
       `count`/`worst` sont la lecture de la géométrie RENDUE (celle qui reste à l'écran) ;
       `frames`/`images` disent combien des images du geste en portaient un ; `worstDuring`
       est le pire vu PENDANT la trajectoire, avec le pas où il a été vu. Le LECTEUR est
       celui du calcul de structure (`clashReportOf`) et le SEUIL est écrit ici
       (`minDistance`), donc le panneau n'a rien à recopier : il lit ce rapport.
       ⚠ LA DYNAMIQUE NE REFUSE RIEN POUR ÇA (décision de cette session : le geste REND le
       chiffre, il ne change pas sa physique) — un empilement reste possible, il n'est
       simplement plus tu. */
    clashes: {
      count: finalClashes.count, severity: finalClashes.severity,
      minDistance: finalClashes.minDistance,
      worst: finalClashes.worst ? { ...finalClashes.worst } : null,
      frames: clashFrames, images: clashImages,
      worstDuring: worstClash ? { ...worstClash } : null,
    },
    molecule: engine.moleculeOf(),
    cost: { before: before.cost, after: after.cost },
    walls: { before: before.walls, after: after.walls, count: engine.walls.length },
    before, after, trace,
    omega: after.omega, rama: after.rama, chi: after.chi,
  };
}

/** LA DYNAMIQUE, D'UN TRAIT — le même générateur conduit jusqu'au bout. */
export const molecularDynamicsOf = (spec = {}) => drainFrames(mdFrames(spec), spec.onFrame);

/* ── 4quater · LA MINIMISATION DIHÉDRALE — L'AFFINAGE FINAL DE L'ÉNERGIE ───────
   « this will help the final energy refinement. » La descente se fait sur les MÊMES
   coordonnées que la dynamique (les dièdres), donc sur le même champ : chaque charnière
   est essayée de part et d'autre d'un pas qui se DIVISE PAR DEUX dès qu'un balayage
   complet n'améliore plus rien. Rien n'est accepté qui empire le coût local (les termes
   qui traversent la charnière — murs de la longe compris), et le mouvement reste une
   rotation rigide : les longueurs et les angles ne peuvent pas se casser.

   GÉNÉRATEUR comme les autres (`minimizeTorsionsOf` le conduit d'un trait), une image
   par balayage — c'est ce qui se regarde à l'écran. */
export function* minimizeFrames({
  positions = null, elements = [], bonds = [], restraints = [], weights = RELAX_WEIGHTS,
  channels = null, leash = null, torsions = null, omegas = null, dihedrals = [],
  ramaWeight = STRUCTURE_CALC_RAMA_WEIGHT, chiWeight = STRUCTURE_CALC_CHI_WEIGHT,
  rounds = STRUCTURE_CALC_MIN_ROUNDS, step = STRUCTURE_CALC_MIN_STEP,
  stepFloor = STRUCTURE_CALC_MIN_STEP_FLOOR, tries = STRUCTURE_CALC_MIN_TRIES,
  /* 🪢 ω VARIE — l'option de l'utilisateur (`STRUCTURE_CALC_FREE_OMEGA`) : la descente ne
     refuse plus un pas qui augmente le coût d'une liaison peptidique, donc elle peut PAYER un
     peu de barrière d'ω pour gagner ailleurs (une distance demandée, un φ/ψ imposé, un
     empilement) — exactement comme elle arbitre déjà les autres familles du champ. */
  freeOmega = STRUCTURE_CALC_FREE_OMEGA,
  hydrogen = null,
  /* 🎯 LA FONCTION CIBLE — le ⚒ ne peut pas descendre un autre champ que celui du panneau
     (voir `STRUCTURE_CALC_TARGET_FUNCTIONS`). */
  targetFunction = STRUCTURE_CALC_TARGET_FUNCTION,
  /* 🧪 LE pH ET LA FORCE IONIQUE — la descente tourne sur le champ que le panneau affiche, donc
     elle aussi porte les deux réglages de la CHIMIE (voir §2bis et §4bis). */
  ph = FF_PH_DEFAULT, ionicStrength = FF_IONIC_STRENGTH_DEFAULT,
} = {}) {
  const engine = torsionEngineOf({
    positions, elements, bonds, restraints, weights, channels, leash, torsions, omegas, dihedrals,
    ramaWeight, chiWeight, hydrogen, targetFunction, ph, ionicStrength,
  });
  if (!engine) return refusedMotion('bad-points', null, freeOmega);
  const chan = engine.chan;
  const nRounds = clampInt(rounds, 0, 64, STRUCTURE_CALC_MIN_ROUNDS);
  if (!chan.length || !nRounds) return refusedMotion(chan.length ? 'no-step' : 'no-channel', engine, freeOmega);
  let width = Math.max(0.01, Math.abs(Number(step) || STRUCTURE_CALC_MIN_STEP));
  const floor = Math.max(0.01, Math.abs(Number(stepFloor) || STRUCTURE_CALC_MIN_STEP_FLOOR));
  const maxTries = clampInt(tries, 1, 64, STRUCTURE_CALC_MIN_TRIES);
  /* LES CANAUX QUI SONT DES LIAISONS PEPTIDIQUES — leur coût d'ω ne doit JAMAIS augmenter,
     ni dans la dynamique ni dans la descente (voir la dynamique : sans cette règle, une
     descente qui soulage un empilement peut poser un ω en CIS, et un calcul de structure
     veut des peptides TRANS). */
  const omegaBond = new Set(engine.omega.map((o) => (o.c < o.n ? `${o.c}-${o.n}` : `${o.n}-${o.c}`)));
  const readAll = () => ({
    cost: engine.costOf(),
    walls: engine.wallCostOf(),
    omega: omegaPenaltyOf({ positions: engine.x, omegas: engine.omega }),
    rama: ramaPenaltyOf({ positions: engine.x, torsions: engine.backbone, weight: engine.wRama }),
    chi: chiPenaltyOf({ positions: engine.x, chis: engine.chis, weight: engine.wChi }),
    dihedral: dihedralPenaltyOf({ positions: engine.x, dihedrals: engine.dihedralRows }),
  });
  const before = readAll();
  const schedule = [];
  let sweeps = 0; let accepted = 0; let skipped = 0;
  while (sweeps < nRounds && width >= floor) {
    let improved = 0;
    /* LA GRILLE DU CŒUR DUR EST REFAITE À CHAQUE BALAYAGE — un balayage déplace jusqu'à
       tous les dièdres, donc les couples trop serrés ont changé. */
    engine.refreshCore();
    for (const ch of chan) {
      const ctx = engine.ctxOf(ch);
      let cur = engine.dihedralOf(ch.probeAtoms, null);
      if (!Number.isFinite(cur)) { skipped += 1; continue; }
      let local = engine.crossCost(ctx, null);
      for (let a = 0; a < maxTries; a += 1) {
        const up = engine.mapFor(ch, cur + width);
        const down = engine.mapFor(ch, cur - width);
        /* ⚠ LE PAS EST JUGÉ SUR LA GÉOMÉTRIE D'ESSAI (`stepPairsOf`) — un pas qui POSE un
           empilement le voit et se refuse (`best < local`), au lieu de l'accepter parce que
           la marche ne portait pas encore le couple. `local` reste le coût de la géométrie
           ENGAGÉE : les couples du pas y sont hors de portée, donc à zéro. */
        const trial = engine.ctxOf(ch, [up.map, down.map]);
        const cu = up.ok ? engine.crossCost(trial, up.map) : Infinity;
        const cd = down.ok ? engine.crossCost(trial, down.map) : Infinity;
        const best = Math.min(cu, cd);
        if (!(best < local - 1e-12)) break;         // rien à gagner par ici
        /* ⚠ ω NE SE DÉGRADE PAS ICI NON PLUS — un pas de descente qui augmente le coût
           d'une liaison peptidique est refusé, même s'il soulage un empilement : c'est ce
           qui garde les peptides TRANS dans le modèle final.
           🪢 …SAUF si l'utilisateur a demandé que ω VARIE (`freeOmega`) : le pas est alors
           jugé sur le coût LOCAL entier (qui CONTIENT la barrière d'ω), comme les autres. */
        const omegaKey = ch.i < ch.j ? `${ch.i}-${ch.j}` : `${ch.j}-${ch.i}`;
        if (!freeOmega && omegaBond.has(omegaKey)) {
          const nextDeg = ((cur + (cu <= cd ? width : -width) + 540) % 360) - 180;
          if (ffOmegaCostOf(nextDeg, { target: STRUCTURE_CALC_OMEGA })
            > ffOmegaCostOf(cur, { target: STRUCTURE_CALC_OMEGA }) + 1e-9) break;
        }
        engine.commit((cu <= cd ? up : down).map);
        local = best;
        cur = ((cur + (cu <= cd ? width : -width) + 540) % 360) - 180;
        improved += 1;
        accepted += 1;
      }
    }
    sweeps += 1;
    const row = {
      phase: 'minimise', positions: engine.heavyPositions(), sweep: sweeps, of: nRounds,
      step: Number(width.toFixed(4)), improved,
      cost: Number(engine.costOf().toFixed(6)), walls: Number(engine.wallCostOf().toFixed(6)),
    };
    schedule.push(row);
    yield row;
    /* PLUS RIEN À GAGNER À CE PAS — on le divise : c'est la descente en coordonnées du
       dossier, et elle s'arrête quand le pas est plus fin que `stepFloor`. */
    if (!improved) width /= 2;
  }
  const after = readAll();
  return {
    ok: true,
    reason: width < floor ? 'converged' : 'max-rounds',
    positions: engine.heavyPositions(),
    channels: chan.length,
    omegaFree: !!freeOmega,
    /* 🎯 LA FONCTION CIBLE CONDUITE — le rapport du ⚒ la DIT, comme celui du recuit. */
    targetFunction: engine.targetFunction, switchedOff: engine.switchedOff,
    unitedAtoms: engine.unitedAtoms,
    steps: sweeps * chan.length, sweeps, accepted, skipped,
    step: Number(width.toFixed(6)),
    schedule,
    cost: { before: before.cost, after: after.cost },
    walls: { before: before.walls, after: after.walls, count: engine.walls.length },
    before, after,
    omega: after.omega, rama: after.rama, chi: after.chi,
    molecule: engine.moleculeOf(),
    /* 🧪 LA CHIMIE DE CETTE DESCENTE — la même ligne que la dynamique et le recuit. */
    chemistry: engine.chemistry,
  };
}

/** LA MINIMISATION, D'UN TRAIT — le même générateur conduit jusqu'au bout. */
export const minimizeTorsionsOf = (spec = {}) => drainFrames(minimizeFrames(spec), spec.onFrame);

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
 *   AUCUN recuit pour un départ non tiré ; `0` = aucun), `quench` (la trempe finale),
 *   `freeOmega` (🪢 la liaison peptidique devient un dièdre ORDINAIRE du protocole : le
 *   recuit, la trempe, la dynamique et la minimisation ne refusent plus un pas qui augmente
 *   son coût — la barrière du champ reste comptée et arbitre seule. Voir
 *   `STRUCTURE_CALC_FREE_OMEGA` ; les moteurs disent chacun ce réglage, `omegaFree`).
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
export function* structureAttemptFrames({
  positions = null, elements = [], bonds = [], restraints = [], index = 0,
  seed = STRUCTURE_CALC_SEED, tolerance = STRUCTURE_CALC_RESTRAINT_TOLERANCE,
  weights = RELAX_WEIGHTS, clashDistance = RELAX_CLASH_DISTANCE,
  draw = true, onPass = null,
  anneal = null, annealPerFrame = 0, dihedrals = [],
  /* ⚙ LE PROTOCOLE STANDARD — le recuit (fait plus haut), la dynamique (une phase
     d'ÉQUILIBRATION à T haute puis le REFROIDISSEMENT), la minimisation et la trempe.
     `md: 0` ou `minimise: 0` les enlève : un appelant garde donc la main sur ce qu'un
     départ coûte, et chacun rend son coût avant/après (en kcal/mol) et sa durée. */
  md = STRUCTURE_CALC_MD_STEPS, mdPerFrame = STRUCTURE_CALC_MD_FRAME,
  mdHot = STRUCTURE_CALC_MD_HOT, mdCold = STRUCTURE_CALC_MD_COLD,
  mdDt = STRUCTURE_CALC_MD_DT, mdEquilibration = STRUCTURE_CALC_MD_EQUILIBRATION,
  minimise = STRUCTURE_CALC_MIN_ROUNDS,
  quench = true,
  /* 🪢 ω VARIE — l'option « allow the option to vary also the omega backbone angle » :
     elle descend TELLE QUELLE dans les trois moteurs du protocole (le recuit, la trempe,
     la dynamique et la minimisation), donc un départ ne peut pas porter un autre réglage
     que celui que le panneau affiche. Voir `STRUCTURE_CALC_FREE_OMEGA`. */
  freeOmega = STRUCTURE_CALC_FREE_OMEGA,
  /* 🎯 LA FONCTION CIBLE DU DÉPART — `classic` (le champ entier) ou `dyana` (répulsion
     seule, pas de charge, pas de surface, atomes unis — voir `FF_TARGET_FUNCTIONS`). Elle
     descend TELLE QUELLE dans le recuit, la dynamique, la minimisation ET la trempe du
     protocole, et `scoreStructureOf` la reçoit aussi : un départ ne peut donc pas être
     construit sous un jeu de règles et noté sous un autre. */
  /* 🧪 LE pH ET LA FORCE IONIQUE — les deux réglages de la CHIMIE du champ (voir §2bis et §4bis
     de utils/forceFieldKcal.js) : il descend TELLE QUELLE dans le recuit du départ, sa dynamique,
     sa minimisation, sa trempe ET sa note — un départ ne peut donc pas être construit sous un
     jeu de règles et noté sous un autre. */
  ph = FF_PH_DEFAULT, ionicStrength = FF_IONIC_STRENGTH_DEFAULT,
  targetFunction = STRUCTURE_CALC_TARGET_FUNCTION,
} = {}) {
  const read = flatPositions(positions);
  const k = clampInt(index, 0, Number.MAX_SAFE_INTEGER, 0);
  const startSeed = wrapSeed(wrapSeed(seed) + wrapSeed(k * STRUCTURE_CALC_SEED_STEP));
  const els = Array.from(elements || []);
  if (!read) {
    return {
      ok: false, reason: 'bad-points', index: k, seed: startSeed, score: Infinity,
      total: Infinity, freeEnergy: Infinity, enthalpy: Infinity,
      bond: 0, angle: 0, planar: 0, vdw: 0, elec: 0, solv: 0, restraint: 0,
      omega: 0, rama: 0, chi: 0, entropy: 0,
      clashPenalty: 0, omegaPenalty: 0, ramaPenalty: 0, chiPenalty: 0,
      clashes: { count: 0, severity: 0, worst: null, minDistance: clashDistance },
      contacts: { count: 0, severity: 0, worst: null, checked: 0, unknownElements: 0 },
      restraint: restraintReportOf({ positions: null, restraints, tolerance }),
      positions: null, moved: 0, restraints: [], restraintCount: 0, dropped: 0,
      draw: { turned: 0, channels: 0, skipped: 0, counts: null, plan: [] },
      channels: [],
      omegaFree: !!freeOmega,
      anneal: null, md: null, minimise: null, quench: null,
      protocol: { stages: [], steps: 0, evaluations: 0, mdTime: null },
    };
  }
  /* UN DÉPART SANS LE PROTOCOLE STANDARD N'EST PAS UN DÉPART : sans recuit, sans
     dynamique et sans minimisation il ne reste qu'un tirage — c'est permis (`anneal`,
     `md`, `minimise` à 0), mais le rapport le DIT (`protocol.stages` est vide). */
  const mdEquilShare = Math.max(0, Math.min(0.9, Number(mdEquilibration)));

  const count = read.count;
  const clean = restraintListOf({ restraints, atomCount: count });
  const x0 = read.flat.slice();
  /* LE PAS MONTRE — une IMAGE par geste (le panneau écrit ces coordonnées à l'écran
     s'il le demande) : le tirage, chaque pas de recuit, la préparation, chaque distance
     conduite, le balayage, la dynamique, la minimisation, la trempe. Aucune coordonnée
     n'est recalculée : c'est `x`. C'est un `yield` — le conducteur synchrone
     (`structureAttemptOf`) le passe à `onStep`, l'écran écrit et laisse peindre. */
  const step = function* (phase, positions, extra = null) {
    yield { phase, positions, index: k, ...(extra || {}) };
  };
  /* 🪢 LE RÉGLAGE ω, LU AVANT LE TIRAGE — le tirage a besoin des ω de la molécule ET de la
     case « ω varie » : FAUSSE (le défaut), il ne TIRE pas les liaisons peptidiques, il les
     POSE trans (voir `randomTorsionsOf`). Lu ici pour tout le départ, comme la barrière du
     recuit : c'est la même liste qui sert au tirage, au recuit, à la dynamique et à la note. */
  const omegas = peptideOmegasOf({ elements: els, bonds, atomCount: count });
  /* 1 · LE TIRAGE DES DIÈDRES — le départ. `draw: false` garde la molécule reçue
     telle quelle (le ⚒ d'un seul coup, sans hasard : ce que la sonde compare). */
  const drawn = draw
    ? randomTorsionsOf({
      positions: x0, elements: els, bonds, atomCount: count, seed: startSeed,
      omegas, freeOmega,
    })
    : null;
  let x = drawn && drawn.ok ? Array.from(drawn.positions) : x0.slice();
  yield* step('draw', x, { channels: drawn ? drawn.channelCount : 0 });
  /* 1bis · LE RECUIT — LA PHYSIQUE. Le tirage est un point AU HASARD dans un espace de
     très grande dimension, et le protocole qui suit est LOCAL : sans recuit, un départ
     empilé ou loin de vos distances y reste. Le recuit n'appartient donc qu'à un
     DÉPART TIRÉ : `draw: false` est le ⚒ tel quel sur la molécule reçue (aucun
     hasard), et il ne recuit pas — sauf si `anneal` le demande explicitement. La
     barrière ω et le squelette sont lus ici une fois pour tout le départ (le même
     champ de forces que la note, donc). */
  const backbone = backboneTorsionsOf({ elements: els, bonds, atomCount: count });
  const annealSteps = clampInt(
    anneal == null ? (draw ? STRUCTURE_CALC_ANNEAL_STEPS : 0) : anneal,
    0, 64, 0,
  );
  let annealRun = null;
  let hydrogen = null;
  if (annealSteps > 0) {
    const frames = annealFrames({
      positions: x, elements: els, bonds, restraints: clean.list,
      channels: drawn ? drawn.channels : null, omegas, torsions: backbone, weights, dihedrals,
      seed: wrapSeed(startSeed + 7),
      steps: annealSteps, perFrame: annealPerFrame,
      /* 🎯 LA FONCTION CIBLE DU DÉPART — le recuit conduit exactement le champ demandé. */
      targetFunction,
      /* 🧪 …ET LA CHIMIE DE CE CHAMP (pH et force ionique) : le recuit d'un départ est le
         premier geste du protocole, donc il lit la MÊME chimie que la dynamique, la trempe et
         la note (voir §2bis et §4bis de utils/forceFieldKcal.js). */
      ph, ionicStrength,
      /* ⚠ LE RECUIT PROTÈGE ω — la règle est la même qu'à la trempe : un pas qui AUGMENTE
         le coût d'une liaison peptidique est refusé (un vrai peptide reste TRANS à toute
         température de ce protocole), mais un pas qui le DIMINUE est accepté.
         ⚠ C'EST UN CLIQUET, PAS UN RAPPEL VERS TRANS. Le terme ω du champ est monotone
         (`ffOmegaCostOf`, un seul minimum) : tout pas ACCEPTÉ rapproche de trans. Mais la
         règle ne garde que les pas qui ne MONTENT pas le coût, et une force concurrente (une
         distance demandée) peut donc retenir ω HORS du plateau — mesuré sur la sonde : un
         départ cis n'en revient qu'à 92° d'écart après six balayages, 77° après 3000 pas de
         dynamique à 2000 K. Ce que la protection garantit ici est donc plus étroit, et c'est
         exactement ce qu'il faut : un ω parti DU PLATEAU y reste (son coût y est nul, le pas
         qui l'en sortirait le monterait, il est refusé). C'est pourquoi le TIRAGE ne laisse
         plus partir un peptide de travers (le verrou est dans `randomTorsionsOf`, plus haut) :
         naître dans le plateau, c'est y rester.
         🪢 …et il ne la protège plus quand l'utilisateur a demandé que ω VARIE (`freeOmega`) :
         la barrière d'ω reste comptée dans le champ, donc c'est elle qui arbitre. */
      protectOmega: true,
      freeOmega,
    });
    let next = frames.next();
    while (!next.done) { yield { ...next.value, index: k }; next = frames.next(); }
    annealRun = next.value;
    if (annealRun && annealRun.molecule) hydrogen = annealRun.molecule;
  }
  if (annealRun && annealRun.ok) x = Array.from(annealRun.positions);
  /* 2 · LE PROTOCOLE STANDARD — LE RECUIT A CHAUFFÉ, LA DYNAMIQUE VA REFROIDIR, LA
     MINIMISATION VA POSER. ⚠ IL N'Y A PLUS DE « ⚒ » ICI : conduire les distances une par
     une, avec une descente du ⚒ par distance, était LE protocole de l'utilisateur — et
     c'est lui qui rendait les modèles mauvais (une suite de gestes locaux ne sait pas
     garder le reste de la molécule cohérent). Le protocole standard le remplace :
       1. TIrage des dièdres (fait plus haut),
       2. RECUIT simulé en espace dihédral (fait plus haut, `annealFrames`),
       3. DYNAMIQUE d'ÉQUILIBRATION à température haute, sous contraintes (plus bas),
       4. DYNAMIQUE de REFROIDISSEMENT hot → cold,
       5. MINIMISATION dihédrale (jusqu'à un minimum local DU MÊME champ),
       6. TREMPE froide sous longe (répare ce que les mouvements ont pu casser).
     Les distances demandées ne sont plus « conduites » : elles sont un PUITS PLAT du
     champ (20 kcal/mol/Å² hors de ± 0.25 Å), donc elles pèsent sur CHAQUE pas de la
     dynamique et de la minimisation — c'est exactement la façon dont XPLOR/CNS et CYANA
     traitent une contrainte NOE. */
  let reason = 'standard-protocol';
  let stepsTaken = 0;
  let evaluations = 0;
  const passesLog = [];

  /* 3 · LA DYNAMIQUE — D'ABORD L'ÉQUILIBRATION À T HAUTE, ENSUITE LE REFROIDISSEMENT.
     C'est le cœur du protocole standard : à température haute le système explore (il
     change de bassin, il écarte les chaînes latérales, il atteint une distance
     demandée), et en refroidissant il se pose dans un minimum. Les distances DÉJÀ
     tenues deviennent une LONGE (un MUR, pas un refus : une trajectoire ne peut pas
     refuser un pas), donc le refroidissement ne lâche pas ce qui est gagné.
     `md: 0` ou `minimise: 0` enlève l'un ou l'autre, et le rapport dit ce que chacun a
     coûté — en kcal/mol, avec ses pas, sa durée et sa température. */
  const mdSteps = clampInt(md, 0, 100000, STRUCTURE_CALC_MD_STEPS);
  const minRounds = clampInt(minimise, 0, 64, STRUCTURE_CALC_MIN_ROUNDS);
  const equilShare = mdEquilShare;
  const equilSteps = Math.round(mdSteps * equilShare);
  const coolSteps = Math.max(0, mdSteps - equilSteps);
  const held = restraintReportOf({ positions: x, restraints: clean.list, tolerance })
    .list.filter((r) => r.satisfied)
    .map((r) => ({ i: r.i, j: r.j, target: r.target, weight: r.weight }));
  const motionOf = (arr) => ({
    positions: arr, elements: els, bonds, restraints: clean.list, weights,
    channels: drawn ? drawn.channels : null, torsions: backbone, omegas, dihedrals, leash: held,
    dt: mdDt, hydrogen,
    /* 🎯 LA FONCTION CIBLE — la dynamique d'équilibration, celle de refroidissement et la
       minimisation descendent LE MÊME champ que le recuit et la note.
       🧪 …ET LA CHIMIE DU CHAMP — le pH et la force ionique sont dans CE sac, donc les deux
       phases de dynamique ET la minimisation les portent d'un seul coup (voir `motionOf`). */
    targetFunction,
    ph, ionicStrength,
    /* 🪢 …ET LE RÉGLAGE ω DE L'UTILISATEUR, tel quel : la dynamique et la minimisation de
       chaque départ le portent, sinon le protocole ne serait pas celui qu'on a demandé. */
    freeOmega,
  });
  let mdRun = null;
  const mdPhases = [];
  if (mdSteps > 0) {
    if (equilSteps > 0) {
      const frames = mdFrames({
        ...motionOf(x), seed: wrapSeed(startSeed + 23),
        steps: equilSteps, temperature: mdHot, perFrame: mdPerFrame,
      });
      let next = frames.next();
      while (!next.done) { yield { ...next.value, phase: 'md-equilibrate', index: k }; next = frames.next(); }
      const run = next.value;
      mdPhases.push({ name: 'equilibrate', ...(run.ok ? {
        steps: run.steps, temperature: mdHot, time: run.time,
        before: run.cost.before, after: run.cost.after,
      } : {}) });
      if (run && run.ok) x = Array.from(run.positions);
      if (run && run.molecule) hydrogen = run.molecule;
      mdRun = run;
      stepsTaken += run.steps || 0; evaluations += run.applied || 0;
    }
    if (coolSteps > 0) {
      const frames = mdFrames({
        ...motionOf(x), seed: wrapSeed(startSeed + 29),
        steps: coolSteps, hot: mdHot, cold: mdCold, perFrame: mdPerFrame,
      });
      let next = frames.next();
      while (!next.done) { yield { ...next.value, phase: 'md-cool', index: k }; next = frames.next(); }
      const run = next.value;
      mdPhases.push({ name: 'cool', ...(run.ok ? {
        steps: run.steps, hot: mdHot, cold: mdCold, time: run.time,
        before: run.cost.before, after: run.cost.after,
      } : {}) });
      if (run && run.ok) {
        x = Array.from(run.positions);
        /* LE RAPPORT MAÎTRE EST CELUI DU REFROIDISSEMENT (le dernier état), mais il
           porte la LONGUEUR TOTALE de la trajectoire (les deux phases) — c'est le
           chiffre que le panneau appelle « total simulation time ». */
        mdRun = { ...run, time: structureCalcSimulationTimeOf({ steps: mdSteps, dt: run.time.dt }) };
      }
      if (run && run.molecule) hydrogen = run.molecule;
      stepsTaken += run.steps || 0; evaluations += run.applied || 0;
    }
  }
  let minRun = null;
  if (minRounds > 0) {
    const frames = minimizeFrames({ ...motionOf(x), rounds: minRounds });
    let next = frames.next();
    while (!next.done) { yield { ...next.value, index: k }; next = frames.next(); }
    minRun = next.value;
    if (minRun && minRun.ok) x = Array.from(minRun.positions);
    if (minRun && minRun.molecule) hydrogen = minRun.molecule;
    stepsTaken += minRun && minRun.ok ? minRun.steps || 0 : 0;
    evaluations += minRun && minRun.ok ? minRun.accepted || 0 : 0;
  }

  /* 4 · LA TREMPE — LA MINIMISATION A PU LAISSER ω PRÈS DE SA BARRIÈRE (elle ne connaît
     que le champ, et la barrière de ω est *franchie* par un saut de 12°, pas par une
     descente). Ce dernier recuit, FROID et SOUS LONGE, répare ce qui reste sans lâcher
     les distances tenues. `quench: false` l'enlève. */
  const omegaBeforeQuench = annealSteps > 0 && quench
    ? omegaPenaltyOf({ positions: x, omegas })
    : null;
  let quenchRun = null;
  if (annealSteps > 0 && quench) {
    const frames = annealFrames({
      positions: x, elements: els, bonds, restraints: clean.list,
      channels: drawn ? drawn.channels : null, omegas, torsions: backbone, weights, dihedrals,
      seed: wrapSeed(startSeed + 13),
      steps: STRUCTURE_CALC_QUENCH_STEPS,
      hot: STRUCTURE_CALC_QUENCH_TEMPERATURE, cold: STRUCTURE_CALC_QUENCH_TEMPERATURE,
      leash: clean.list, protectOmega: true,
      /* 🪢 La trempe est le dernier mot sur ω : avec l'option, elle non plus ne le protège
         plus — le champ (barrière comprise, et la LONGE) décide seul. */
      freeOmega,
      hydrogen,
      /* 🎯 …ET LA FONCTION CIBLE : la trempe juge et répare sur le MÊME champ. */
      targetFunction,
      /* 🧪 …ET LA CHIMIE DE CE CHAMP (pH et force ionique). */
      ph, ionicStrength,
    });
    let next = frames.next();
    while (!next.done) { yield { ...next.value, phase: 'quench', index: k }; next = frames.next(); }
    quenchRun = next.value;
  }
  if (quenchRun && quenchRun.ok) x = Array.from(quenchRun.positions);

  /* LA NOTE, ET LA RElecture DES DIÈDRES — le rapport dit ce que la structure A, pas
     ce que le tirage a demandé (`channelReadingsOf` relit chaque canal avec LE
     lecteur de dihèdre du dossier). */
  const scored = scoreStructureOf({
    positions: x, elements: els, bonds, restraints: clean.list, weights, clashDistance,
    tolerance, omegas, torsions: backbone, dihedrals,
    /* 🎯 LA NOTE EST CELLE DE LA FONCTION CIBLE CONDUITE — un départ ne peut pas être
       construit sous un jeu de règles et noté sous un autre. 🧪 La CHIMIE du champ (pH, force
       ionique) suit la même règle : la note est prise sous le champ qui a tourné. */
    targetFunction,
    ph, ionicStrength,
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
    /* 🪢 LE RÉGLAGE ω QUI A SERVI À CE DÉPART — relu par le panneau (le rapport d'un calcul
       doit dire avec quelles règles il a été fait, sinon deux familles ne se comparent pas). */
    omegaFree: !!freeOmega,
    /* 🎯 …ET LA FONCTION CIBLE QUI A SERVI — même raison : les règles du modèle s'écrivent
       à côté de sa note. */
    targetFunction: structureCalcTargetFunctionOf(targetFunction).id,
    targetFunctionLabel: structureCalcTargetFunctionOf(targetFunction).label,
    /* 🧪 LA CHIMIE DE CE DÉPART — le pH, l'écrantage ionique et la charge NETTE du modèle,
       relus sur le champ qui vient de le noter (`scored.forceField`) : le rapport d'un calcul
       peut donc dire ce qu'il a conduit, et pas seulement ce qu'on avait demandé. */
    chemistry: scored.forceField ? {
      ph: scored.forceField.ph,
      ionicStrength: scored.forceField.ionicStrength,
      kappa: scored.forceField.kappa,
      debyeLength: scored.forceField.debyeLength,
      net: scored.forceField.charges ? scored.forceField.charges.net : 0,
      method: scored.forceField.charges ? scored.forceField.charges.method : '',
      groups: scored.forceField.ionisation ? scored.forceField.ionisation.groups : [],
      atWork: !!(scored.forceField.ionisation && scored.forceField.ionisation.atWork),
    } : null,
    draw: {
      turned: drawn ? drawn.drawn : 0,
      channels: drawn ? drawn.channelCount : 0,
      skipped: drawn ? drawn.skipped.length : 0,
      counts: drawn ? drawn.counts : null,
      plan: drawn ? drawn.turned : [],
      /* 🪢 CE QUE LE TIRAGE A FAIT DES ω — combien de liaisons peptidiques il a POSÉES trans
         au lieu de les tirer (et si la case les rendait au hasard). Un rapport de tirage qui
         tairait ça laisserait croire que TOUS les dièdres de la ligne « tirés au hasard » le
         sont : ce n'est plus vrai, et c'est justement le correctif. */
      omegaLocked: drawn ? (drawn.omegaLocked || 0) : 0,
      omegaFree: drawn ? !!drawn.omegaFree : !!freeOmega,
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
    /* LA DYNAMIQUE ET LA MINIMISATION, RACONTÉES — les pas, les températures, la DURÉE
       (pas × dt, en ps), les murs de la longe et le coût avant/après (le même coût que le
       recuit : comparable). `phases` porte l'ÉQUILIBRATION puis le REFROIDISSEMENT. */
    md: mdRun && mdRun.ok ? {
      steps: mdRun.steps,
      phases: mdPhases,
      time: mdRun.time,
      channels: mdRun.channels,
      applied: mdRun.applied,
      skipped: mdRun.skipped,
      temperature: mdRun.temperature,
      before: mdRun.cost.before,
      after: mdRun.cost.after,
      walls: mdRun.walls,
      rama: mdRun.rama ? mdRun.rama.penalty : 0,
      chi: mdRun.chi ? mdRun.chi.penalty : 0,
      constants: mdRun.constants,
      added: mdRun.added,
      trace: mdRun.trace,
    } : null,
    minimise: minRun && minRun.ok ? {
      sweeps: minRun.sweeps,
      accepted: minRun.accepted,
      skipped: minRun.skipped,
      reason: minRun.reason,
      step: minRun.step,
      before: minRun.cost.before,
      after: minRun.cost.after,
      walls: minRun.walls,
      schedule: minRun.schedule,
    } : null,
    /* LE JOURNAL DU PROTOCOLE — les ÉTAPES que le départ a RÉELLEMENT suivies, dans
       l'ordre, avec ce que chacune a coûté. Un protocole qui ne dit pas ses étapes ne se
       vérifie pas ; celui-ci les nomme. */
    protocol: {
      stages: [
        ...(draw ? [{ name: 'draw', channels: drawn ? drawn.channelCount : 0 }] : []),
        ...(annealRun && annealRun.ok ? [{
          name: 'anneal', steps: annealRun.schedule.length, hot: STRUCTURE_CALC_ANNEAL_HOT,
          cold: STRUCTURE_CALC_ANNEAL_COLD, accepted: annealRun.accepted,
          before: annealRun.cost.before, after: annealRun.cost.after,
        }] : []),
        ...mdPhases,
        ...(minRun && minRun.ok ? [{
          name: 'minimise', sweeps: minRun.sweeps, accepted: minRun.accepted,
          before: minRun.cost.before, after: minRun.cost.after,
        }] : []),
        ...(quenchRun && quenchRun.ok ? [{
          name: 'quench', steps: quenchRun.schedule.length, accepted: quenchRun.accepted,
          before: quenchRun.cost.before, after: quenchRun.cost.after,
        }] : []),
      ],
      mdSteps, mdTime: mdRun && mdRun.ok ? mdRun.time : null,
      steps: stepsTaken, evaluations,
    },
  };
}

/** UN DÉPART, D'UN TRAIT — le même générateur conduit jusqu'au bout (les appelants, les
 *  tests, et le ⚒ d'un seul coup). `onStep` reçoit chaque image, exactement comme avant
 *  que le protocole soit écrit en générateur. */
export const structureAttemptOf = (spec = {}) =>
  drainFrames(structureAttemptFrames(spec), spec.onStep);

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
 * protocol, anneal, quench, omega, omegaFree, chemistry}` : le tableau du panneau), `retained` = les `keep` premières AVEC leurs
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
    target: a.target,
    clashPenalty: a.clashPenalty,
    /* LES TROIS POTENTIELS DE TORSION — le tableau du panneau peut donc dire ce que le
       score d'un modèle porte EN PLUS de la chimie : ω, bassins φ/ψ, χ1. */
    omegaPenalty: a.omegaPenalty,
    ramaPenalty: a.ramaPenalty,
    chiPenalty: a.chiPenalty,
    rama: a.ramaPlot
      ? {
        measured: a.ramaPlot.measured, violations: a.ramaPlot.violations,
        partial: a.ramaPlot.partial, penalty: a.ramaPlot.penalty,
        worst: a.ramaPlot.worst ? { ...a.ramaPlot.worst } : null,
      }
      : null,
    chi: a.chiWells
      ? { measured: a.chiWells.measured, violations: a.chiWells.violations }
      : null,
    /* ⚠ LE RECUIT, LA TREMPE, ω ET LE RÉGLAGE DE ω — le rapport du 🧬 les lit
       (`best.anneal`, `best.quench`, `best.omega`, `best.omegaFree`) et AUCUN n'était
       transporté : le panneau disait donc « 🔥 recuit OFF (n tirages nus) » sur une famille
       dont le recuit avait bel et bien tourné, et la ligne ω restait muette. Les quatre
       lectures viennent de la TENTATIVE, telles quelles (aucun chiffre recalculé ici). */
    anneal: a.anneal ? { ...a.anneal } : null,
    quench: a.quench ? { ...a.quench } : null,
    omega: a.omega ? { ...a.omega } : null,
    omegaFree: !!a.omegaFree,
    md: a.md ? {
      steps: a.md.steps, applied: a.md.applied, before: a.md.before, after: a.md.after,
      temperature: a.md.temperature ? { ...a.md.temperature } : null,
    } : null,
    minimise: a.minimise
      ? { sweeps: a.minimise.sweeps, accepted: a.minimise.accepted, before: a.minimise.before, after: a.minimise.after }
      : null,
    bond: a.bond, angle: a.angle, planar: a.planar,
    vdw: a.vdw, elec: a.elec, solv: a.solv, entropy: a.entropy,
    nonbonded: a.nonbonded ? { ...a.nonbonded } : { count: 0, repulsive: 0 },
    added: a.added ? { ...a.added } : null,
    moved: a.moved,
    reason: a.reason,
    /* 🧪 LA CHIMIE DE CE DÉPART — transportée TELLE QUELLE, comme les trois potentiels de
       torsion ci-dessus : le rapport du 🧬 lit `best.chemistry` (le pH, la force ionique, la
       charge nette du modèle classé), donc ce champ doit vivre dans la ligne du classement —
       sinon un rapport sans chimie parle d'un modèle dont il ne sait rien. Le champ vient du
       DÉPART (voir `chemistry` du retour de `structureAttemptFrames`), jamais recalculé ici. */
    chemistry: a.chemistry
      ? { ...a.chemistry, groups: Array.isArray(a.chemistry.groups) ? a.chemistry.groups.map((g) => ({ ...g })) : [] }
      : null,
    clashes: a.clashes ? a.clashes.count : 0,
    /* ⚠ LES LECTURES DE GÉOMÉTRIE QUE LE PANNEAU ET LE RAPPORT LISENT AUSSI — `bondRms`,
       `angleRms` et `contacts` étaient écrits dans le contrat ci-dessus et dans AUCUN
       champ de cette ligne : `calcReportOf` (NMRMoleculeViewer.jsx) lisait donc
       `best.bondRms.toFixed(4)` sur `undefined` et mourait À LA FIN de chaque calcul —
       le rapport de cette session : « The structure calculation can never be completed …
       Cannot read properties of undefined (reading 'toFixed') ». Les quatre lectures de
       géométrie et les pires écarts sont donc transportés ENSEMBLE, comme le tableau du
       panneau les affiche ; `contacts` est le COMPTE (l'objet complet a quatre chiffres,
       le panneau n'en affiche qu'un). Un test mesure que tout champ lu par le rapport
       existe vraiment dans `ranking[i]`. */
    bondRms: a.bondRms, angleRms: a.angleRms,
    planarRms: a.planarRms, contactRms: a.contactRms,
    worstBond: a.worstBond, worstAngle: a.worstAngle,
    worstPlanar: a.worstPlanar, worstContact: a.worstContact,
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
        stages: (a.protocol.stages || []).map((s) => ({ ...s })),
        mdSteps: a.protocol.mdSteps, mdTime: a.protocol.mdTime,
        steps: a.protocol.steps, evaluations: a.protocol.evaluations,
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
   TRANCHE (un appelant qui découpe), `onAttempt` reçoit chaque tentative dès qu'elle est
   finie, `shouldStop` est consulté AVANT chaque départ (le bouton ⏹ du panneau), et
   tout ce qui suit (`anneal`, `md`, `minimise`, `onStep`…) descend tel quel dans chaque
   `structureAttemptFrames`.
   ⛓ LES DISTANCES NE SONT PAS OBLIGATOIRES — « The structure calculation must work even if
   there are only dihedral constraints (at present it wants at least one distance) » : un
   calcul qui ne porte QUE des φ/ψ imposés (`dihedrals`, la structure secondaire peinte
   convertie) part normalement, et son rapport dit `restraintCount: 0, dihedralCount: n`.
   ⚠ GÉNÉRATEUR : il rend la main à CHAQUE image de chaque départ (`{phase, positions,
   index}`, plus une image `start` avant chaque départ et `attempt-done` après). C'est ce
   qui permet à l'écran de peindre la molécule pendant le calcul ; `structureCalculationOf`
   est le même calcul conduit d'un trait. */

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
  dihedrals: [],
  dihedralCount: 0,
  dropped: 0,
  stopped: false,
  ...extra,
});

/** LES CONTRAINTES DE DIHÈDRE QUI COMPTENT — les mêmes critères que `dihedralPenaltyOf`
 *  (quatre indices entiers et une cible lisible). C'est CE compte que le calcul lit pour
 *  savoir s'il a quelque chose à respecter : la demande de cette session — « The structure
 *  calculation must work even if there are only dihedral constraints (at present it wants
 *  at least one distance) » — se joue ici, et nulle part ailleurs. */
export const dihedralListOf = (dihedrals = []) => Array.from(dihedrals || []).filter((d) => {
  const atoms = Array.from((d && d.atoms) || []);
  return atoms.length === 4 && atoms.every((k) => Number.isInteger(k))
    && Number.isFinite(Number(d && d.target));
});

export function* structureCalculationFrames({
  positions = null, elements = [], bonds = [], restraints = [], dihedrals = [],
  starts = STRUCTURE_CALC_DEFAULT_STARTS, keep = STRUCTURE_CALC_DEFAULT_KEEP,
  seed = STRUCTURE_CALC_SEED, tolerance = STRUCTURE_CALC_RESTRAINT_TOLERANCE,
  indices = null, onAttempt = null, shouldStop = null, ...rest
} = {}) {
  const read = flatPositions(positions);
  if (!read) return refusedCalculation('bad-points');
  const n = clampInt(starts, 0, STRUCTURE_CALC_MAX_STARTS, STRUCTURE_CALC_DEFAULT_STARTS);
  const clean = restraintListOf({ restraints, atomCount: read.count });
  /* ⛓ LES CONTRAINTES DE DIHÈDRE COMPTENT AUTANT QUE LES DISTANCES — la demande : « The
     structure calculation must work even if there are only dihedral constraints (at
     present it wants at least one distance) ». Un calcul qui n'a QUE des φ/ψ imposés (la
     structure secondaire peinte convertie) a donc quelque chose à respecter : il part, et
     c'est la force de rappel du puits plat (`ffDihedralCostOf`) qui l'assemble, exactement
     comme les distances le font quand la table en porte. Le refus ne tombe plus que sur un
     calcul qui n'a NI l'une NI l'autre — et il dit alors laquelle des deux manque. */
  const dh = dihedralListOf(dihedrals);
  if (!clean.count && !dh.length) {
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
    /* LE DÉPART COMMENCE — l'écran le sait avant la première image (c'est ce qui fait
       écrire « départ 3/8 » AVANT que la molécule ne bouge). */
    yield { phase: 'start', index, of: order.length, positions: read.flat };
    const frames = structureAttemptFrames({
      ...rest,
      positions: read.flat, elements, bonds,
      restraints: clean.list, dihedrals, index, seed, tolerance,
    });
    let next = frames.next();
    while (!next.done) { yield next.value; next = frames.next(); }
    const attempt = next.value;
    attempts.push(attempt);
    if (typeof onAttempt === 'function') {
      try {
        onAttempt(attempt, { index, of: order.length, start: clean.count });
      } catch { /* un rapport qui se plaint n'arrête pas le calcul */ }
    }
    yield { phase: 'attempt-done', index, of: order.length, attempt, positions: attempt.positions };
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
    /* ⛓ CE QUE LE CALCUL A PORTÉ EN PLUS DES DISTANCES — les φ/ψ imposés, tels quels : le
       panneau les compte dans sa progression, et un calcul SANS distance (le cas que la
       demande ouvre) se lit donc sans ambiguïté (`restraintCount` = 0, `dihedralCount` > 0). */
    dihedrals: dh,
    dihedralCount: dh.length,
    dropped: clean.dropped,
    tolerance,
    stopped,
  };
}

/** LE CALCUL, D'UN TRAIT — le même générateur conduit jusqu'au bout (l'appelant qui
 *  veut la famille classée, et les tests). `onFrame` reçoit CHAQUE image de CHAQUE
 *  départ : c'est l'ancien `onStep`, sans une ligne de différence. */
export const structureCalculationOf = (spec = {}) =>
  drainFrames(structureCalculationFrames(spec), spec.onFrame);
