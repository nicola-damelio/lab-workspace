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
           + Σ_rings w_r (δ − 0)²   +  Σ_pairs w_p (d − d₀)²  +  w_t Σ |r − r₀|²

     • les liaisons et les angles viennent du GRAPHE DE LIAISONS de la molécule
       (les éléments de ses atomes, l'ordre de liaison quand le fichier le
       déclare) — jamais d'une distance devinée ici ;
     • les cibles d₀ et θ₀ sont celles des tables ci-dessous : C–C 1.54, C–N 1.47,
       C–O 1.43, C–H 1.09 Å, S–S 2.05 Å… et 109.47° (sp3) · 120° (sp2) · 180° (sp) ;
     • les termes `rings` tiennent PLAT un cycle que le FICHIER dit plan (cinq ou six
       atomes, liaisons ≤ 1.45 Å — 1.48 pour un cycle DÉJÀ plissé, voir
       PLANAR_RING_KEEP_MAX_BOND : le benzène, les bases des acides nucléiques) :
       l'ÉCART À LA PLANÉITÉ de chacun de ses dièdres consécutifs, pris à zéro
       (δ = asin(sin φ), en degrés — nul pour un cycle plan dans les DEUX conventions
       du dièdre, 90° pour un cycle plié en deux). Sans eux, la cible ne sait pas
       distinguer un benzène d'un cyclohexane autrement que par la valeur de l'angle
       (120° contre 109.47°) — et un cycle garde ses angles EXACTS en se plissant
       (c'est ce que fait un cyclohexane à sedia), donc rien n'empêchait un benzène de
       perdre sa planéité. MESURÉ : sans ce terme, un benzène dont la descente doit
       rapprocher deux atomes à 3 Å se plisse de 21.6° en gardant ses angles à 0.1°
       près ; avec lui, il reste plan à 0.02° près, et la distance demandée s'arrête à
       3.11 Å au lieu de 3.04 — le rapport le DIT au lieu de plier le cycle en
       silence (voir `_geometry_relax_test.mjs`) ;
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

   ELLE DESCEND PAR ÉTAPES, AVEC UNE REPRISE APRÈS CHACUNE. « Le programme
   commence à rapprocher les deux atomes pas à pas », dit la demande — et pas à pas
   veut dire ici deux choses :

     · la distance demandée descend par PALIERS de RELAX_STAGE_STEP ångströms (2 par
       défaut) : 18, puis 16, puis 14… jusqu'à la cible. Un palier est une descente
       COURTE (le budget de pas est partagé entre les paliers) ;
     · après chaque palier, la fenêtre ENTIÈRE est relâchée une fois : la distance
       ATTEINTE devient la cible du terme de paire (la contrainte cesse de tirer,
       elle tient) et les liaisons, les angles, les cycles et la longe reprennent
       seuls, pendant RELAX_RESTORE_STEPS pas. C'est la REPRISE.

   C'est ce découpage qui fait aboutir un rapprochement LOINTAIN : MESURÉ, sur un
   cycle portant une chaîne dont deux atomes doivent passer de 7.35 Å à 3.00 Å, la
   descente d'un seul tenant reste à 6.94 Å (elle ne bouge presque pas — la tension
   de la contrainte la bloque) quand la MÊME descente par paliers de 2 Å atteint
   3.11 Å ; sur deux chaînes à 7.50 Å, 7.57 Å contre 2.22 Å. Et la reprise fait
   arriver un modèle DÉTENDU : les écarts de liaison à l'arrivée passent de 0.0144 Å
   rms (sans reprise) à 0.0087 Å (avec), et la dernière reprise resserre encore les
   angles du geste (0.093° → 0.079°). Le geste se termine donc sur une géométrie
   relâchée, jamais sur une géométrie en pleine contrainte. UN SEUL PALIER (cible
   toute proche, ou RELAX_STAGE_STEP à 0) reste le geste d'AVANT : une descente, la
   contrainte posée d'un bout à l'autre, puis une reprise.

   ELLE SAIT AUSSI SORTIR D'UNE BUCHE LOCALE — LES ÉCHAPPÉES (`escapes` > 0).
   Une plus grande pente s'arrête au PREMIER creux de sa fonction cible : « the
   descent found nowhere left to go ». Or c'est exactement ce creux qui rendait le
   geste inutilisable sur un REPLIEMENT lointain — deux atomes que seule une
   AUTRE conformation peut rapprocher, et la molécule restait étirée, pliée de
   travers, la cible non atteinte. Le module sait donc rejouer la descente depuis
   d'autres conformations :

     · chaque essai est une BOTTE DE TORSION — une rotation RIGIDE d'une partie de
       la fenêtre autour d'une liaison (`torsionKickOf`), d'un angle tiré entre
       ±`kickDeg` (70° par défaut, décroissant jusqu'à `RELAX_MIN_KICK_DEG` d'un
       essai au suivant : les premiers explorent, les derniers ajustent). Le côté
       tourné est choisi pour que la distance DEMANDÉE change vraiment (un des deux
       atomes de la paire d'un côté de la liaison, l'autre de l'autre), tous ses
       atomes sont dans la fenêtre, et une liaison de CYCLE est refusée comme
       partout ailleurs : une botte ne déforme aucun cycle. Longueurs et angles du
       côté tourné sont préservés AU CHIFFRE près — c'est une rotation rigide, donc
       le modèle ne repart jamais d'une géométrie cassée ;
     · la botte est suivie d'une DESCENTE COURTE (`escapeSteps`, 60 pas) ;
     · le MEILLEUR modèle est gardé et la botte suivante repart de LUI : c'est la
       « Monte Carlo minimization » (Li & Scheraga, 1987) — aucune étape n'est
       acceptée médiocre, et le modèle rendu n'est JAMAIS moins bon que celui de la
       descente ordinaire ;
     · le tirage est à GRAINE FIXE (`seed`, RELAX_ESCAPE_SEED) : le même modèle et
       le même geste donnent le même construit, au chiffre près. Rien ici n'est
       imprévisible ;
     · le choix entre deux modèles ne regarde pas que l'énergie : les CONTACTS
       TROP COURTS comptent aussi (`clashReportOf`, RELAX_CLASH_WEIGHT). Deux
       atomes que le graphe ne relie pas à moins de RELAX_CLASH_DISTANCE (1.45 Å)
       ne sont pas deux atomes côte à côte, c'est une géométrie irréalisable — et
       une échappée qui en crée n'est gardée que si elle est très nettement
       meilleure par ailleurs. MESURÉ, sur le rapprochement que la descente ne sait
       pas faire (soixante carbones, 153 Å → 3 Å) : la descente seule rend 4 couples
       plus proches que 1.45 Å, le plus court à 0.75 Å ; le modèle gardé par les six
       bottes n'en a plus que 2, le plus court à 1.28 Å — et la paire demandée passe
       de 13.52 à 12.52 Å, l'énergie de 12594 à 9596. C'est le critère des contacts
       qui a choisi entre ces modèles, pas seulement l'énergie.

   ⚠ CE QUE CE N'EST PAS, et le rapport le redit :
     • ce n'est PAS un champ de forces : aucune charge, aucun van der Waals, aucun
       solvant, aucune entropie, aucun hydrogène ajouté. Les longueurs et les angles
       sont des cibles IDÉALISÉES, donc le résultat est un modèle géométriquement
       valide (« chemically valid » au sens de la demande), jamais une énergie en
       kcal/mol ;
     • la descente est LOCALE : une structure dont les atomes devraient franchir une
       barrière ne se fermera pas — c'est ce que les 🎲 échappées (`escapes`)
       rattrapent, en rejouant la descente depuis d'autres conformations et en
       gardant le meilleur modèle. Quand elles n'y arrivent pas non plus, le rapport
       dit la distance RÉELLEMENT obtenue et les contacts trop courts qui restent :
       il n'invente jamais un pont ;
     • la planéité d'un cycle est TENUE, jamais devinée : seuls les cycles que le
       fichier dit plans (liaisons ≤ 1.45 Å) sont tenus plats, et un cyclohexane ou un
       sucre gardent leur plissement à 109.47° — le module ne décide pas à leur place
       de l'aromaticité d'un cycle dont les liaisons sont longues ;
     • seuls les atomes de `movable` bougent. Tout le reste est rendu BIT À BIT
       (l'ancrage d'une fenêtre est ce qui permet de refermer une boucle sans
       déplacer la protéine entière) — SAUF quand `rebuild` est demandé : la partie
       que la fenêtre ne bouge pas est alors REBÂTIE à chaque pas (longueurs et
       angles standard, dièdres gardés, §7bis) donc elle SUIT le geste au lieu de
       l'ÉTIRER ;
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

/** LA MÊME MESURE, POUR TENIR UN CYCLE PLAT — un cheveu plus large que
 *  PLANAR_RING_MAX_BOND, et pour une raison mesurable : un cycle qu'un geste
 *  PRÉCÉDENT a déjà plissé a des liaisons allongées (1.39 → 1.46 Å pour un
 *  plissement de 30°), et c'est justement ce cycle-là qu'il faut remettre à plat.
 *  À 1.45 il n'est plus reconnu du tout, donc jamais redressé. À 1.48 il l'est, et
 *  le chiffre reste très loin d'une liaison simple (C–C 1.54) comme de la moyenne
 *  d'un cycle de sucre (1.50 : un pyranose ne passe pas — vérifié). Les cibles de
 *  LIAISON et d'ANGLE, elles, gardent PLANAR_RING_MAX_BOND : rien ne change pour
 *  les longueurs ni pour les 120°. */
export const PLANAR_RING_KEEP_MAX_BOND = 1.48;

/* ── 2 · LES POIDS ET LES BORNES ─────────────────────────────────────────────
   Les unités sont celles du rapport : des ångströms et des degrés. Un écart de
   0.1 Å sur une longueur coûte 2, un écart de 10° sur un angle coûte 20 — les deux
   familles se tiennent donc de près, comme dans un champ de forces où une liaison
   est une dizaine de fois plus raide qu'un angle (mesuré : avec un poids d'angle
   de 0.02, dix fois plus faible, la descente satisfaisait une distance lointaine
   en ÉCRASANT des angles de 45° — un modèle chimiquement faux ; à 0.2 elle préfère
   ne pas atteindre la cible et le DIRE). La distance DEMANDÉE par l'utilisateur
   pèse un quart d'une liaison : elle pilote le geste sans jamais avoir le droit de
   détruire la géométrie, et la longe garde le changement local.
   Le cycle PLAN pèse cinq fois un angle (1 contre 0.2, en degrés² comme lui) : un
   plissement de 20° coûte 400, soit plus qu'un ångström entier d'écart sur une
   liaison (200). MESURÉ, sur un benzène dont la contrainte doit rapprocher deux
   atomes à 3 Å : sans le terme il se plisse de 21.6° (ses angles restent à 0.1° près,
   donc rien ne l'en empêchait), et de 0.2 à 4 il reste plan à 0.02° près — la
   distance demandée s'arrête alors à 3.08-3.11 Å au lieu de 3.04, et le rapport dit
   la distance RÉELLEMENT obtenue. Plus lourd ne change pas le cycle et éloigne la
   contrainte d'un cheveu : 1 est le milieu utile. */

export const RELAX_WEIGHTS = { bond: 200, angle: 0.2, planar: 1, pair: 50, tether: 0.5 };

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

/** LE REBÂTIMENT DE LA PARTIE HORS FENÊTRE (voir `rebuildStandardGeometry`, §7bis).
 *  La fenêtre seule bouge, donc les atomes qu'elle laisse de côté gardent leur
 *  position — c'est ce qui rend le geste local, et c'est aussi ce qui ÉTIRE la
 *  molécule : quand la fenêtre doit se plier pour rapprocher deux atomes, la chaîne
 *  qui l'entoure reste où elle était, les liaisons qui enjambent le bord se tendent,
 *  et rien ne se resserre. Le geste d'APRÈS rebâtit donc cette partie-là À CHAQUE
 *  PAS, depuis la géométrie standard — la longueur de la table, l'angle de
 *  l'hybridation du sommet, et le DIÈDRE qu'elle avait : elle peut bouger, la
 *  molécule se resserre, et aucune longueur ne reste étirée.
 *
 *  `RELAX_REBUILD` est le défaut du MODULE (« false » : le geste d'avant, celui que
 *  mesurent les sondes du dossier — la fenêtre seule bouge, le reste est rendu bit à
 *  bit), `RELAX_DEFAULT_REBUILD` est celui du PANNEAU (le ⚒ rebâtit : c'est la
 *  demande, mot pour mot — « it would be like rebuilding from scratch the part of
 *  the molecule not included in the calculation »). */
export const RELAX_REBUILD = false;
export const RELAX_DEFAULT_REBUILD = true;

/** LE RAPPROCHEMENT PAR ÉTAPES — « commence par 18 Å, relâche, puis 16, relâche… ».
 *  `RELAX_STAGE_STEP` est l'écart entre deux paliers de la distance DEMANDÉE (18 →
 *  16 → 14 … ; un palier plus grand que l'écart total n'en fait qu'un), et
 *  `RELAX_MAX_STAGES` le découpage maximal — au-delà, la fin du geste ne bouge plus
 *  et cent paliers ne feraient que payer des pas. Chaque palier reçoit
 *  `RELAX_MIN_STAGE_STEPS` pas au moins, le budget reçu (`steps`) étant partagé
 *  entre eux. Un palier de 0 Å, ou un seul palier, rend le geste d'AVANT : une
 *  seule descente, la contrainte posée d'un bout à l'autre. */
export const RELAX_STAGE_STEP = 2;
export const RELAX_MAX_STAGE_STEP = 12;
export const RELAX_MAX_STAGES = 24;
export const RELAX_MIN_STAGE_STEPS = 40;

/** LA REPRISE — les pas de la descente qui RELÂCHE la fenêtre après chaque palier,
 *  la distance atteinte tenue telle quelle (voir `relaxGeometry`). C'est elle qui
 *  résorbe la tension accumulée par le rapprochement ; à 0, plus aucune reprise :
 *  la fin de chaque palier resterait sous contrainte, avec la géométrie tordue que
 *  la demande reprochait au geste. */
export const RELAX_RESTORE_STEPS = 80;

/** LE RESSORT DE LA REPRISE — le facteur appliqué au poids des distances demandées
 *  pendant une reprise. La reprise ne conduit plus la contrainte, elle la TIENT : un
 *  ressort plus raide (8×) empêche la détente de la géométrie de repartir avec la
 *  distance obtenue. MESURÉ, sur un cycle que la contrainte doit plier (7.35 → 3.00 Å) :
 *  avec le ressort de la descente, la reprise éloignait la distance demandée de 0.07 Å
 *  (3.11 → 3.18 Å) pour 0.008 Å de liaisons gagnés ; avec celui-ci, la distance ne
 *  bouge plus que de 0.02 Å pendant la reprise et la dernière reprise AMÉLIORE encore
 *  les angles du geste. */
export const RELAX_RESTORE_STIFFNESS = 8;

/* ── LES ÉCHAPPÉES — SORTIR D'UNE BUCHE LOCALE ─────────────────────────────────
   Une descente de plus grande pente s'arrête au premier creux. `escapes` est le
   nombre de BOTTES DE TORSION que le module a le droit d'essayer après elle,
   chacune suivie d'une descente courte, le meilleur modèle étant gardé (voir
   `relaxGeometry` et l'en-tête du module). Trois chiffres :

     · `RELAX_ESCAPES` — la valeur par DÉFAUT du module : **0**. C'est le geste
       d'AVANT (une seule descente) et c'est ce que mesurent les sondes du dossier ;
       les échappées sont un geste qu'on DEMANDE (le panneau du viewer envoie le
       sien, `RELAX_DEFAULT_ESCAPES` = 6) ;
     · `RELAX_ESCAPE_STEPS` — les pas de la descente qui suit chaque botte (60 :
       assez pour retomber dans un creux, pas assez pour refaire le geste entier) ;
     · `RELAX_KICK_DEG` → `RELAX_MIN_KICK_DEG` — l'amplitude de la botte, en
       degrés : elle DÉCROÎT d'un essai au suivant (70° → 12°), donc les premières
       bottes explorent des conformations franchement différentes et les dernières
       ajustent la fin du repliement. */
export const RELAX_ESCAPES = 0;
export const RELAX_DEFAULT_ESCAPES = 6;
export const RELAX_MAX_ESCAPES = 24;
export const RELAX_ESCAPE_STEPS = 60;
export const RELAX_KICK_DEG = 70;
export const RELAX_MIN_KICK_DEG = 12;
export const RELAX_MAX_KICK_DEG = 179;

/** LA GRAINE DES BOTTES — fixe. Le module n'est donc pas « déterministe parce
 *  qu'il ne tire rien » mais « déterministe parce que ses tirages sont à graine
 *  fixe » : le même modèle, le même geste, le même construit, au chiffre près. */
export const RELAX_ESCAPE_SEED = 20240928;

/** LES CONTACTS TROP COURTS — deux atomes que le graphe ne LIE pas et qui se
 *  retrouvent à moins de `RELAX_CLASH_DISTANCE` (1.45 Å) : ce ne sont pas deux
 *  atomes côte à côte, c'est une géométrie irréalisable (un atome passé à travers
 *  un autre). Le module ne met PAS ce terme dans la fonction cible — il n'y a
 *  aucun van der Waals ici, ce n'est pas un champ de forces — il les COMPTE
 *  (`clashReportOf`, que le rapport affiche) et il s'en sert comme d'un SECOND
 *  critère pour choisir entre deux modèles pendant les échappées : `RELAX_CLASH_WEIGHT`
 *  est le prix (en unités de la fonction cible) d'un ångström carré de recouvrement. */
export const RELAX_CLASH_DISTANCE = 1.45;
export const RELAX_CLASH_WEIGHT = 60;

/** LES TROIS TOLÉRANCES dont le rapport se sert pour DIRE que c'est fait : « la
 *  liaison est à sa longueur », « l'angle est respecté », « la distance demandée
 *  est atteinte ». */
export const RELAX_BOND_TOLERANCE = 0.05;   // Å
export const RELAX_ANGLE_TOLERANCE = 2;     // degrés
export const RELAX_PLANAR_TOLERANCE = 2;    // degrés — « le cycle est resté plan »
export const RELAX_PAIR_TOLERANCE = 0.05;   // Å

/** LE CONSTRUIT AUTOMATIQUE — LE BALAYAGE DES LONGUEURS FAUSSES (voir §7ter et
 *  `buildModelGeometry`). La demande, mot pour mot :
 *
 *    « model build should also work without defining the atoms to bring closer and
 *      their distance : the function should find the wrong distances by itself and
 *      apply the “bring them closer step by step”/“relax”/“rebuild” protocol (the
 *      one already defined for two atoms) to impose the right distances until
 *      everything is back. If the protocol on the first distance has generated
 *      other wrong distances, move on to the second. »
 *
 *  `RELAX_BAD_BOND_TOLERANCE` est donc À PARTIR DE QUAND une longueur est DITE
 *  fausse, et son chiffre n'est pas arbitraire : il doit rester NETTEMENT au-dessus
 *  de `RELAX_BOND_TOLERANCE` (0.05 Å), qui est l'écart que le protocole lui-même
 *  laisse derrière lui. Entre les deux il y a un rapport de quatre, donc une
 *  distance conduite jusqu'à sa cible (≤ 0.05 Å) n'est JAMAIS relue comme fausse au
 *  balayage suivant, et la boucle « conduis, rebalaye, passe à la suivante »
 *  descend au lieu d'osciller. À 0.2 Å, une liaison simple est fausse de plus de
 *  13 % (C–C 1.54 → 1.74), ce qui est exactement le genre d'écart qu'un modèle
 *  laissé par un geste — une S–S déclarée mais posée à 6 Å, une chaîne étirée, une
 *  molécule glissée à la main — porte, tandis qu'un PDB réel (ses longueurs sont à
 *  0.01-0.03 Å de la table) ne déclenche rien du tout. */
export const RELAX_BAD_BOND_TOLERANCE = 0.2;   // Å
/** Combien de BALAYAGES COMPLETS le construit automatique a le droit de faire : un
 *  balayage conduit toutes les distances fausses qu'il vient de trouver, puis
 *  REEXAMINE la molécule — les distances qui sont apparues à cause de son propre
 *  geste (« se il protocollo sulla prima distanza ha generato altre distanze
 *  incorrette si passa alla seconda ») sont celles du balayage suivant. Six est le
 *  chiffre mesuré sur une chaîne étirée et sur un repliement, avec de la marge. */
export const RELAX_AUTO_PASSES = 6;
/** Combien de distances un balayage conduit AU PLUS (le plafond n'est pas caché :
 *  `truncated` le dit dans le rapport). Chaque distance coûte une descente entière
 *  (§8), donc une protéine dont la géométrie est entièrement fausse ne doit pas
 *  figer l'écran sans que l'utilisateur sache pourquoi. */
export const RELAX_AUTO_MAX_DISTANCES = 24;

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

/** LE PLUS COURT CHEMIN ENTRE DEUX ATOMES, AVEC SON CHEMIN — la même recherche en
 *  largeur que `shortestPath`, mais elle rend la LISTE des atomes traversés (de
 *  `from` à `to`, les deux compris) au lieu de sa longueur. Un cycle a besoin de son
 *  ORDRE (c'est lui qui donne ses dièdres) ; sa taille, elle, se lit en deux lignes
 *  (`shortestPath`, qui reste donc la version la moins chère pour les 4000 atomes
 *  d'une protéine). Rend `null` quand aucun chemin de `cap` liaisons n'existe. */
const shortestPathAtoms = ({ neighbours, from, to, avoid, cap }) => {
  if (from === to) return [from];
  const parent = new Map([[from, -1]]);
  if (isIndex(avoid)) parent.set(avoid, -1);      // le pivot : traversé, jamais posé
  let frontier = [from];
  for (let depth = 1; depth <= cap; depth += 1) {
    const next = [];
    for (const cur of frontier) {
      let list = [];
      try { list = neighbours(cur) || []; } catch { list = []; }
      for (const raw of list) {
        const i = Number(raw);
        if (!isIndex(i) || parent.has(i)) continue;
        parent.set(i, cur);
        if (i === to) {
          const path = [i];
          for (let a = cur; a !== -1; a = parent.get(a)) path.push(a);
          return path.reverse();
        }
        next.push(i);
      }
    }
    if (!next.length) return null;
    frontier = next;
  }
  return null;
};

/**
 * LE PLUS PETIT CYCLE QUI TRAVERSE UN ATOME, DANS SON ORDRE (liste vide = aucun).
 * Même méthode que `ringSizeThrough` — chaque couple de voisins de l'atome relié
 * par le plus court chemin qui l'évite — mais elle rend la SUITE DES ATOMES du
 * cycle : `[atome, voisin, …, voisin]`, chacun lié au suivant et le dernier au
 * premier. C'est ce que `planarRingsOf` lit ses dièdres dans l'ordre du cycle.
 */
export const ringCycleThrough = ({ neighbours, atom, cap = 6 }) => {
  if (typeof neighbours !== 'function' || !isIndex(atom)) return [];
  let list = [];
  try { list = neighbours(atom) || []; } catch { list = []; }
  const nb = [...new Set(list.map(Number).filter((i) => isIndex(i) && i !== atom))];
  if (nb.length < 2) return [];
  const limit = Math.max(1, (Number(cap) || 6) - 2);
  let best = null;
  for (let a = 0; a < nb.length; a += 1) {
    for (let b = a + 1; b < nb.length; b += 1) {
      const path = shortestPathAtoms({ neighbours, from: nb[a], to: nb[b], avoid: atom, cap: limit });
      if (path && (!best || path.length + 2 < best.length)) best = [atom, ...path];
    }
  }
  return best || [];
};

/**
 * LES CYCLES QUE LE FICHIER DIT PLANS — ceux que `buildRelaxTerms` tient plans.
 *
 * Le critère est celui de la maison, un cheveu plus large : un cycle de CINQ ou SIX
 * atomes dont les liaisons sont COURTES (moyenne ≤ PLANAR_RING_KEEP_MAX_BOND,
 * 1.48 Å — le benzène 1.39, un benzène DÉJÀ plissé 1.46, jamais un cyclohexane à
 * 1.53 ni un sucre à 1.50 en moyenne). La géométrie REÇUE est donc indispensable :
 * sans elle, aucun cycle n'est déclaré plan (c'est déjà la règle de `hybridOf`, et
 * pour la même raison — mieux vaut un cycle souple qu'un cycle inventé).
 *
 * L'entrée est un atome dont TOUTES les liaisons viennent d'être mesurées courtes :
 * c'est ce qui laisse entrer les atomes SUBSTITUÉS d'un cycle (le Cγ d'une
 * phénylalanine porte son Cβ à 1.51 Å — il n'est donc pas candidat, mais ses
 * voisins de cycle, eux, le sont, et le cycle trouvé les comprend tous). Un cycle
 * dont AUCUN atome n'a toutes ses liaisons courtes n'est pas vu : il reste plissé,
 * ce qui est la bonne réponse pour lui.
 *
 * @returns {{atoms:number[], size:number, meanBond:number}[]} l'ordre du cycle, sa
 *   taille et la MOYENNE de ses liaisons lues, pour chaque cycle plan distinct.
 */
export const planarRingsOf = ({
  neighbours = null, positions = null, atomCount = 0, cap = 6,
  maxBond = PLANAR_RING_KEEP_MAX_BOND,
} = {}) => {
  if (typeof neighbours !== 'function') return [];
  const count = Math.max(0, Math.round(Number(atomCount) || 0));
  const read = flatPositions(positions);
  const x = read && (!count || read.count === count) ? read.flat : null;
  if (!x) return [];                       // sans géométrie, aucun cycle n'est plan
  const limit = Number(maxBond) > 0 ? Number(maxBond) : PLANAR_RING_KEEP_MAX_BOND;
  const pt = (i) => [x[i * 3], x[i * 3 + 1], x[i * 3 + 2]];
  const rings = [];
  const seen = new Set();
  for (let a = 0; a < count; a += 1) {
    let nbs = [];
    try { nbs = neighbours(a) || []; } catch { nbs = []; }
    const heavy = [...new Set(nbs.map(Number).filter((i) => isIndex(i) && i < count && i !== a))];
    if (heavy.length < 2) continue;
    if (!heavy.every((i) => dist3(pt(a), pt(i)) <= limit)) continue;
    const cycle = ringCycleThrough({ neighbours, atom: a, cap });
    if (!PLANAR_RING_SIZES.has(cycle.length)) continue;
    const key = [...cycle].sort((p, q) => p - q).join('-');
    if (seen.has(key)) continue;
    let sum = 0;
    for (let k = 0; k < cycle.length; k += 1) {
      sum += dist3(pt(cycle[k]), pt(cycle[(k + 1) % cycle.length]));
    }
    const meanBond = sum / cycle.length;
    if (!(meanBond <= limit)) continue;
    seen.add(key);
    rings.push({ atoms: [...cycle], size: cycle.length, meanBond });
  }
  return rings;
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
   Quatre listes, et rien d'autre : les liaisons (avec leur longueur cible), les
   angles (avec leur angle cible), les cycles PLANS (avec leurs dièdres), et les
   distances DEMANDÉES. `positions` est optionnel — il ne sert qu'à juger si un
   cycle est plan (PLANAR_RING_MAX_BOND) ; sans lui, ni liaison aromatique ni cycle
   plan n'est déclaré, et la fonction cible ne les mentionne pas. */

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
 * @returns {{count:number, bonds:object[], angles:object[], planars:object[],
 *            pairs:object[], hybrids:any[], ringSizes:number[], ringMeans:any[],
 *            planarRings:object[], bondCount:number, unknownBonds:number,
 *            aromaticBonds:number}}
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

  /* LES CYCLES PLANS — un cycle de cinq ou six atomes dont les liaisons mesurent
     ≤ 1.48 Å (voir planarRingsOf) porte un dièdre de PLUS par paire d'atomes
     consécutifs du cycle, visé à 0°. C'est ce qui tient le benzène PLAT : les
     liaisons et les angles ne savent pas le faire (un cycle garde ses angles exacts
     en se plissant), et sans ce terme la contrainte de l'utilisateur pouvait le
     plier en laissant croire que tout allait bien. */
  const planarRings = planarRingsOf({ neighbours, positions: x, atomCount: count });
  const planarTerms = [];
  for (const ring of planarRings) {
    const n = ring.size;
    for (let k = 0; k < n; k += 1) {
      planarTerms.push({
        i: ring.atoms[k], j: ring.atoms[(k + 1) % n],
        k: ring.atoms[(k + 2) % n], l: ring.atoms[(k + 3) % n],
        target: 0, weight: Number(weights.planar) || 0, ring: ring.atoms.join('-'),
      });
    }
  }

  return {
    count, bonds: bondTerms, angles: angleTerms, planars: planarTerms, pairs: pairTerms,
    hybrids, ringSizes, ringMeans, planarRings,
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
 *   · un cycle plan       δ = DEG·asin( Y / √(X² + Y²) ) — l'ÉCART À LA PLANÉITÉ du
 *                         dièdre i–j–k–l, en degrés, avec u = rᵢ − rⱼ, v = r_k − rⱼ,
 *                         w = r_l − r_k, D = u·(v×w), V = |v|², p = u·v, q = v·w,
 *                         s = u·w, X = p·q − s·V et Y = |v|·D. Quatre atomes sont
 *                         coplanaires quand sin φ = 0, soit φ = 0° COMME φ = 180° :
 *                         δ vaut donc 0° pour un cycle plan dans l'une ou l'autre
 *                         convention, 90° pour un cycle plié en deux ; E = w_r δ²
 *        ∂δ/∂r = signe(cos φ)·DEG·(X·∂Y/∂r − Y·∂X/∂r) / (X² + Y²)
 *                 — la règle du quotient d'un atan2, fois le signe de cos φ
 *        ∂X/∂rᵢ = q·v − V·w                    ∂Y/∂rᵢ = |v|·(v×w)
 *        ∂X/∂rⱼ = −(u+v)q − p·w + V·w + 2s·v   ∂Y/∂rⱼ = |v|(−(v×w) − (w×u)) − (D/|v|)·v
 *        ∂X/∂r_k = u·q + p(w−v) + u·V − 2s·v   ∂Y/∂r_k = |v|((w×u) − (u×v)) + (D/|v|)·v
 *        ∂X/∂rₗ = p·v − V·u                    ∂Y/∂rₗ = |v|·(u×v)
 *        Ces dérivées sont MESURÉES à 1e-8 par différences finies : la formule qu'on
 *        trouve « dans la littérature » ne tombait juste que pour deux des quatre
 *        atomes, et elle a été jetée après mesure (voir energyOf, les cycles plans).
 *        Quatre atomes alignés (X² + Y² = 0) n'ont aucun dièdre : le terme est sauté,
 *        comme l'angle plat — c'est la seule singularité de cette famille.
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
 * @returns {{total:number, bond:number, angle:number, planar:number, pair:number,
 *            tether:number, bondRms:number, angleRms:number, planarRms:number,
 *            worstBond:object|null, worstAngle:object|null, worstPlanar:object|null}}
 */
export const energyOf = (terms, x, {
  grad = null, hess = null, ref = null, tether = 0, movable = null,
} = {}) => {
  const out = {
    total: 0, bond: 0, angle: 0, planar: 0, pair: 0, tether: 0,
    bondRms: 0, angleRms: 0, planarRms: 0,
    worstBond: null, worstAngle: null, worstPlanar: null,
  };
  if (grad) grad.fill(0);
  if (hess) hess.fill(0);
  let nBonds = 0; let sumBonds = 0; let nAngles = 0; let sumAngles = 0;
  let nPlanars = 0; let sumPlanars = 0;

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

  /* LES CYCLES PLANS — le dièdre i–j–k–l du cycle, visé à zéro. Il se lit en atan2 de
     DEUX SCALAIRES : X = (u×v)·(v×w) = (u·v)(v·w) − (u·w)(v·v) et Y = |v|·u·(v×w).
     Aucun acos hors bornes, aucune division par zéro : c'est un atan2. Le gradient est
     ANALYTIQUE — celui d'un atan2, ∂φ = (X·∂Y − Y·∂X)/(X² + Y²), avec les dérivées de
     X et de Y écrites une fois pour les quatre atomes (douze lignes, ci-dessous).
     ⚠ La formule « de la littérature » a été essayée d'abord, et elle était FAUSSE :
     mesurée par différences finies, elle ne tombait juste que pour deux des quatre
     atomes. Celle-ci est mesurée pièce par pièce — ∂X, ∂Y, puis ∂φ — à 1e-8
     (_geometry_relax_test.mjs) : une dérivée écrite à la main ne vaut rien tant qu'on
     ne l'a pas mesurée. */
  for (const t of terms.planars || []) {
    const i = t.i; const j = t.j; const k = t.k; const l = t.l;
    const ux = x[i * 3] - x[j * 3]; const uy = x[i * 3 + 1] - x[j * 3 + 1]; const uz = x[i * 3 + 2] - x[j * 3 + 2];
    const vx = x[k * 3] - x[j * 3]; const vy = x[k * 3 + 1] - x[j * 3 + 1]; const vz = x[k * 3 + 2] - x[j * 3 + 2];
    const wx = x[l * 3] - x[k * 3]; const wy = x[l * 3 + 1] - x[k * 3 + 1]; const wz = x[l * 3 + 2] - x[k * 3 + 2];
    const rv = Math.hypot(vx, vy, vz);
    if (rv < 1e-9) continue;
    const p = ux * vx + uy * vy + uz * vz;          // u·v
    const q = vx * wx + vy * wy + vz * wz;          // v·w
    const sn = ux * wx + uy * wy + uz * wz;         // u·w  (`s` est le pas, plus bas)
    const V = vx * vx + vy * vy + vz * vz;          // v·v
    const dux = vy * wz - vz * wy; const duy = vz * wx - vx * wz; const duz = vx * wy - vy * wx;   // v×w
    const dvx = wy * uz - wz * uy; const dvy = wz * ux - wx * uz; const dvz = wx * uy - wy * ux;   // w×u
    const dwx = uy * vz - uz * vy; const dwy = uz * vx - ux * vz; const dwz = ux * vy - uy * vx;   // u×v
    const D = ux * dux + uy * duy + uz * duz;       // u·(v×w), le produit mixte
    const X = p * q - sn * V; const Y = rv * D;
    const den = X * X + Y * Y;
    if (!(den > 1e-12)) continue;      // quatre atomes alignés (ou confondus) : aucun dièdre
    /* L'ÉCART À LA PLANÉITÉ — δ = asin(sin φ), en degrés, et non φ lui-même : quatre
       atomes sont COPLANAIRES quand sin φ = 0, c'est-à-dire pour φ = 0° **comme pour
       φ = 180°**, et un cycle plan peut se présenter dans l'une ou l'autre convention
       (mesuré : l'hexagone régulier donne 0°, une même forme légèrement plissée donne
       177°). Viser φ = 0 punirait donc un cycle déjà plan. δ vaut 0 dans les deux cas,
       90° quand le cycle est plié en deux, et son signe est celui de sin φ. */
    const root = Math.sqrt(den);
    const sinPhi = Y / root;
    const cosPhi = X / root;
    const deg = Math.asin(sinPhi) * DEG;
    const dev = deg - t.target;
    out.planar += t.weight * dev * dev;
    nPlanars += 1; sumPlanars += dev * dev;
    if (!out.worstPlanar || Math.abs(dev) > Math.abs(out.worstPlanar.dev)) {
      out.worstPlanar = { i, j, k, l, deg, target: t.target, dev, ring: t.ring };
    }
    if (!grad && !hess) continue;
    /* LE JACOBIEN DU DIÈDRE — ∂φ°/∂r, atome par atome. ∂X et ∂Y se lisent sur ce qui
       est déjà là : la dérivée de (u·v)(v·w) − (u·w)(v·v) d'un côté, celle de
       |v|·u·(v×w) de l'autre, avec les trois produits vectoriels (v×w, w×u, u×v)
       calculés plus haut. Chaque atome porte SES deux vecteurs : c'est ce que la
       formule « de la littérature » ratait pour j et k. */
    const dr = D / rv;                       // D/|v|, la part de |v| dans ∂Y
    const xix = q * vx - V * wx; const xiy = q * vy - V * wy; const xiz = q * vz - V * wz;
    const yix = rv * dux; const yiy = rv * duy; const yiz = rv * duz;
    const xjx = -(ux + vx) * q - p * wx + V * wx + 2 * sn * vx;
    const xjy = -(uy + vy) * q - p * wy + V * wy + 2 * sn * vy;
    const xjz = -(uz + vz) * q - p * wz + V * wz + 2 * sn * vz;
    const yjx = -(dux + dvx) * rv - dr * vx;
    const yjy = -(duy + dvy) * rv - dr * vy;
    const yjz = -(duz + dvz) * rv - dr * vz;
    const xkx = ux * q + (wx - vx) * p + ux * V - 2 * sn * vx;
    const xky = uy * q + (wy - vy) * p + uy * V - 2 * sn * vy;
    const xkz = uz * q + (wz - vz) * p + uz * V - 2 * sn * vz;
    const ykx = (dvx - dwx) * rv + dr * vx;
    const yky = (dvy - dwy) * rv + dr * vy;
    const ykz = (dvz - dwz) * rv + dr * vz;
    const xlx = p * vx - V * ux; const xly = p * vy - V * uy; const xlz = p * vz - V * uz;
    const ylx = rv * dwx; const yly = rv * dwy; const ylz = rv * dwz;
    const kd = (cosPhi >= 0 ? DEG : -DEG) / den;
    const jix = kd * (X * yix - Y * xix); const jiy = kd * (X * yiy - Y * xiy); const jiz = kd * (X * yiz - Y * xiz);
    const jjx = kd * (X * yjx - Y * xjx); const jjy = kd * (X * yjy - Y * xjy); const jjz = kd * (X * yjz - Y * xjz);
    const jkx = kd * (X * ykx - Y * xkx); const jky = kd * (X * yky - Y * xky); const jkz = kd * (X * ykz - Y * xkz);
    const jlx = kd * (X * ylx - Y * xlx); const jly = kd * (X * yly - Y * xly); const jlz = kd * (X * ylz - Y * xlz);
    if (hess) {
      const w2 = 2 * t.weight;
      hess[i * 3] += w2 * jix * jix; hess[i * 3 + 1] += w2 * jiy * jiy; hess[i * 3 + 2] += w2 * jiz * jiz;
      hess[k * 3] += w2 * jkx * jkx; hess[k * 3 + 1] += w2 * jky * jky; hess[k * 3 + 2] += w2 * jkz * jkz;
      hess[j * 3] += w2 * jjx * jjx; hess[j * 3 + 1] += w2 * jjy * jjy; hess[j * 3 + 2] += w2 * jjz * jjz;
      hess[l * 3] += w2 * jlx * jlx; hess[l * 3 + 1] += w2 * jly * jly; hess[l * 3 + 2] += w2 * jlz * jlz;
    }
    if (grad) {
      const k2 = 2 * t.weight * dev;
      grad[i * 3] += k2 * jix; grad[i * 3 + 1] += k2 * jiy; grad[i * 3 + 2] += k2 * jiz;
      grad[k * 3] += k2 * jkx; grad[k * 3 + 1] += k2 * jky; grad[k * 3 + 2] += k2 * jkz;
      grad[j * 3] += k2 * jjx; grad[j * 3 + 1] += k2 * jjy; grad[j * 3 + 2] += k2 * jjz;
      grad[l * 3] += k2 * jlx; grad[l * 3 + 1] += k2 * jly; grad[l * 3 + 2] += k2 * jlz;
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
  out.planarRms = nPlanars ? Math.sqrt(sumPlanars / nPlanars) : 0;
  out.total = out.bond + out.angle + out.planar + out.pair + out.tether;
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
 * ── 7ter · LES LONGUEURS FAUSSES, TROUVÉES TOUT SEUL ─────────────────────────
 * « model build should also work without defining the atoms to bring closer and
 *   their distance » : la fonction cherche donc elle-même ce qu'il y a à corriger.
 *
 * Ce qu'elle regarde, et rien d'autre : les LIAISONS du graphe reçu, leur longueur
 * MESURÉE et la longueur que la table leur donne — exactement les cibles de la
 * fonction cible, puisqu'elles viennent du même `buildRelaxTerms` que la descente
 * (correction d'ORDRE et d'AROMATIQUE comprises : un cycle de benzène est attendu à
 * 1.39 Å, jamais à 1.54 — la cible de la lecture et celle de la descente ne peuvent
 * donc pas diverger, c'est la règle du dossier : jamais une seconde table). Une
 * liaison dont la table ne connaît pas le couple (un métal) est simplement LAISSÉE
 * hors du balayage et COMPTÉE (`unknownBonds`) : aucune longueur n'est inventée
 * pour si peu.
 *
 * ⚠ Ce que le balayage ne fait PAS, et le rapport ne doit pas le laisser croire :
 *   · il ne rapproche jamais deux atomes que le fichier ne DÉCLARE pas liés — un
 *     contact trop court est MESURÉ (`clashReportOf`) et affiché, jamais corrigé
 *     par une cible inventée (rien n'est deviné ici) ;
 *   · il ne juge pas les angles ni les cycles : ce sont les termes de la descente,
 *     elle s'en occupe pendant que chaque distance est conduite ;
 *   · il ne touche à rien : il lit les coordonnées reçues et rend une LISTE.
 *
 * Le classement est par ÉCART DÉCROISSANT (`|d − d₀|`), la plus fausse d'abord —
 * c'est elle qui a le plus de chances d'être la cause des autres —, et à écart égal
 * par indices croissants : le même modèle donne donc toujours le même ordre, donc
 * le même construit (le module est déterministe, c'est une règle du dossier).
 *
 * @param {{elements?:any[], bonds?:any[], positions?:any, tolerance?:number,
 *          terms?:object}} spec
 *   `tolerance` (0.2 Å par défaut, `RELAX_BAD_BOND_TOLERANCE`) = à partir de quel
 *   écart une longueur est dite fausse ; `terms` = les termes déjà construits,
 *   pour ne pas relire la molécule quand l'appelant les a sous la main.
 * @returns {{tolerance:number, count:number, distances:object[], worst:object|null,
 *            severity:number, checked:number, unknownBonds:number,
 *            aromaticBonds:number}|null}
 *   `distances` = `{i, j, target, distance, dev, abs, order}` de chaque liaison
 *   fausse, la pire d'abord ; `count` = combien ; `worst` = la pire (`null` quand
 *   tout est à sa longueur) ; `severity` = Σ |dev| — le chiffre que le construit
 *   automatique regarde pour savoir si un balayage a AMÉLIORÉ quelque chose ;
 *   `checked` = combien de liaisons la table connaît. `null` quand les coordonnées
 *   sont illisibles (une lecture qui n'a pas de réponse ne rend pas zéro).
 */
export const badDistancesOf = ({
  elements = [], bonds = [], positions = null, tolerance = RELAX_BAD_BOND_TOLERANCE,
  terms = null,
} = {}) => {
  const read = flatPositions(positions);
  if (!read) return null;
  const t = terms || buildRelaxTerms({ elements, bonds, positions: read.flat });
  const limit = Number(tolerance) >= 0 ? Number(tolerance) : RELAX_BAD_BOND_TOLERANCE;
  const x = read.flat;
  const pt = (i) => [x[i * 3], x[i * 3 + 1], x[i * 3 + 2]];
  const out = {
    tolerance: limit, count: 0, distances: [], worst: null, severity: 0,
    checked: t.bonds.length, unknownBonds: t.unknownBonds, aromaticBonds: t.aromaticBonds,
  };
  for (const b of t.bonds) {
    const distance = dist3(pt(b.i), pt(b.j));
    const dev = distance - b.target;
    const abs = Math.abs(dev);
    if (!(abs > limit)) continue;
    out.distances.push({
      i: b.i, j: b.j, target: b.target, distance, dev, abs,
      order: b.order == null ? 1 : b.order,
    });
  }
  /* LE CLASSEMENT — la plus fausse d'abord, et les indices pour départager : deux
     écarts égaux donnent toujours le même ordre, donc le même construit. */
  out.distances.sort((a, b) => (b.abs - a.abs) || (a.i - b.i) || (a.j - b.j));
  out.count = out.distances.length;
  out.worst = out.count ? { ...out.distances[0] } : null;
  for (const d of out.distances) out.severity += d.abs;
  return out;
};

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

/* ── 6bis · LES ÉCHAPPÉES — LA BOTTE, ET LES CONTACTS TROP COURTS ─────────── */

/**
 * UN TIRAGE REPRODUCTIBLE — mulberry32, trente-deux bits, aucune dépendance.
 * C'est lui qui rend les échappées compatibles avec la règle du module : « le
 * même modèle donne toujours le même construit ». La graine est fixe
 * (`RELAX_ESCAPE_SEED`), donc les mêmes bottes reviennent dans le même ordre,
 * avec les mêmes angles — vérifiable par deux appels identiques.
 */
export const makeRelaxRandom = (seed = RELAX_ESCAPE_SEED) => {
  let a = (Math.round(Number(seed)) >>> 0) || 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * LE CÔTÉ D'UNE LIAISON — les atomes que le graphe atteint depuis `atom` SANS
 * traverser la liaison atom–other. C'est la règle d'un chimiste, la même que
 * `movingSideOf` de utils/torsionDrive.js : une rotation autour de l'axe ne peut
 * déplacer que ce côté-là, l'autre reste l'ancrage.
 *
 * Rend `null` quand `other` est atteint AUTREMENT — la liaison est alors dans un
 * CYCLE, elle n'est pas une charnière, et `torsionKickOf` la refusera plutôt que
 * de déformer un cycle. `atom` lui-même n'est jamais dans la liste (il est SUR
 * l'axe, il ne bouge pas), `other` non plus.
 */
export const bondSideOf = ({ neighbours, atom, other, atomCount = 0 } = {}) => {
  if (typeof neighbours !== 'function' || !isIndex(atom) || !isIndex(other) || atom === other) return null;
  const limit = Math.max(0, Math.round(Number(atomCount) || 0));
  const seen = new Set([atom]);
  const side = [];
  let frontier = [atom];
  while (frontier.length) {
    const next = [];
    for (const cur of frontier) {
      let list = [];
      try { list = neighbours(cur) || []; } catch { list = []; }
      for (const raw of list) {
        const i = Number(raw);
        if (!isIndex(i) || (limit && i >= limit) || seen.has(i)) continue;
        if ((cur === atom && i === other) || (cur === other && i === atom)) continue;   // jamais l'axe
        if (i === other) return null;                 // atteint ailleurs : un cycle
        seen.add(i); side.push(i); next.push(i);
      }
    }
    frontier = next;
  }
  return side;
};

/** LA ROTATION RIGIDE D'UN CÔTÉ AUTOUR D'UN AXE (Rodrigue), par `angleDeg`. Le
 *  côté tourne, l'axe ne bouge pas : les longueurs ET les angles INTERNES au côté
 *  sont préservés au chiffre près, seuls les angles qui enjambent l'axe changent.
 *  Rend une COPIE des coordonnées — l'argument n'est jamais touché. */
const rotateSideOf = ({ positions, side, axis, angleDeg, bond }) => {
  const [a, b] = axis;
  const ax = positions[b * 3] - positions[a * 3];
  const ay = positions[b * 3 + 1] - positions[a * 3 + 1];
  const az = positions[b * 3 + 2] - positions[a * 3 + 2];
  const n = Math.hypot(ax, ay, az);
  if (!(n > 1e-9)) return { ok: false, reason: 'no-axis' };
  const ux = ax / n; const uy = ay / n; const uz = az / n;
  const rad = ((Number(angleDeg) || 0) * Math.PI) / 180;
  const c = Math.cos(rad); const s = Math.sin(rad);
  const ox = positions[a * 3]; const oy = positions[a * 3 + 1]; const oz = positions[a * 3 + 2];
  const x = positions.slice();
  for (const i of side) {
    const px = positions[i * 3] - ox;
    const py = positions[i * 3 + 1] - oy;
    const pz = positions[i * 3 + 2] - oz;
    const dot = px * ux + py * uy + pz * uz;          // u·p
    const qx = uy * pz - uz * py;                     // u×p
    const qy = uz * px - ux * pz;
    const qz = ux * py - uy * px;
    x[i * 3] = ox + px * c + qx * s + ux * dot * (1 - c);
    x[i * 3 + 1] = oy + py * c + qy * s + uy * dot * (1 - c);
    x[i * 3 + 2] = oz + pz * c + qz * s + uz * dot * (1 - c);
  }
  return { ok: true, positions: x, side: [...side], bond, angle: Number(angleDeg) || 0 };
};

/**
 * UNE BOTTE DE TORSION — la seule perturbation que les échappées s'autorisent.
 *
 * Elle tire une liaison au hasard (dans l'ordre d'un tirage à graine fixe), en
 * garde un côté, et le fait tourner RIGIDEMENT autour d'elle : le modèle qui en
 * sort a la même géométrie interne, seulement un dihèdre de plus. C'est
 * exactement le geste que la demande décrit (« changing the dihedral angles by
 * hand is useful but it is a lot of work ») — fait à la place de l'utilisateur,
 * pour sortir d'une buche locale.
 *
 *   · la liaison doit séparer le graphe (`bondSideOf` : une liaison de cycle est
 *     refusée — la botte ne déforme aucun cycle) ;
 *   · TOUS les atomes du côté tourné doivent être dans `movable` : la botte ne
 *     touche jamais un atome que l'appelant a laissé de côté ;
 *   · quand `seeds` est donné (les deux atomes de la distance DEMANDÉE), la
 *     liaison est choisie pour que la distance change VRAIMENT : un seul des deux
 *     grains du côté tourné. Une botte qui ne fait pas bouger la cible ne sert à
 *     rien ; le module en essaie d'autres, et retombe sur la première valable
 *     quand aucune ne fait mieux (`turned` le dit) ;
 *   · la recherche est plafonnée (`maxTries`, 60 liaisons essayées au plus) : un
 *     essai reste un clic, pas un parcours de la molécule entière.
 *
 * @returns {{ok:boolean, reason?:string, positions?:Float64Array|number[],
 *            side?:number[], bond?:{a:number,b:number}, angle?:number, turned?:number}}
 */
export const torsionKickOf = ({
  positions = null, bonds = [], atomCount = 0, movable = null, seeds = [],
  angleDeg = RELAX_KICK_DEG, rnd = null, maxTries = 60,
} = {}) => {
  const read = flatPositions(positions);
  if (!read) return { ok: false, reason: 'bad-points' };
  const count = Number(atomCount) > 0 && Number(atomCount) < read.count
    ? Number(atomCount) : read.count;
  const graph = bondGraphOf({ bonds, atomCount: count });
  const movSet = new Set((movable == null ? Array.from({ length: count }, (_, i) => i) : Array.from(movable))
    .map(Number).filter((i) => isIndex(i) && i < count));
  if (!movSet.size) return { ok: false, reason: 'no-movable' };
  if (!graph.list.length) return { ok: false, reason: 'no-bond' };
  const wanted = [...new Set(Array.from(seeds || []).map(Number).filter((i) => isIndex(i) && i < count))];
  const random = typeof rnd === 'function' ? rnd : makeRelaxRandom(RELAX_ESCAPE_SEED);
  const amp = Math.min(RELAX_MAX_KICK_DEG,
    Math.max(1, Number.isFinite(Number(angleDeg)) ? Math.abs(Number(angleDeg)) : RELAX_KICK_DEG));
  const angle = amp * (random() < 0.5 ? -1 : 1);
  /* LE TIRAGE DE LA LIAISON — un mélange de Fisher–Yates des candidates, donc une
     botte différente à chaque essai, dans un ordre que la graine décide. */
  const cand = graph.list.filter((b) => movSet.has(b.i) || movSet.has(b.j));
  if (!cand.length) return { ok: false, reason: 'no-bond' };
  for (let k = cand.length - 1; k > 0; k -= 1) {
    const j = Math.floor(random() * (k + 1));
    const tmp = cand[k]; cand[k] = cand[j]; cand[j] = tmp;
  }
  const tries = Math.max(1, Math.min(cand.length, Math.round(Number(maxTries) || 60)));
  let fallback = null;
  for (let t = 0; t < tries; t += 1) {
    const b = cand[t];
    for (const pair of [[b.i, b.j], [b.j, b.i]]) {
      const a = pair[0]; const other = pair[1];
      const side = bondSideOf({ neighbours: graph.neighbours, atom: a, other, atomCount: count });
      if (!side || !side.length) continue;                       // un cycle : aucune charnière
      if (!side.every((i) => movSet.has(i))) continue;            // un atome hors fenêtre
      const turned = wanted.length ? side.filter((i) => wanted.includes(i)).length : 0;
      const bond = { a, b: other };
      if (!wanted.length || turned === 1) {
        /* LA BOTTE QUI CHANGE LA CIBLE — un atome de la paire d'un côté, l'autre
           de l'autre : la rotation déplace forcément leur distance. */
        const done = rotateSideOf({ positions: read.flat, side, axis: [a, other], angleDeg: angle, bond });
        if (done.ok) { done.turned = turned; done.count = count; }
        return done;
      }
      if (!fallback) fallback = { bond, side, turned };
    }
  }
  if (!fallback) return { ok: false, reason: 'no-bridge' };
  const done = rotateSideOf({
    positions: read.flat, side: fallback.side, axis: [fallback.bond.a, fallback.bond.b],
    angleDeg: angle, bond: fallback.bond,
  });
  if (done.ok) { done.turned = fallback.turned; done.count = count; }
  return done;
};

/**
 * LES CONTACTS TROP COURTS D'UN MODÈLE — « cette géométrie est-elle réalisable ? »
 * Deux atomes que le graphe ne relie PAS et qui se touchent à moins de
 * `minDistance` (1.45 Å par défaut) : ce ne sont pas deux atomes côte à côte,
 * c'est un atome passé à travers un autre. Le module les COMPTE au lieu de les
 * ignorer — c'est le seul juge de « réalisabilité » qu'il ait, et le rapport
 * l'affiche.
 *
 * La mesure est LOCALE (`movable`) : seuls les atomes qu'un geste peut déplacer
 * sont regardés, et un couple n'est compté qu'une fois (que les deux bougent ou
 * non). Une grille de la taille du seuil évite le O(n²) d'une protéine : chaque
 * atome ne regarde que ses 27 cellules voisines.
 *
 * Rend `{count, worst, pairs, severity, checked, minDistance}` : le NOMBRE de
 * couples trop courts, le plus court (`worst` = `{i, j, distance}`), les premiers
 * couples nommés (`maxReported`), et `severity` = Σ (seuil − d)² — le chiffre
 * dont les échappées se servent pour préférer un modèle propre à un modèle
 * empilé (`RELAX_CLASH_WEIGHT`).
 */
export const clashReportOf = ({
  positions = null, bonds = [], atomCount = 0, movable = null,
  minDistance = RELAX_CLASH_DISTANCE, maxReported = 8,
} = {}) => {
  const limit = Number(minDistance) > 0 ? Number(minDistance) : RELAX_CLASH_DISTANCE;
  const out = { count: 0, worst: null, pairs: [], severity: 0, checked: 0, minDistance: limit };
  const read = flatPositions(positions);
  if (!read) return out;
  const count = read.count;
  const x = read.flat;
  const graph = bondGraphOf({ bonds, atomCount: count });
  const bonded = new Set(graph.list.map((b) => (b.i < b.j ? `${b.i}-${b.j}` : `${b.j}-${b.i}`)));
  const who = movable == null ? null : new Set(Array.from(movable).map(Number)
    .filter((i) => isIndex(i) && i < count));
  const cell = limit;
  const grid = new Map();
  const key3 = (a, b, c) => `${a},${b},${c}`;
  const cellOf = (i, axis) => Math.floor(x[i * 3 + axis] / cell);
  for (let i = 0; i < count; i += 1) {
    const k = key3(cellOf(i, 0), cellOf(i, 1), cellOf(i, 2));
    const bucket = grid.get(k);
    if (bucket) bucket.push(i); else grid.set(k, [i]);
  }
  const seen = new Set();
  for (let i = 0; i < count; i += 1) {
    if (who && !who.has(i)) continue;
    out.checked += 1;
    const cx = cellOf(i, 0); const cy = cellOf(i, 1); const cz = cellOf(i, 2);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          const bucket = grid.get(key3(cx + dx, cy + dy, cz + dz));
          if (!bucket) continue;
          for (const j of bucket) {
            if (j === i) continue;
            if (who && who.has(j) && j < i) continue;          // compté une seule fois
            const key = i < j ? `${i}-${j}` : `${j}-${i}`;
            if (bonded.has(key) || seen.has(key)) continue;
            seen.add(key);
            const d = dist3([x[i * 3], x[i * 3 + 1], x[i * 3 + 2]], [x[j * 3], x[j * 3 + 1], x[j * 3 + 2]]);
            if (!(d < limit)) continue;
            out.count += 1;
            out.severity += (limit - d) * (limit - d);
            if (!out.worst || d < out.worst.distance) out.worst = { i, j, distance: d };
            if (out.pairs.length < Math.max(0, Math.round(Number(maxReported) || 0))) {
              out.pairs.push({ i, j, distance: d });
            }
          }
        }
      }
    }
  }
  return out;
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
 *     puisse l'annoncer au lieu de faire croire à une molécule entière relâchée —
 *     sauf quand `rebuild` demande de REBÂTIR cette partie-là (§7bis) : la fenêtre
 *     borne alors ce qui PILOTE le geste, plus ce qui a le droit de bouger.
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

/* ── 7bis · LE REBÂTIMENT — REBÂTIR DE ZÉRO LA PARTIE QUE LA FENÊTRE NE BOUGE PAS ─
   La demande, mot pour mot :

     « since you limit the number of bonds and atoms to move, the molecules get
       stretched. At every step, the relaxation should also imply forcing resetting
       of standard distance so that the molecule can shrink because atoms not
       included in the calculation can move. In other words it would be like
       rebuilding from scratch the part of the molecule not included in the
       calculation. »

   `relaxGeometry` ne déplace que les atomes de sa fenêtre (`relaxWindow`) et il rend
   les autres BIT À BIT — c'est ce qui rend le geste local, et c'est aussi ce qui
   ÉTIRE la molécule : quand la fenêtre doit se plier pour rapprocher deux atomes, la
   chaîne qui l'entoure reste où elle était, donc les liaisons qui enjambent le bord
   se tendent, les angles se tordent, et rien ne se resserre (« the molecules get
   stretched »). Le remède est celui que la demande nomme : les atomes hors fenêtre
   sont REBÂTIS À CHAQUE PAS — la molécule est « re-built from scratch » dans cette
   partie-là, donc ses atomes PEUVENT bouger, et elle se resserre.

   CE QUE LE REBÂTIMENT EST, exactement : il ne cherche rien, il POSE. Chaque atome
   hors fenêtre est reposé

     · à la longueur STANDARD de sa liaison (la table de `bondLengthTarget`, les
       corrections d'ordre et d'aromatique comprises — donc les MÊMES cibles que la
       fonction cible, jamais une seconde table) ;
     · à l'angle STANDARD de l'hybridation de son sommet (109.47° · 120° · 180°) ;
     · sous le DIÈDRE QU'IL AVAIT. C'est ce troisième point qui distingue un
       rebâtiment d'un « démêlage » : la conformation de la partie rebâtie est
       GARDÉE au chiffre près, seules ses longueurs et ses angles reviennent au
       standard. Le geste est donc le « model build » d'HyperChem, pris dans l'autre
       sens (là où ce module-ci laisse la conformation trouvée par la descente au
       reste de la molécule, il rend à cette partie les longueurs et les angles
       qu'un modèle valide doit avoir).

   COMMENT LE DIÈDRE EST GARDÉ, sans trigonométrie de dièdre. Pour poser un atome `n`
   depuis son parent `p`, il faut un repère : le grand-père `g` (qui donne l'angle) et
   l'arrière-grand-père `h` (qui donne le dièdre). Le dièdre (h,g,p,n) n'est rien
   d'autre que l'AZIMUT de `n` autour de l'axe g–p, mesuré sur le côté de `h` (la
   perpendiculaire à l'axe dans le plan h,g,p) et orienté par le trièdre (axe, côté de
   `h`, axe × côté de `h`). Le rebâtiment mesure donc cet azimut SUR LA SOURCE, puis le
   repose TEL QUEL dans la géométrie d'aujourd'hui — angle standard, azimut gardé, et
   le trièdre refait à l'identique : le dièdre est reproduit exactement, sans convention
   à deviner, et l'atome posé SUIT le geste quand la fenêtre tourne (les atomes `h`, `g`
   et `p` de la référence ont bougé avec elle, la référence a donc tourné aussi).
   Sans `h` (une chaîne qui commence), il n'y a pas de côté de référence : l'azimut est
   gardé tel qu'il est à l'instant de la pose ; sans `g`, et sans angle cible au sommet,
   seule la LONGUEUR est reposée (la direction ne bouge pas). Une liaison que la table ne
   connaît pas n'est jamais rebâtie : rien n'est inventé pour un couple d'éléments
   inconnu (`terms.unknownBonds`).

   QUI EST REBÂTI. Tous les atomes que la fenêtre n'ancre pas et que le graphe relie
   à elle — et, en plus, chaque composante qu'AUCUNE liaison ne relie à la fenêtre
   (une autre chaîne, un ligand, une eau) : celle-là ne peut pas suivre le geste,
   mais elle est rebâtie depuis son PREMIER atome, qui sert de racine, donc son
   étirement s'en va aussi et sa conformation est gardée. Sans `keep` du tout, tout
   est rebâti depuis la racine de chaque composante.

   ⚠ CE QUE LE REBÂTIMENT NE FAIT PAS, et le rapport le dit : il ne minimise rien
   (la descente s'en occupe, sur la fenêtre), il ne touche JAMAIS un atome de `keep`
   (l'ancrage est bit à bit), il ne connaît ni charges ni contacts, et il ne peut pas
   tenir l'angle d'un sommet qui porte déjà plusieurs voisins posés — l'angle d'un
   atome est posé vis-à-vis de SON parent, et les écarts qui restent sur la partie
   rebâtie sont MESURÉS (`bonds.rms`, `angles.rms`) et affichés, jamais tus.
   Voir _geometry_relax_test.mjs (une chaîne étirée dont la fenêtre se replie, les
   dièdres de la partie rebâtie, l'atome de la fenêtre bit à bit, et l'appel du
   panneau). */

/** La direction UNITAIRE portée par le couple `i`→`j` d'un tableau plat, ou `null`
 *  quand elle n'existe pas (atomes confondus). Sert au PLAN, qui n'est calculé
 *  qu'une fois : le rebâtiment lui-même ne s'en sert pas (il ne fait pas d'allocations). */
const unitOf = (flat, i, j) => {
  const dx = flat[i * 3] - flat[j * 3];
  const dy = flat[i * 3 + 1] - flat[j * 3 + 1];
  const dz = flat[i * 3 + 2] - flat[j * 3 + 2];
  const n = Math.hypot(dx, dy, dz);
  return n > 1e-9 ? [dx / n, dy / n, dz / n] : null;
};

/**
 * LE PLAN D'UN REBÂTIMENT — calculé UNE FOIS, appliqué tel quel à chaque pas.
 *
 * Le graphe et les tables ne changent pas pendant une descente : l'ordre de pose,
 * le parent, le repère (grand-père, arrière-grand-père) et la cible de chaque
 * liaison sont donc calculés ici, une fois pour toutes, et `applyRebuild` n'a plus
 * qu'à les exécuter (aucune allocation, aucun parcours de graphe : le rebâtiment
 * tourne à chaque pas d'une descente, il doit coûter O(atomes) sans déchets).
 *
 *   · `keep` = les atomes ANCRÉS (les coordonnées qui ne bougent pas : la fenêtre
 *     de `relaxGeometry`). Sans `keep`, rien n'est ancré : chaque composante du
 *     graphe est rebâtie depuis son premier atome (le « rebuild from scratch ») ;
 *   · un atome n'est posé que si la table connaît sa liaison (`terms.bonds`) ;
 *   · `src` = la géométrie de RÉFÉRENCE des coordonnées internes gardées (le dièdre,
 *     l'azimut) : la molécule REÇUE. `positions` = la géométrie de DÉPART (celle que
 *     le rebâtiment réécrit — ce peut être la même).
 *
 * @returns {{ok:boolean, reason?:string, count:number, src:number[], terms:object,
 *            steps:object[], posed:number[], posedFlag:Uint8Array, roots:number[],
 *            kept:number[], anchors:number[]}}
 */
const rebuildPlanOf = ({
  elements = [], bonds = [], terms = null, positions = null, source = null,
  weights = RELAX_WEIGHTS, keep = null,
} = {}) => {
  const read = flatPositions(positions);
  if (!read) return { ok: false, reason: 'bad-points' };
  const count = read.count;
  const els = Array.from(elements || []).map((e) => element(e));
  const readSrc = source == null ? read : flatPositions(source);
  if (!readSrc || readSrc.count !== count) return { ok: false, reason: 'bad-source' };
  const src = readSrc.flat;
  const graph = bondGraphOf({ bonds, atomCount: count });
  const t = terms || buildRelaxTerms({ elements: els, bonds, pairs: [], weights, positions: src });

  /* LA TABLE DES LIAISONS, PAR ATOME — le voisin à poser et la longueur CIBLE de la
     liaison, lue dans les termes de la fonction cible (donc la même cible qu'elle,
     correction d'aromatique comprise). Une liaison absente de `terms.bonds` (un
     couple d'éléments que la table ne connaît pas) ne fera JAMAIS partie d'un plan. */
  const links = new Array(count).fill(null);
  for (const b of t.bonds) {
    if (!links[b.i]) links[b.i] = [];
    if (!links[b.j]) links[b.j] = [];
    if (!links[b.i].some((e) => e.n === b.j)) links[b.i].push({ n: b.j, d0: b.target });
    if (!links[b.j].some((e) => e.n === b.i)) links[b.j].push({ n: b.i, d0: b.target });
  }
  /* L'ANGLE CIBLE D'UN SOMMET — celui de son hybridation, le même que la fonction
     cible (109.47° · 120° · 180° ; `null` pour un hydrogène ou un atome terminal). */
  const angleAt = new Array(count).fill(null);
  for (let i = 0; i < count; i += 1) angleAt[i] = angleTargetOf(t.hybrids[i]);

  const nbsOf = (i) => graph.neighbours(i).map(Number)
    .filter((x) => isIndex(x) && x < count && x !== i);
  const placed = new Uint8Array(count);
  const parentOf = new Int32Array(count).fill(-1);
  const anchors = [...new Set((keep == null ? [] : Array.from(keep)).map(Number)
    .filter((i) => isIndex(i) && i < count))].sort((a, b) => a - b);
  const steps = [];        // l'ordre de pose : { n, p, g, h, d0, … }
  const posed = [];        // les atomes que le rebâtiment REPOSE
  const roots = [];        // les composantes qu'aucune liaison ne relie à la fenêtre
  const kept = [];         // les atomes laissés tels quels
  const linkOf = (p, n) => {
    const l = links[p];
    return l ? (l.find((e) => e.n === n) || null) : null;
  };
  const firstPlaced = (atom, except) => {
    for (const i of nbsOf(atom)) if (i !== except && placed[i]) return i;
    return -1;
  };

  /* LE REPÈRE DE LA POSE — calculé ici, une fois. Un atome `n` se pose depuis son
     parent `p`, à la LONGUEUR de la table, sous l'ANGLE de l'hybridation de `p`, et
     sous l'AZIMUT QU'IL AVAIT autour de l'axe g–p MESURÉ SUR LE CÔTÉ DE `h` — c'est
     cet azimut qui porte le dièdre (h,g,p,n), et le garder tel quel le reproduit sans
     aucune trigonométrie de dièdre et sans convention à deviner : la position de `h`
     donne la référence, le trièdre (axe, côté de `h`, axe × côté de `h`) donne le sens.
     `pb`/`pg` sont les deux coordonnées de cet azimut dans ce repère (unitaire par
     construction) ; sans `h` (une chaîne qui commence), il n'y a pas de référence et
     l'azimut est gardé tel qu'il est à l'instant de la pose. */
  const infoOf = ({ n, p, g, h, d0, angle }) => {
    const info = {
      n, p, g, h, d0, angle: Number(angle) > 0 ? Number(angle) : null,
      dir0: null, cos: 0, sin: 0, pb: 0, pg: 0, az: false,
    };
    const dir0 = unitOf(src, n, p);
    info.dir0 = dir0;
    if (g < 0) return info;                        // aucun repère : la longueur seule
    const a0 = unitOf(src, g, p);
    if (!a0 || info.angle == null) return info;    // pas d'angle cible : la longueur seule
    const rad = (info.angle * Math.PI) / 180;
    info.cos = Math.cos(rad);
    info.sin = Math.sin(rad);
    if (h < 0 || !dir0) return info;               // sans `h` : l'azimut tel quel
    const hx = src[h * 3] - src[p * 3];
    const hy = src[h * 3 + 1] - src[p * 3 + 1];
    const hz = src[h * 3 + 2] - src[p * 3 + 2];
    const dh = hx * a0[0] + hy * a0[1] + hz * a0[2];
    let qx = hx - dh * a0[0];
    let qy = hy - dh * a0[1];
    let qz = hz - dh * a0[2];
    const nq = Math.hypot(qx, qy, qz);
    if (!(nq > 1e-9)) return info;                 // h, g, p alignés : aucune référence
    qx /= nq; qy /= nq; qz /= nq;
    const dd = dir0[0] * a0[0] + dir0[1] * a0[1] + dir0[2] * a0[2];
    let wx = dir0[0] - dd * a0[0];
    let wy = dir0[1] - dd * a0[1];
    let wz = dir0[2] - dd * a0[2];
    const nw = Math.hypot(wx, wy, wz);
    if (!(nw > 1e-9)) {
      /* L'ANGLE EXACTEMENT PLAT : la géométrie ne donne aucune perpendiculaire — le
         module en fabrique une, DÉTERMINISTE, comme pour le coup de pouce des angles
         plats. L'azimut gardé est alors celui de cette perpendiculaire. */
      const q = perpendicularTo(a0[0], a0[1], a0[2]);
      if (!q) return info;
      wx = q[0]; wy = q[1]; wz = q[2];
    } else {
      wx /= nw; wy /= nw; wz /= nw;
    }
    const kx = a0[1] * qz - a0[2] * qy;            // axe × côté de h
    const ky = a0[2] * qx - a0[0] * qz;
    const kz = a0[0] * qy - a0[1] * qx;
    const beta = wx * qx + wy * qy + wz * qz;
    const gamma = wx * kx + wy * ky + wz * kz;
    const ng = Math.hypot(beta, gamma);
    if (!(ng > 1e-9)) return info;
    info.pb = beta / ng;
    info.pg = gamma / ng;
    info.az = true;
    return info;
  };
  const walk = (seeds) => {
    const queue = [...seeds];
    for (let head = 0; head < queue.length; head += 1) {
      const p = queue[head];
      for (const n of nbsOf(p)) {
        if (placed[n]) continue;
        const link = linkOf(p, n);
        if (!link) continue;                       // hors des tables : on ne touche pas
        /* LE GRAND-PÈRE — celui dont `p` a été posé, ou à défaut un voisin de `p`
           déjà posé (un atome de la fenêtre, par exemple). */
        const g = parentOf[p] >= 0 && placed[parentOf[p]] ? parentOf[p] : firstPlaced(p, n);
        const h = g >= 0
          ? (parentOf[g] >= 0 && parentOf[g] !== p && placed[parentOf[g]]
            ? parentOf[g] : firstPlaced(g, p))
          : -1;
        placed[n] = 1; parentOf[n] = p; posed.push(n); queue.push(n);
        steps.push(infoOf({
          n, p, g, h, d0: link.d0, angle: g >= 0 ? angleAt[p] : null,
        }));
      }
    }
  };
  for (const a of anchors) placed[a] = 1;
  walk(anchors);
  /* LES COMPOSANTES QU'AUCUNE LIAISON NE RELIE À LA FENÊTRE — une autre chaîne, un
     ligand, une molécule d'eau. Elles ne peuvent pas SUIVRE le geste (rien ne les y
     attache), mais elles sont rebâties depuis leur PREMIER atome, qui sert de racine :
     leur étirement s'en va aussi, et leur conformation est gardée. Une racine qui ne
     pose rien (sa liaison n'est pas dans les tables) est un atome laissé tel quel. */
  for (let r = 0; r < count; r += 1) {
    if (placed[r]) continue;
    if (!nbsOf(r).length) { placed[r] = 1; kept.push(r); continue; }   // un atome seul
    placed[r] = 1;
    const at = steps.length;
    walk([r]);
    if (steps.length > at) roots.push(r); else kept.push(r);
  }
  const posedFlag = new Uint8Array(count);
  for (const i of posed) posedFlag[i] = 1;
  return {
    ok: true, count, src: src.slice(), terms: t, steps, posed, posedFlag,
    roots, kept, anchors, placed,
  };
};

/**
 * LE REBÂTIMENT, APPLIQUÉ — écrit dans `out`, qui est modifié SUR PLACE (le module
 * l'appelle à chaque pas d'une descente, sur son tableau de travail : copier 3·N
 * nombres par pas serait payer une allocation pour rien). Aucune allocation, aucun
 * parcours de graphe, aucune recherche : le plan a déjà tout décidé, il ne reste que
 * des produits scalaires — la place d'un atome est
 *
 *     n = p + d₀ · û
 *
 * avec `d₀` la longueur de la table et `û` la direction idéale : celle du repère de
 * la source transportée par la rotation (h,g,p) → (h,g,p) d'aujourd'hui quand elle
 * existe (le dièdre est gardé), l'azimut d'aujourd'hui sinon, la direction
 * d'aujourd'hui quand il n'y a ni angle ni repère (la longueur seule).
 */
const applyRebuild = (plan, out) => {
  const steps = plan.steps;
  for (let s = 0; s < steps.length; s += 1) {
    const st = steps[s];
    const n = st.n; const p = st.p;
    const px = out[p * 3]; const py = out[p * 3 + 1]; const pz = out[p * 3 + 2];
    let ux = 0; let uy = 0; let uz = 0; let ok = false;
    if (st.cos || st.sin) {
      const g = st.g;
      const ax = out[g * 3] - px;
      const ay = out[g * 3 + 1] - py;
      const az = out[g * 3 + 2] - pz;
      const na = Math.hypot(ax, ay, az);
      if (na > 1e-9) {
        const e1x = ax / na; const e1y = ay / na; const e1z = az / na;
        if (st.az) {
          /* LE CÔTÉ DE `h` DANS LA GÉOMÉTRIE D'AUJOURD'HUI — la référence de l'azimut.
             Le trièdre (axe, côté de h, axe × côté de h) se refait à l'identique : le
             DIÈDRE (h,g,p,n) de la source est donc reproduit, et l'atome posé suit la
             fenêtre quand elle tourne. */
          const h = st.h;
          const hx = out[h * 3] - px;
          const hy = out[h * 3 + 1] - py;
          const hz = out[h * 3 + 2] - pz;
          const dh = hx * e1x + hy * e1y + hz * e1z;
          let qx = hx - dh * e1x;
          let qy = hy - dh * e1y;
          let qz = hz - dh * e1z;
          const nq = Math.hypot(qx, qy, qz);
          if (nq > 1e-9) {
            qx /= nq; qy /= nq; qz /= nq;
            const kx = e1y * qz - e1z * qy;
            const ky = e1z * qx - e1x * qz;
            const kz = e1x * qy - e1y * qx;
            const wb = st.pb; const wg = st.pg;
            ux = st.cos * e1x + st.sin * (wb * qx + wg * kx);
            uy = st.cos * e1y + st.sin * (wb * qy + wg * ky);
            uz = st.cos * e1z + st.sin * (wb * qz + wg * kz);
            ok = true;
          }
        }
        if (!ok) {
          /* SANS ARRIÈRE-GRAND-PÈRE (ou référence dégénérée) : L'AZIMUT EST GARDÉ tel
             qu'il est — le repli qui n'invente aucune rotation. */
          let wx = out[n * 3] - px;
          let wy = out[n * 3 + 1] - py;
          let wz = out[n * 3 + 2] - pz;
          const dot = wx * e1x + wy * e1y + wz * e1z;
          wx -= dot * e1x; wy -= dot * e1y; wz -= dot * e1z;
          const nw = Math.hypot(wx, wy, wz);
          let tx = 0; let ty = 0; let tz = 0; let made = false;
          if (nw > 1e-9) { tx = wx / nw; ty = wy / nw; tz = wz / nw; made = true; }
          else {
            const q = perpendicularTo(e1x, e1y, e1z);
            if (q) { tx = q[0]; ty = q[1]; tz = q[2]; made = true; }
          }
          if (made) {
            ux = st.cos * e1x + st.sin * tx;
            uy = st.cos * e1y + st.sin * ty;
            uz = st.cos * e1z + st.sin * tz;
            ok = true;
          }
        }
      }
    }
    if (!ok) {
      /* LA LONGUEUR SEULE — la direction d'aujourd'hui, ou celle de la source quand
         les deux atomes sont confondus (une entrée dégénérée ne fait pas échouer un
         rebâtiment : l'atome est reposé à la longueur de la table). */
      const dx = out[n * 3] - px;
      const dy = out[n * 3 + 1] - py;
      const dz = out[n * 3 + 2] - pz;
      const nd = Math.hypot(dx, dy, dz);
      if (nd > 1e-9) { ux = dx / nd; uy = dy / nd; uz = dz / nd; }
      else if (st.dir0) { ux = st.dir0[0]; uy = st.dir0[1]; uz = st.dir0[2]; }
      else { ux = 1; uy = 0; uz = 0; }
    }
    out[n * 3] = px + st.d0 * ux;
    out[n * 3 + 1] = py + st.d0 * uy;
    out[n * 3 + 2] = pz + st.d0 * uz;
  }
  return out;
};

/** L'ANGLE i–j–k en degrés, lu sur des coordonnées plates — `null` quand il n'existe
 *  pas (un atome confondu avec son sommet : aucune mesure à en tirer). */
const angleOf3 = (arr, i, j, k) => {
  const ux = arr[i * 3] - arr[j * 3];
  const uy = arr[i * 3 + 1] - arr[j * 3 + 1];
  const uz = arr[i * 3 + 2] - arr[j * 3 + 2];
  const vx = arr[k * 3] - arr[j * 3];
  const vy = arr[k * 3 + 1] - arr[j * 3 + 1];
  const vz = arr[k * 3 + 2] - arr[j * 3 + 2];
  const nu = Math.hypot(ux, uy, uz); const nv = Math.hypot(vx, vy, vz);
  if (!(nu > 1e-9) || !(nv > 1e-9)) return null;
  const cos = Math.max(-1, Math.min(1, (ux * vx + uy * vy + uz * vz) / (nu * nv)));
  return Math.acos(cos) * DEG;
};

/** LES ÉCARTS DE LA PARTIE REBÂTIE, terme par terme — les liaisons ET les angles qui
 *  touchent au moins un atome reposé. C'est ce que le rapport MESURE (avant : la
 *  molécule REÇUE ; après : le modèle rendu) au lieu de promettre que tout est
 *  parfait : un sommet qui porte déjà plusieurs voisins posés ne peut pas tenir tous
 *  ses angles, et le chiffre le dit au lieu de le taire. */
const rebuildDeviationOf = (plan, arr) => {
  const terms = plan.terms;
  const who = plan.posedFlag;
  const bonds = [];
  const angles = [];
  const pt = (i) => [arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]];
  for (const t of terms.bonds) {
    if (!who[t.i] && !who[t.j]) continue;
    const d = dist3(pt(t.i), pt(t.j));
    bonds.push({ i: t.i, j: t.j, target: t.target, distance: d, dev: d - t.target });
  }
  for (const t of terms.angles) {
    if (!who[t.i] && !who[t.j] && !who[t.k]) continue;
    const deg = angleOf3(arr, t.i, t.j, t.k);
    if (deg == null) continue;
    angles.push({ i: t.i, j: t.j, k: t.k, target: t.target, deg, dev: deg - t.target });
  }
  const rmsOf = (list) => (list.length
    ? Math.sqrt(list.reduce((s, e) => s + e.dev * e.dev, 0) / list.length) : 0);
  const worstOf = (list) => list.reduce(
    (w, e) => (!w || Math.abs(e.dev) > Math.abs(w.dev) ? e : w), null,
  );
  return {
    bonds: { count: bonds.length, rms: rmsOf(bonds), worst: worstOf(bonds), list: bonds },
    angles: { count: angles.length, rms: rmsOf(angles), worst: worstOf(angles), list: angles },
  };
};

/** Le MÊME écart, avant et après — c'est ce que le rapport nomme (la pire liaison
 *  étirée au départ, et ce qu'elle mesure sur le modèle rendu). */
const rebuildWorstPair = (listBefore, listAfter) => {
  let at = -1;
  for (let k = 0; k < listBefore.length; k += 1) {
    if (at < 0 || Math.abs(listBefore[k].dev) > Math.abs(listBefore[at].dev)) at = k;
  }
  if (at < 0) return null;
  const e = listBefore[at];
  const f = listAfter[at] || {};
  const worst = {
    i: e.i, j: e.j, target: e.target, before: e.dev, after: Number(f.dev) || 0,
  };
  if (e.k != null) worst.k = e.k;
  if (e.distance != null) worst.distance = e.distance;
  if (f.distance != null) worst.afterDistance = f.distance;
  return worst;
};

/** LE RAPPORT D'UN REBÂTIMENT — ce qu'il repose, ce qui bouge vraiment, ce qu'il
 *  laisse (les ancres, les atomes seuls, tout ce dont la table ne connaît pas la
 *  liaison), et les écarts des liaisons et des angles de la partie rebâtie AVANT (la
 *  molécule reçue) et APRÈS (le modèle rendu). `passes` = combien de fois il a tourné
 *  (une fois par pas, dans une descente). */
const rebuildReportOf = (plan, from, to, passes) => {
  const before = rebuildDeviationOf(plan, from);
  const after = rebuildDeviationOf(plan, to);
  let moved = 0;
  for (const i of plan.posed) {
    if (Math.abs(to[i * 3] - from[i * 3]) + Math.abs(to[i * 3 + 1] - from[i * 3 + 1])
      + Math.abs(to[i * 3 + 2] - from[i * 3 + 2]) > 1e-9) moved += 1;
  }
  return {
    used: true,
    passes,
    atoms: plan.posed.length,
    moved,
    untouched: plan.kept.length,
    parts: plan.roots.length,
    steps: plan.steps.length,
    bonds: {
      count: before.bonds.count,
      rms: { before: before.bonds.rms, after: after.bonds.rms },
      worst: rebuildWorstPair(before.bonds.list, after.bonds.list),
    },
    angles: {
      count: before.angles.count,
      rms: { before: before.angles.rms, after: after.angles.rms },
      worst: rebuildWorstPair(before.angles.list, after.angles.list),
    },
  };
};

/**
 * LE REBÂTIMENT, ENTIER — « rebâtir de zéro la partie de la molécule qui n'est pas
 * dans le calcul » (voir §7bis).
 *
 * Il rend une COPIE des coordonnées (aucun argument n'est modifié, comme partout
 * dans le dossier) et le compte rendu chiffré de ce qu'il a fait : les atomes
 * REPOSÉS, ceux qu'il a LAISSÉS (les ancres de `keep`, les atomes seuls, et tout ce
 * dont la table ne connaît pas la liaison), les composantes rebâties depuis leur
 * propre racine, et les écarts AVANT / APRÈS des liaisons et des angles de la partie
 * rebâtie — mesurés, jamais promis.
 *
 * @param {{positions:number[]|Float32Array|number[][], source?:any, elements?:any[],
 *          bonds?:any[], terms?:object, keep?:number[]|null, weights?:object}} spec
 *   `keep` = les atomes ANCRÉS (les coordonnées qui ne bougent pas) : ceux de la
 *   fenêtre relâchée, dans `relaxGeometry`. Sans `keep`, rien n'est ancré : chaque
 *   composante du graphe est rebâtie depuis son premier atome.
 *   `source` = la géométrie dont les DIÈDRES et les AZIMUTS sont gardés (défaut : les
 *   coordonnées reçues) ; `terms` = les termes déjà construits (`buildRelaxTerms`),
 *   pour ne pas les recalculer quand l'appelant les a sous la main.
 * @returns {{ok:boolean, reason?:string, positions:number[]|null, placed:number[],
 *            kept:number[], roots:number[], anchors:number[], steps:number,
 *            bonds:object|null, angles:object|null}}
 */
export const rebuildStandardGeometry = ({
  positions = null, source = null, elements = [], bonds = [], terms = null,
  keep = null, weights = RELAX_WEIGHTS,
} = {}) => {
  const plan = rebuildPlanOf({ elements, bonds, terms, positions, source, weights, keep });
  if (!plan.ok) {
    return {
      ok: false, reason: plan.reason, positions: null, placed: [], kept: [],
      roots: [], anchors: [], steps: 0, bonds: null, angles: null,
    };
  }
  const read = flatPositions(positions);
  const out = read.flat.slice();
  applyRebuild(plan, out);
  const report = rebuildReportOf(plan, plan.src, out, 1);
  return {
    ok: true,
    positions: out,
    placed: [...plan.posed].sort((a, b) => a - b),
    kept: [...plan.kept].sort((a, b) => a - b),
    roots: [...plan.roots].sort((a, b) => a - b),
    anchors: plan.anchors,
    steps: plan.steps.length,
    bonds: report.bonds,
    angles: report.angles,
  };
};

/* ── 8 · LE CONSTRUIT, PAS À PAS ───────────────────────────────────────────── */

/** Le résumé d'une évaluation — les chiffres que le rapport affiche (l'énergie de
 *  chaque famille, les écarts rms, et les trois pires : la liaison la plus fausse,
 *  l'angle le plus faux, le dièdre de cycle le plus plissé). */
const summaryOf = (e) => ({
  total: e.total, bond: e.bond, angle: e.angle, planar: e.planar, pair: e.pair, tether: e.tether,
  bondRms: e.bondRms, angleRms: e.angleRms, planarRms: e.planarRms,
  worstBond: e.worstBond ? { ...e.worstBond } : null,
  worstAngle: e.worstAngle ? { ...e.worstAngle } : null,
  worstPlanar: e.worstPlanar ? { ...e.worstPlanar } : null,
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
 * est locale et le rapport le dit. Quand la distance demandée est loin, elle est
 * approchée PAR PALIERS (`stageStep`), chacun suivi d'une REPRISE qui relâche la
 * fenêtre entière à la distance obtenue (voir l'en-tête du module) : le modèle rendu
 * est donc un modèle relâché, pas un modèle en pleine contrainte.
 *
 * @param {{positions:number[]|Float32Array|number[][], elements?:any[], bonds?:any[],
 *          pairs?:any[], movable?:number[]|null, steps?:number, maxAtomStep?:number,
 *          tolerance?:number, gradientTolerance?:number, weights?:object,
 *          tether?:number|null, stageStep?:number, maxStages?:number,
 *          restoreSteps?:number}} spec
 *   `pairs` = les distances DEMANDÉES : [{i, j, target}] ou [[i, j, d]].
 *   `movable` = les atomes qui ont le droit de bouger (par défaut : tous). Les
 *   autres sont rendus BIT À BIT, et c'est leur ancrage qui tient la molécule — SAUF
 *   quand `rebuild` est demandé : ils sont alors REPOSÉS à chaque pas (§7bis), donc
 *   ils suivent la fenêtre au lieu de l'étirer.
 *   `stageStep` = l'écart entre deux paliers du rapprochement, en ångströms (2 par
 *   défaut, 0 = un seul palier : le geste d'avant) ; `restoreSteps` = les pas de la
 *   reprise après chaque palier (0 = aucune reprise).
 *   `escapes` = le nombre de BOTTES DE TORSION que le module a le droit d'essayer
 *   quand la descente s'est arrêtée dans un creux (0 par défaut = le geste
 *   d'avant, `RELAX_DEFAULT_ESCAPES` = 6 pour le panneau), `escapeSteps` = les pas
 *   de la descente qui suit chaque botte, `kickDeg` = l'amplitude de la première
 *   botte (elle décroît jusqu'à RELAX_MIN_KICK_DEG), `seed` = la graine des
 *   tirages (fixe : le même modèle donne le même construit), `clashDistance` = le
 *   seuil des contacts trop courts (voir `clashReportOf`).
 *   `rebuild` = LE REBÂTIMENT DE LA PARTIE HORS FENÊTRE (§7bis, `false` par défaut :
 *   le geste d'avant, celui que mesurent les sondes ; `RELAX_DEFAULT_REBUILD` = true
 *   pour le panneau ⚒). Demandé, les atomes que la fenêtre n'ancre pas sont reposés à
 *   chaque pas — longueur et angle standard, dièdre gardé — donc la molécule se
 *   resserre au lieu de s'étirer, et le rapport rend `rebuild` (voir plus bas).
 *   `onStep` = LE PAS VU DE L'EXTÉRIEUR : une fonction appelée après chaque pas
 *   (une itération de descente, une botte, une reprise), avec
 *   `{phase, step, positions, movable, loose, energy, distances, stage, stages, attempt,
 *   attempts}` — `positions` est le tableau de travail (à COPIER pour le garder,
 *   jamais à écrire), `loose` les atomes que ce geste peut déplacer (la fenêtre, plus
 *   ceux que `rebuild` repose : c'est ce que l'animation doit suivre), `energy` la
 *   fonction cible à cet instant et `distances` les
 *   distances DEMANDÉES relues. C'est ce qui permet à l'écran de montrer la
 *   molécule QUI CHANGE, pas seulement le résultat final. `stepEvery` (1 par
 *   défaut) n'annonce qu'un pas sur N ; le dernier pas est toujours annoncé
 *   (`final`). Un `onStep` qui lève n'arrête pas la descente.
 * @returns {{ok:boolean, reason:string, converged:boolean, reached:boolean,
 *            positions:number[]|null, moved:number[], before:object|null,
 *            after:object|null, pairs:object[], stages:number, stageStep:number,
 *            stagePlan:object[], restorations:number, restore:object|null,
 *            escapes:object, clashes:object, rebuild:object|null,
 *            steps:number, evaluations:number, terms:object, hybrids:any[]}}
 *   `restore` donne les écarts moyens AVANT la première reprise et APRÈS la
 *   dernière (`bondRms`, `angleRms`, `planarRms`) : c'est la tension résorbée.
 *   `rebuild` (voir §7bis, `null` quand le geste ne l'a pas demandé) donne ce que le
 *   rebâtiment de la partie hors fenêtre a reposé (`atoms`, `moved`, `parts`,
 *   `untouched`, `passes`) et les écarts de SES liaisons et de SES angles, avant (la
 *   molécule reçue) et après (le modèle rendu).
 */
export const relaxGeometry = (spec = {}) => {
  const {
    positions = null, elements = [], bonds = [], pairs = [], movable = null,
    steps = RELAX_MAX_STEPS, maxAtomStep = RELAX_MAX_ATOM_STEP,
    tolerance = RELAX_ENERGY_TOLERANCE, gradientTolerance = RELAX_GRADIENT_TOLERANCE,
    weights = RELAX_WEIGHTS, tether = null,
    stageStep = RELAX_STAGE_STEP, maxStages = RELAX_MAX_STAGES, restoreSteps = RELAX_RESTORE_STEPS,
    escapes = RELAX_ESCAPES, escapeSteps = RELAX_ESCAPE_STEPS, kickDeg = RELAX_KICK_DEG,
    seed = RELAX_ESCAPE_SEED, clashDistance = RELAX_CLASH_DISTANCE, rebuild = RELAX_REBUILD,
    onStep = null, stepEvery = 1,
  } = spec || {};

  const read = flatPositions(positions);
  if (!read) {
    return {
      ok: false, reason: 'bad-points', converged: false, reached: false,
      positions: null, moved: [], before: null, after: null, pairs: [],
      steps: 0, evaluations: 0, terms: null, hybrids: [], escapes: null, clashes: null,
    };
  }
  const count = read.count;
  const els = Array.from(elements || []).map((e) => element(e));
  const terms = buildRelaxTerms({ elements: els, bonds, pairs, weights, positions: read.flat });
  const termInfo = {
    bonds: 0, angles: 0, planars: 0, rings: 0, pairs: 0, unstuck: 0,
    bondCount: terms.bondCount, unknownBonds: terms.unknownBonds,
    aromaticBonds: terms.aromaticBonds, positions: count,
  };
  const refuse = (reason) => ({
    ok: false, reason, converged: false, reached: false, positions: null, moved: [],
    before: null, after: null, pairs: [], steps: 0, evaluations: 0,
    terms: termInfo, hybrids: terms.hybrids, escapes: null, clashes: null,
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
    planars: terms.planars.filter((t) => movableSet.has(t.i) || movableSet.has(t.j)
      || movableSet.has(t.k) || movableSet.has(t.l)),
    pairs: terms.pairs.filter((t) => movableSet.has(t.i) || movableSet.has(t.j)),
  };
  termInfo.bonds = active.bonds.length;
  termInfo.angles = active.angles.length;
  termInfo.planars = active.planars.length;
  termInfo.rings = new Set(active.planars.map((t) => t.ring)).size;
  termInfo.pairs = active.pairs.length;
  if (!active.bonds.length && !active.angles.length && !active.planars.length
    && !active.pairs.length) return refuse('no-terms');

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

  /* LE REBÂTIMENT DE LA PARTIE HORS FENÊTRE — voir §7bis et `rebuildStandardGeometry`.
     Demandé, il repose À CHAQUE PAS les atomes que la fenêtre n'ancre pas : longueur et
     angle STANDARD, DIÈDRE gardé — donc ces atomes peuvent bouger, la molécule se
     resserre, et aucune liaison ne reste étirée. Sans lui, la fenêtre seule bouge et le
     reste est rendu BIT À BIT (le geste d'avant, celui que mesurent les sondes du
     dossier). `steps: 0` ne rebâtit rien : une lecture ne touche à rien.
     Le PLAN est calculé une fois (le graphe et les tables ne changent pas) : `loose`
     est donc la même liste à chaque pas, et un pas ne coûte qu'un parcours O(atomes)
     sans allocation. */
  const rebuildPlan = rebuild ? rebuildPlanOf({
    elements: els, bonds, terms, positions: x0, source: x0, weights, keep: movableList,
  }) : null;
  const rebuildOn = !!(rebuildPlan && rebuildPlan.ok);
  let rebuildPasses = 0;
  const rebuildPass = (arr) => {
    if (!rebuildOn) return;
    applyRebuild(rebuildPlan, arr);
    rebuildPasses += 1;
  };
  /* LES ATOMES QUE LE GESTE PEUT DÉPLACER — la fenêtre, plus ceux que le rebâtiment
     repose. C'est cette liste que le rapport (et l'animation du panneau) compte : sans
     le rebâtiment, elle EST la fenêtre, donc rien ne change pour le geste d'avant. */
  const loose = rebuildOn
    ? [...new Set([...movableList, ...rebuildPlan.posed])].sort((a, b) => a - b)
    : movableList;
  /* LES CONTACTS TROP COURTS SE REGARDENT SUR CES MÊMES ATOMES — `clashReportOf` ne
     juge « la géométrie est-elle réalisable ? » que sur ce qu'un geste peut déplacer :
     quand le rebâtiment repose la molécule entière, c'est donc le modèle entier qui
     est jugé, contacts compris (sans lui, la fenêtre seule, comme avant). */
  const clashAtoms = rebuildOn ? loose : movableList;
  /* LE PREMIER PAS EST DÉJÀ UN REBÂTIMENT : le geste part d'une molécule aux longueurs
     et aux angles standard, au lieu d'hériter de l'étirement qu'il vient corriger. */
  if (rebuildOn && maxSteps > 0) rebuildPass(x);

  let current = energyOf(active, x, { grad, hess, ref: x0, tether: tetherWeight, movable: movableList });
  let evaluations = 2;
  let reason = 'max-steps';
  let stalledOnce = false;      // une descente s'est posée sans pouvoir bouger
  const capMax = Math.max(1e-6, Number(maxAtomStep) || RELAX_MAX_ATOM_STEP);

  /* ── LE PAS, VU DE L'EXTÉRIEUR — voir `onStep` ────────────────────────────────
     Un pas = une itération de descente, une botte de torsion, une reprise. Le
     panneau du viewer s'en sert pour montrer la molécule QUI BOUGE au lieu du
     résultat de but en blanc ; une sonde s'en sert pour vérifier l'ORDRE et les
     chiffres. `positions` est le tableau de travail : l'appelant le COPIE s'il
     veut le garder, il ne l'écrit jamais. Le dernier pas d'un geste est toujours
     annoncé (`final`), même quand `stepEvery` n'annonce qu'un pas sur N. */
  let stepsEmitted = 0;
  const everySteps = Math.max(1, Math.round(Number(stepEvery) || 1));
  const emit = (phase, extra = {}) => {
    if (typeof onStep !== 'function') return;
    stepsEmitted += 1;
    if (extra.final !== true && everySteps > 1 && (stepsEmitted % everySteps) !== 0) return;
    try {
      onStep({
        phase,
        step: stepsEmitted,
        positions: x,
        movable: movableList,
        /* LES ATOMES QUE CE GESTE PEUT DÉPLACER — la fenêtre, plus ceux que le
           rebâtiment repose quand il est demandé. C'est ce que l'animation du panneau
           suit : les atomes reposés bougent aussi, donc l'écran doit les porter. */
        loose,
        /* L'ÉNERGIE ANNONCÉE EST CELLE DU RAPPORT — la fonction cible SANS la longe
           (`before`/`after` du rapport sont calculés sans elle) : les chiffres de
           l'animation et ceux du rapport se comparent donc directement. */
        energy: current ? current.total - (Number(current.tether) || 0) : 0,
        distances: distancesOf(),
        stage: stageIndex,
        stages: stageTotal,
        attempt: escapeTry,
        attempts: escapeTotal,
        ...extra,
      });
    } catch { /* un rapport qui se plaint ne doit pas arrêter la descente */ }
  };
  let stageIndex = 0;           // le palier en cours du rapprochement (0 = aucun)
  let stageTotal = 0;
  let escapeTry = 0;            // l'échappée en cours (0 = aucune)
  let escapeTotal = 0;

  /* LA CONTRAINTE, ET SON RESSORT. La cible de chaque paire est ce que la descente
     CONDUIT ; son POIDS change pendant une reprise (voir `setPairSpring`) : la reprise
     tient la distance obtenue au lieu de la conduire, et elle la tient d'autant plus
     fermement qu'un écart qu'elle créerait elle-même ne servirait à rien — c'est le
     reste de la géométrie qui doit se détendre, pas la distance qui doit repartir. */
  const pairWeights = active.pairs.map((t) => t.weight);
  const pairTargets = active.pairs.map((t) => t.target);
  const distancesOf = () => pairReportOf(active, x).map((p) => p.distance);
  const setPairSpring = (k) => { active.pairs.forEach((t, i) => { t.weight = pairWeights[i] * k; }); };
  const setPairTargets = (list) => {
    let changed = false;
    active.pairs.forEach((t, i) => { if (t.target !== list[i]) { t.target = list[i]; changed = true; } });
    return changed;
  };
  const rescore = () => {
    current = energyOf(active, x, { grad, hess, ref: x0, tether: tetherWeight, movable: movableList });
    evaluations += 1;
  };

  /* LA DESCENTE, UNE FOIS — un palier, une reprise, ou le dernier rapprochement.
     `target` est la cible de chaque paire à la FIN de cette descente ; avec
     `reach: true` elle y va PAR PALIERS (la cible part de la distance ACTUELLE et la
     rejoint en la moitié des pas, l'autre moitié relâche la géométrie), avec
     `reach: false` elle y est POSÉE d'un coup — c'est la reprise, où la cible EST la
     distance obtenue : il n'y a plus rien à rapprocher, la contrainte cesse de tirer
     et tient la distance pendant que les liaisons, les angles et les cycles se
     détendent. Rend les pas pris et la raison de l'arrêt ; ne touche ni à `x0`, ni au
     rapport, ni à la cible finale des paires. */
  const descend = ({ budget, target = null, reach = true, phase = 'descend' }) => {
    const budgetN = Math.max(0, Math.round(Number(budget) || 0));
    if (!budgetN) return { taken: 0, stop: 'max-steps' };
    if (target && !reach && setPairTargets(target)) rescore();
    const from = target && reach ? distancesOf() : null;
    const rampSteps = Math.max(1, Math.round(budgetN / 2));
    let taken = 0; let quiet = 0; let stop = 'max-steps';
    for (let s = 0; s < budgetN; s += 1) {
      if (from) {
        const ramp = Math.min(1, (s + 1) / rampSteps);
        let targetMoved = false;
        active.pairs.forEach((t, i) => {
          const next = from[i] + (target[i] - from[i]) * ramp;
          if (next !== t.target) { t.target = next; targetMoved = true; }
        });
        if (targetMoved) { rescore(); quiet = 0; }
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
      if (gmax < gradientTolerance) { stop = 'converged'; break; }
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
      if (!(dmax > 1e-15)) { stop = 'converged'; break; }
      const progress = budgetN > 1 ? s / (budgetN - 1) : 1;
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
        /* LA PARTIE HORS FENÊTRE EST REPOSÉE AVANT D'ÊTRE JUGÉE — la fenêtre a bougé,
           donc le reste suit (voir §7bis) : l'énergie jugée est celle du modèle entier
           tel qu'il sortirait, pas celle d'une molécule étirée entre deux jeux de
           coordonnées. */
        rebuildPass(trial);
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
      emit(phase);
      if (!accepted) { stop = 'stalled'; break; }
      if (wasTotal - current.total < tolerance) {
        quiet += 1;
        if (quiet >= 2) { stop = 'converged'; break; }
      } else {
        quiet = 0;
      }
    }
    return { taken, stop };
  };

  /* ── LE PAS À PAS — LES PALIERS, ET LA REPRISE APRÈS CHACUN ────────────────────
     « Le programme commence à rapprocher les deux atomes pas à pas. » Pas à pas veut
     donc dire ici : la distance demandée descend par PALIERS de `stageStep` ångströms
     (18, puis 16, puis 14…), et après chaque palier la fenêtre ENTIÈRE est relâchée
     une fois — la reprise, la distance obtenue tenue par un ressort plus raide. C'est
     elle qui empêche la tension du rapprochement de s'entasser jusqu'au dernier pas
     (et un cycle plan de rester plissé) : chaque palier part d'une géométrie DÉTENDUE,
     au lieu d'hériter de la tension du précédent. Le geste REFERME ensuite sur la
     cible de l'utilisateur — un dernier rapprochement court, puis une dernière
     reprise — donc le modèle rendu est un modèle relâché, à la distance demandée.
     UN SEUL PALIER (cible toute proche, ou `stageStep` à 0) est le geste d'AVANT :
     une descente, la contrainte posée d'un bout à l'autre, puis une reprise. */
  const span = maxSteps > 0 && active.pairs.length
    ? Math.max(...active.pairs.map((t, i) => Math.abs(t.target - beforePairs[i].distance)))
    : 0;
  const askedStage = Number(stageStep);
  const stageSize = Number.isFinite(askedStage)
    ? Math.max(0, Math.min(RELAX_MAX_STAGE_STEP, askedStage))
    : RELAX_STAGE_STEP;
  const stageMax = Math.max(1, Math.round(Number(maxStages) || RELAX_MAX_STAGES));
  /* ⚠ UNE DISTANCE QUI DÉPASSE LE DÉCOUPAGE PRÉVU — vingt-quatre paliers de 2 Å ne
     couvrent que 48 Å, et la version d'avant s'ARRÊTAIT donc là : sur une chaîne
     étendue (153 Å à couvrir d'après `_geometry_relax_test.mjs`), la molécule
     restait étirée, à moitié repliée de travers, et le rapport ne savait dire que
     « max-steps ». Le PAS grandit maintenant pour que le voyage ENTIER tienne dans
     le plafond de paliers (153 Å en 24 paliers de 6.27 Å, mesuré) au lieu d'être
     tronqué : même nombre de paliers, même budget de pas, mais la cible est atteinte
     (153 Å → 13.52 Å, là où l'ancien découpage s'arrêtait au bout de 48 Å). Quand
     le plafond ne mordait pas, `stageSpan` EST `stageSize` et rien ne change. */
  const stageSpan = stageSize > 0 ? Math.max(stageSize, span / stageMax) : 0;
  const stageCount = stageSpan > 0 && span > stageSpan
    ? Math.min(stageMax, Math.ceil(span / stageSpan))
    : 1;
  const stageSteps = stageCount > 1
    ? Math.max(RELAX_MIN_STAGE_STEPS, Math.round(maxSteps / stageCount))
    : maxSteps;
  const restoreBudget = Math.max(0, Math.round(Number(restoreSteps) || 0));
  /* La cible de chaque paire à un avancement donné — de sa distance de DÉPART à la
     cible de l'utilisateur, au prorata (toutes les paires avancent ensemble). */
  const planTargets = (progress) => pairTargets.map((target, i) => (
    beforePairs[i].distance + (target - beforePairs[i].distance) * progress
  ));
  const stagePlan = [];
  let restorations = 0;
  let restoreFrom = null;
  let restoreTo = null;
  let restoreDrift = 0;
  let stepsTaken = 0;
  /* LA REPRISE — une descente où la contrainte ne tire plus : sa cible est la
     distance obtenue, et son ressort plus raide, donc les liaisons, les angles, les
     cycles et la longe se détendent SANS que la distance reparte. `restoreDrift`
     retient de combien elle a bougé quand même (la plus grande, sur toutes les
     reprises) : c'est ce chiffre que le rapport affiche, et il doit rester petit —
     c'est la contrainte que l'utilisateur a demandée. */
  const restore = () => {
    if (!restoreBudget) return;
    if (!restoreFrom) restoreFrom = summaryOf(energyOf(active, x));
    const held = distancesOf();
    setPairSpring(RELAX_RESTORE_STIFFNESS);
    const hold = descend({ budget: restoreBudget, target: held, reach: false, phase: 'restore' });
    setPairSpring(1);
    /* LE RESSORT RETIRÉ, L'ÉTAT EST RECALCULÉ — sans ce `rescore`, `current` garderait
       la raideur 8× et la cible « tenue » du dernier pas accepté, et les énergies
       annoncées (l'animation) ne seraient pas celles de l'état réel. */
    rescore();
    const kept = distancesOf();
    kept.forEach((d, i) => {
      const drift = Math.abs(d - held[i]);
      if (drift > restoreDrift) restoreDrift = drift;
    });
    stepsTaken += hold.taken;
    if (hold.stop === 'stalled') stalledOnce = true;
    restoreTo = summaryOf(energyOf(active, x));
    restorations += 1;
  };
  if (maxSteps > 0 && active.pairs.length) {
    stageTotal = stageCount;
    for (let k = 1; k <= stageCount; k += 1) {
      const progress = span > 0 ? Math.min(1, (k * stageSpan) / span) : 1;
      const targets = planTargets(progress);
      stageIndex = k;
      const step = descend({ budget: stageSteps, target: targets, reach: true });
      stepsTaken += step.taken;
      reason = step.stop;
      if (step.stop === 'stalled') stalledOnce = true;
      stagePlan.push({ progress, target: targets, distance: distancesOf(), stop: step.stop });
      restore();
    }
    stageIndex = 0;
    if (stageCount > 1) {
      const close = descend({
        budget: Math.max(1, Math.round(stageSteps / 2)), target: pairTargets, reach: false,
      });
      stepsTaken += close.taken;
      reason = close.stop;
      if (close.stop === 'stalled') stalledOnce = true;
      restore();
    }
  } else if (maxSteps > 0) {
    const step = descend({ budget: maxSteps, target: null, reach: false });
    stepsTaken += step.taken;
    reason = step.stop;
    if (step.stop === 'stalled') stalledOnce = true;
  }

  /* ── LES ÉCHAPPÉES — SORTIR DE LA BUCHE OÙ LA DESCENTE S'EST POSÉE ───────────
     « E se usassi un metodo di minimizzazione che esce dalle buche locali? » La
     descente ci-dessus est LOCALE : elle s'arrête au premier creux et le DIT
     (`reason: 'stalled'`). Sur un REPLIEMENT lointain — deux atomes que seule une
     autre conformation peut rapprocher — ce creux est un mur, et la molécule reste
     étirée, pliée de travers : c'est le « non funziona » du rapport. Le module
     rejoue donc la descente depuis d'autres conformations : une BOTTE DE TORSION
     (`torsionKickOf`), une descente courte, et le MEILLEUR modèle est gardé — la
     « Monte Carlo minimization » de Li & Scheraga. Le modèle rendu n'est JAMAIS
     moins bon que celui de la descente ordinaire.
     Deux critères, et pas un seul : l'énergie ET les contacts trop courts
     (`clashReportOf`), parce qu'une conformation qui rapproche la cible en faisant
     passer un atome À TRAVERS un autre n'est pas une solution — c'est exactement
     le « géométrie irréalisable » de la demande. Rien n'est imprévisible pour
     autant : la graine est fixe (`seed`). `escapes` = 0 rend le geste d'AVANT. */
  const escapeWanted = Math.max(0, Math.min(RELAX_MAX_ESCAPES, Math.round(Number(escapes) || 0)));
  const escapeBudget = Math.max(1, Math.round(Number(escapeSteps) || RELAX_ESCAPE_STEPS));
  const kickMax = Math.max(RELAX_MIN_KICK_DEG, Math.min(RELAX_MAX_KICK_DEG,
    Number.isFinite(Number(kickDeg)) ? Math.abs(Number(kickDeg)) : RELAX_KICK_DEG));
  const clashMin = Number(clashDistance) > 0 ? Number(clashDistance) : RELAX_CLASH_DISTANCE;
  const random = makeRelaxRandom(seed == null ? RELAX_ESCAPE_SEED : seed);
  const scoreOf = (arr) => {
    /* LA MÊME FONCTION CIBLE QUE LA DESCENTE, LONGE COMPRISE : sans elle, une botte
       pourrait « gagner » en éloignant la molécule de son point de départ, et la
       promesse « jamais moins bon que la descente ordinaire » ne serait plus vraie
       sous l'objectif de la descente elle-même. */
    const e = energyOf(active, arr, { ref: x0, tether: tetherWeight, movable: movableList });
    const c = clashReportOf({ positions: arr, bonds, movable: clashAtoms, minDistance: clashMin });
    return {
      total: e.total, clash: c, score: e.total + RELAX_CLASH_WEIGHT * c.severity,
      energy: e.total - (Number(e.tether) || 0),
    };
  };
  const escapeState = {
    wanted: escapeWanted, tried: 0, improved: 0, rejected: 0, used: false,
    skip: escapeWanted ? '' : 'off', plan: [], best: null,
  };
  const pairSeeds = [...new Set(active.pairs.flatMap((t) => [t.i, t.j]))];
  /* LA CIBLE REDEVIENT CELLE DE L'UTILISATEUR AVANT DE JUGER — la reprise laisse les
     cibles à la distance OBTENUE (« la contrainte cesse de tirer, elle tient »), donc
     lire `reached` sans les remettre jugerait le geste sur la mauvaise cible et les
     échappées seraient sautées à tort. C'est aussi la cible sur laquelle une botte se
     juge : la distance DEMANDÉE, pas un palier de passage. */
  setPairTargets(pairTargets);
  active.pairs.forEach((t, i) => { t.target = pairTargets[i]; });
  rescore();
  const reachedNow = active.pairs.length > 0 && pairReportOf(active, x).every((p) => p.reached);
  if (escapeWanted && !maxSteps) escapeState.skip = 'no-steps';
  else if (escapeWanted && !active.pairs.length) escapeState.skip = 'no-pair';
  else if (escapeWanted && reachedNow && !stalledOnce) escapeState.skip = 'reached';
  if (!escapeState.skip) {
    let best = scoreOf(x);
    let bestX = x.slice();
    escapeTotal = escapeWanted;
    for (let e = 0; e < escapeWanted; e += 1) {
      escapeTry = e + 1;
      /* L'AMPLITUDE DÉCROÎT — les premières bottes explorent, les dernières ajustent. */
      const amp = Math.max(RELAX_MIN_KICK_DEG, kickMax * (1 - e / escapeWanted));
      const kick = torsionKickOf({
        positions: bestX, bonds, atomCount: count, movable: movableList,
        seeds: pairSeeds, angleDeg: amp, rnd: random,
      });
      if (!kick.ok) { escapeState.skip = kick.reason; break; }
      x = kick.positions.slice();
      /* LA BOTTE TOURNE LA FENÊTRE : le reste est reposé derrière elle, donc la
         conformation essayée est jugée sur un modèle entier, elle aussi. */
      rebuildPass(x);
      rescore();
      emit('kick', { final: true, bond: kick.bond, angle: kick.angle, turned: kick.turned });
      const step = descend({ budget: escapeBudget, target: null, reach: false, phase: 'escape' });
      stepsTaken += step.taken;
      const cand = scoreOf(x);
      const accepted = cand.score < best.score - 1e-9;
      const distances = distancesOf();
      escapeState.tried += 1;
      escapeState.plan.push({
        attempt: e + 1, angle: kick.angle, bond: kick.bond, turned: kick.turned,
        energy: cand.energy, score: cand.score, clash: cand.clash.count,
        distance: distances, accepted, stop: step.stop,
      });
      emit('escape', {
        final: true, energy: cand.energy, distances, accepted,
        clash: cand.clash.count, bond: kick.bond, angle: kick.angle,
      });
      if (accepted) { escapeState.improved += 1; best = cand; bestX = x.slice(); } else escapeState.rejected += 1;
    }
    escapeTry = 0;
    escapeTotal = 0;
    x = bestX.slice();
    rescore();
    escapeState.used = escapeState.tried > 0;
    escapeState.best = {
      energy: best.energy, score: best.score, clashes: best.clash.count,
      worst: best.clash.worst ? { ...best.clash.worst } : null,
      distance: distancesOf(),
    };
    /* UNE ÉCHAPPÉE QUI A GAGNÉ EST UNE RÉPONSE, PAS UN CUL-DE-SAC : la descente
       s'était posée quelque part, les bottes ont trouvé mieux, et c'est CE
       modèle-là qui est rendu — détendu, la distance obtenue tenue (la reprise). */
    if (escapeState.improved > 0) {
      reason = 'escaped';
      stalledOnce = false;
      restore();
    }
  }

  /* LE RAPPORT — relu sur les coordonnées RÉELLEMENT obtenues, jamais supposé. La
     cible de chaque paire est celle de l'UTILISATEUR (le rapprochement par paliers
     n'est qu'un chemin), et l'énergie est recalculée à cette cible-là. */
  active.pairs.forEach((t, i) => { t.target = pairTargets[i]; });
  const afterPairs = pairReportOf(active, x);
  /* LES ATOMES DÉPLACÉS — ceux de `loose` (la fenêtre, plus ceux que le rebâtiment
     repose quand il est demandé), relus sur les coordonnées obtenues : un atome que le
     rebâtiment a laissé à sa place n'est pas annoncé comme déplacé. */
  const moved = [];
  for (const i of loose) {
    if (Math.abs(x[i * 3] - x0[i * 3]) + Math.abs(x[i * 3 + 1] - x0[i * 3 + 1])
      + Math.abs(x[i * 3 + 2] - x0[i * 3 + 2]) > 1e-9) moved.push(i);
  }
  const reached = afterPairs.length > 0 && afterPairs.every((p) => p.reached);
  /* LES CONTACTS TROP COURTS DU MODÈLE RENDU — le dernier mot sur la
     « réalisabilité » : le rapport l'affiche, et le panneau le dit en clair. */
  const finalClashes = clashReportOf({ positions: x, bonds, movable: clashAtoms, minDistance: clashMin });
  /* LE DERNIER ÉTAT EST RECALCULÉ AVANT D'ÊTRE ANNONCÉ — les cibles viennent d'être
     remises à celles de l'utilisateur, donc `current` devient exactement l'énergie du
     rapport : le dernier chiffre de l'animation est celui que le panneau affiche. */
  rescore();
  emit('final', { final: true });
  return {
    ok: true,
    /* UNE DESCENTE QUI S'EST POSÉE LE DIT, même quand les paliers suivants ont fini
       autrement : `stalled` est la vérité la plus utile quand la cible n'est pas
       atteinte (l'autre raison n'est qu'un budget épuisé). */
    reason: stalledOnce ? 'stalled' : reason,
    converged: reached, reached, unstuck,
    positions: x,
    moved,
    before,
    after: summaryOf(energyOf(active, x)),
    pairs: beforePairs.map((p, i) => ({
      i: p.i, j: p.j, target: p.target,
      before: p.distance, after: afterPairs[i].distance,
      deviation: afterPairs[i].deviation, reached: afterPairs[i].reached,
    })),
    stages: stagePlan.length,
    stageStep: stageSpan,
    stagePlan,
    restorations,
    /* CE QUE LA REPRISE A RENDU — les écarts moyens du premier état d'avant reprise
       et du dernier état d'après, et de combien la distance DEMANDÉE a bougé au
       passage (`pairDrift`, la plus grande des reprises) : c'est le chiffre qui dit
       si la molécule arrive tendue ou détendue, et si la distance tient (voir
       `relaxReportOf`, qui l'affiche). */
    restore: restoreFrom && restoreTo ? {
      passes: restorations,
      bondRms: { before: restoreFrom.bondRms, after: restoreTo.bondRms },
      angleRms: { before: restoreFrom.angleRms, after: restoreTo.angleRms },
      planarRms: { before: restoreFrom.planarRms, after: restoreTo.planarRms },
      pairDrift: restoreDrift,
    } : null,
    /* LES ÉCHAPPÉES — ce qu'elles ont essayé, ce qu'elles ont gagné, et pourquoi
       elles n'ont pas tourné du tout (`skip` : 'off' quand le geste n'en demande
       aucune, 'no-pair' sans distance demandée, 'no-steps', 'reached' quand la
       descente n'était PAS coincée — il n'y avait rien à fuir — ou la raison d'une
       botte impossible : 'no-bond', 'no-bridge' quand aucune liaison n'est une
       charnière). */
    escapes: escapeState,
    /* LES CONTACTS TROP COURTS DU MODÈLE RENDU (voir `clashReportOf`) : `count: 0`
       veut dire « aucun atome passé à travers un autre » au seuil du module. */
    clashes: finalClashes,
    /* LE REBÂTIMENT DE LA PARTIE HORS FENÊTRE (voir §7bis) — `null` quand le geste ne
       l'a pas demandé. `passes` = combien de fois il a tourné (une fois par pas),
       `atoms` = ses atomes reposés, `moved` = ceux qui ont vraiment bougé, `parts` =
       les composantes qu'aucune liaison ne relie à la fenêtre (rebâties depuis leur
       propre racine), `untouched` = ce qu'il a laissé (les ancres, les atomes seuls,
       tout ce dont la table ne connaît pas la liaison), et `bonds`/`angles` = les
       écarts AVANT (la molécule reçue) et APRÈS (le modèle rendu) de SA partie. */
    rebuild: rebuildOn ? rebuildReportOf(rebuildPlan, x0, x, rebuildPasses) : null,
    steps: stepsTaken,
    evaluations,
    terms: termInfo,
    hybrids: terms.hybrids,
  };
};

/* ── 8bis · LE CONSTRUIT AUTOMATIQUE — LES DISTANCES FAUSSES, CONDUITES L'UNE APRÈS
   L'AUTRE, SANS QUE PERSONNE NE LES DÉSIGNE ──────────────────────────────────────
   La demande, mot pour mot :

     « model build should also work without defining the atoms to bring closer and
       their distance : the function should find the wrong distances by itself and
       apply the “bring them closer step by step”/“relax”/“rebuild” protocol (the
       one already defined for two atoms) to impose the right distances until
       everything is back. If the protocol on the first distance has generated
       other wrong distances, move on to the second. »

   Ce que ce geste fait, et rien d'autre — il emploie le protocole de §8 TEL QUEL,
   une distance à la fois :

     1. BALAYER la molécule (`badDistancesOf`, §7ter) : les liaisons du graphe dont
        la longueur s'écarte de plus de `tolerance` (0.2 Å) de la longueur de la
        table — cible de la descente, ordre et aromatique compris, jamais une
        seconde table. Le classement est par écart DÉCROISSANT : la plus fausse
        d'abord, celle qui a le plus de chances d'être la CAUSE des autres ;
     2. CONDUIRE chacune d'elles avec LE protocole à deux atomes déjà défini —
        `relaxGeometry` avec une seule paire, donc le rapprochement PAR PALIERS
        (« ⇉ stages »), la REPRISE qui relâche la fenêtre entière après chaque
        palier (`restore`), les 🎲 échappées quand la descente se pose dans une
        buche, et le REBÂTIMENT de la partie hors fenêtre (`rebuild`, §7bis). La
        fenêtre est celle du couple, au rayon demandé : le geste reste LOCAL ;
     3. REEXAMINER la molécule que le geste précédent a laissée, et PASSER À LA
        SUIVANTE. Une distance que le geste précédent a déjà mise à sa longueur est
        donc ANNONCÉE comme telle (« déjà à sa longueur ») au lieu d'être reconduite
        pour rien — c'est le cas le plus fréquent : un seul repliement remet souvent
        d'aplomb toute une chaîne ;
     4. à la fin du balayage, s'il RESTE des longueurs fausses — celles que les
        gestes ont créées ailleurs, ce que la demande prévoit —, le balayage SUIVANT
        les conduit à leur tour. On continue tant qu'un balayage AMÉLIORE quelque
        chose (`RELAX_AUTO_PASSES` au plus, `RELAX_AUTO_MAX_DISTANCES` distances par
        balayage), et on s'arrête quand plus RIEN n'est faux — ou en le DISANT, avec
        les chiffres : `left` porte les distances qui restent fausses et leur écart
        réel, jamais un silence.

   ⚠ CE QUE CE GESTE N'EST PAS, pour que le rapport ne le laisse pas croire :
     · il n'invente aucune liaison : un couple que le fichier ne déclare pas lié
       n'est jamais rapproché (les contacts trop courts sont MESURÉS et affichés,
       `clashReportOf`, comme partout ailleurs) ;
     · il n'est pas un champ de forces ni un recuit : chaque distance est conduite
       par la même descente locale et déterministe que le geste manuel, à graine
       fixe, donc le même modèle donne TOUJOURS le même construit ;
     · il ne promet pas la perfection : une chaîne fermée sur elle-même ou un cycle
       tenu plan peut refuser une longueur, et c'est alors `left` — mesuré, chiffré,
       affiché — qui le dit ;
     · il ne modifie aucun argument (le dossier ne touche jamais ce qu'il reçoit) :
       les coordonnées rendues sont une COPIE.

   Le geste est ANIMABLE comme celui de §8 : chaque pas de chaque distance est
   annoncé (`onStep`) avec, en plus, la distance en cours (`distance`, `pass`,
   `total`) et une liste d'atomes STABLE — tout le modèle —, parce que le geste
   automatique balaye la molécule entière et que n'importe quel atome peut donc
   bouger (une image qui n'écrirait qu'une partie laisserait le reste à la géométrie
   de l'image précédente).
 */


/**
 * LE CONSTRUIT AUTOMATIQUE — voir §8bis pour ce qu'il fait, dans l'ordre.
 *
 * @param {{positions:number[]|Float32Array|number[][], elements?:any[], bonds?:any[],
 *          movable?:number[]|null, tolerance?:number, passes?:number,
 *          maxDistances?:number, radius?:number, steps?:number, stageStep?:number,
 *          escapes?:number, escapeSteps?:number, kickDeg?:number, seed?:number,
 *          rebuild?:boolean, clashDistance?:number, weights?:object,
 *          onStep?:Function, stepEvery?:number}} spec
 *   `positions` / `elements` / `bonds` = la molécule, comme partout dans le module.
 *   `movable` = la restriction FACULTATIVE de l'appelant : donnée, chaque fenêtre y
 *   est découpée (aucun atome hors de cette liste ne bouge) ; sans elle, chaque
 *   distance a pour fenêtre ses deux atomes et leurs voisins à `radius` liaisons.
 *   `tolerance` = à partir de quel écart une longueur est dite fausse (0.2 Å) ;
 *   `passes` / `maxDistances` = les deux plafonds de la boucle (§8bis, point 4) ;
 *   `radius`, `steps`, `stageStep`, `escapes`, `rebuild`, `clashDistance`, `seed`,
 *   `weights` = les réglages du protocole de §8, passés tels quels ;
 *   `onStep` / `stepEvery` = le pas vu de l'extérieur (voir §8).
 * @returns {{ok:boolean, reason:string, converged:boolean, positions:number[]|null,
 *            moved:number[], before:object|null, after:object|null, terms:object,
 *            found:number, tolerance:number, worst:object|null, distances:object[],
 *            skipped:object[], left:object[], leftSeverity:number, passes:object[],
 *            passCount:number, truncated:boolean, steps:number, evaluations:number,
 *            escapes:object, clashes:object|null, rebuild:object|null}}
 *   `distances` = chaque distance CONDUITE, avec ce qu'elle était avant, ce qu'elle
 *   est après, et la raison de la descente qui l'a conduite (`reached` = elle est
 *   arrivée à sa cible) ; `skipped` = celles qu'un geste précédent avait déjà mises
 *   à leur longueur (`already-there`), ou dont la fenêtre était vide (`no-window`) ;
 *   `left` = celles qui RESTENT fausses à la fin, mesurées ; `passes` = le journal
 *   des balayages (ce qu'ils ont trouvé, conduit, gagné) ; `converged` = plus une
 *   seule longueur fausse.
 */
export const buildModelGeometry = (spec = {}) => {
  const {
    positions = null, elements = [], bonds = [], movable = null,
    tolerance = RELAX_BAD_BOND_TOLERANCE, passes = RELAX_AUTO_PASSES,
    maxDistances = RELAX_AUTO_MAX_DISTANCES, radius = RELAX_DEFAULT_RADIUS,
    weights = RELAX_WEIGHTS,
    steps = RELAX_MAX_STEPS, stageStep = RELAX_STAGE_STEP,
    escapes = RELAX_ESCAPES, escapeSteps = RELAX_ESCAPE_STEPS,
    kickDeg = RELAX_KICK_DEG, seed = RELAX_ESCAPE_SEED,
    rebuild = RELAX_REBUILD, clashDistance = RELAX_CLASH_DISTANCE,
    onStep = null, stepEvery = 1,
  } = spec || {};

  const read = flatPositions(positions);
  if (!read) {
    return {
      ok: false, reason: 'bad-points', converged: false, positions: null, moved: [],
      before: null, after: null, terms: null, found: 0, tolerance: 0, worst: null,
      distances: [], skipped: [], left: [], leftSeverity: 0, passes: [], passCount: 0,
      truncated: false, steps: 0, evaluations: 0, escapes: null, clashes: null, rebuild: null,
    };
  }
  const count = read.count;
  const els = Array.from(elements || []).map((e) => element(e));
  const x0 = read.flat.slice();
  let x = x0.slice();
  /* LES TERMES DU RAPPORT — construits UNE fois sur la molécule REÇUE, comme dans
     `relaxGeometry` : les énergies « avant / après » se lisent donc sur les MÊMES
     termes, et la comparaison veut dire quelque chose. Les BALAYAGES, eux, relisent
     la molécule à chaque passage (`badDistancesOf` sans `terms`) : c'est ce que fait
     chaque descente, qui reconstruit ses propres termes sur ses propres
     coordonnées — un cycle que le geste a redressé peut devenir aromatique, et les
     deux lectures doivent rester la même lecture. */
  const baseTerms = buildRelaxTerms({ elements: els, bonds, weights, positions: x0 });
  const termInfo = {
    bonds: baseTerms.bonds.length, angles: baseTerms.angles.length,
    planars: baseTerms.planars.length,
    rings: new Set(baseTerms.planars.map((t) => t.ring)).size,
    pairs: 0, unstuck: 0, bondCount: baseTerms.bondCount,
    unknownBonds: baseTerms.unknownBonds, aromaticBonds: baseTerms.aromaticBonds,
    positions: count,
  };
  const refuse = (reason) => ({
    ok: false, reason, converged: false, positions: null, moved: [], before: null,
    after: null, terms: termInfo, found: 0, tolerance: Number(tolerance) || 0,
    worst: null, distances: [], skipped: [], left: [], leftSeverity: 0, passes: [],
    passCount: 0, truncated: false, steps: 0, evaluations: 0, escapes: null,
    clashes: null, rebuild: null,
  });
  if (!baseTerms.bonds.length) return refuse('no-terms');

  const restrict = movable == null ? null : new Set(Array.from(movable)
    .map(Number).filter((i) => isIndex(i) && i < count));
  if (restrict && !restrict.size) return refuse('no-movable');

  /* TOUS LES ATOMES, OU LA RESTRICTION DE L'APPELANT — la liste que les images
     écrivent (voir §8bis, dernier paragraphe) : stable d'un pas à l'autre, donc
     l'animation du panneau n'a pas à se retailler en cours de geste. */
  const looseAll = restrict ? [...restrict].sort((a, b) => a - b)
    : Array.from({ length: count }, (_, i) => i);

  const before = summaryOf(energyOf(baseTerms, x));
  const gap = (arr, i, j) => dist3(
    [arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]],
    [arr[j * 3], arr[j * 3 + 1], arr[j * 3 + 2]],
  );

  /* ── LE BALAYAGE, ET LE PROTOCOLE DISTANCE PAR DISTANCE ─────────────────────── */
  const limit = Number(tolerance) >= 0 ? Number(tolerance) : RELAX_BAD_BOND_TOLERANCE;
  const passMax = Math.max(1, Math.round(Number(passes) || RELAX_AUTO_PASSES));
  const driveMax = Math.max(1, Math.round(Number(maxDistances) || RELAX_AUTO_MAX_DISTANCES));
  const first = badDistancesOf({ elements: els, bonds, positions: x, tolerance: limit });
  let left = first.distances;
  const records = [];
  const skipped = [];                 // ce qui n'a PAS été conduit, et pourquoi
  const passLog = [];
  const escapeLog = { wanted: 0, used: false, tried: 0, improved: 0, rejected: 0 };
  let rebuildLog = null;
  let stepsTaken = 0;
  let evaluations = 0;
  let truncated = first.count > driveMax;
  let reason = first.count ? 'max-passes' : 'clean';

  /* LE PAS VU DE L'EXTÉRIEUR — le même `onStep` que §8, préfixé de la distance en
     cours : `distance`, `pass` et `index/total` répondent à « laquelle conduit-il ? »,
     et `loose` est la liste STABLE (tout le modèle, voir §8bis). */
  const emitOf = (info, pass) => (typeof onStep !== 'function' ? null : (v) => {
    onStep({
      ...v,
      loose: looseAll,
      pass,
      distance: {
        i: info.i, j: info.j, target: info.target, index: info.index, total: info.total,
      },
    });
  });
  const skip = (pass, d, at, why) => {
    /* LE NUMÉRO DU BALAYAGE, comme dans `distances` — jamais l'objet du journal :
       un rapport se lit champ par champ, et `pass` y est un nombre. */
    skipped.push({ pass: pass.pass, i: d.i, j: d.j, target: d.target, distance: at, why });
    pass.skipped += 1;
  };

  if (first.count) {
    let found = first;
    for (let p = 1; p <= passMax && found.count; p += 1) {
      const planned = found.distances.slice(0, driveMax);
      if (found.count > driveMax) truncated = true;
      const pass = {
        pass: p, severity: found.severity, count: found.count,
        driven: 0, reached: 0, improved: 0, skipped: 0, after: null,
      };
      for (let k = 0; k < planned.length; k += 1) {
        const d = planned[k];
        /* LA DISTANCE EST RELUE AVANT D'ÊTRE CONDUIITE — le geste précédent l'a
           peut-être DÉJÀ mise à sa longueur (le cas le plus fréquent : un seul
           repliement remet d'aplomb toute une chaîne) : elle est alors ANNONCÉE comme
           telle au lieu d'être reconduite pour rien. */
        const at = gap(x, d.i, d.j);
        if (Math.abs(at - d.target) <= RELAX_BOND_TOLERANCE) {
          skip(pass, d, at, 'already-there'); continue;
        }
        const win = relaxWindow({ bonds, seeds: [d.i, d.j], radius, atomCount: count });
        const winAtoms = restrict ? win.movable.filter((i) => restrict.has(i)) : win.movable;
        if (!winAtoms.length) { skip(pass, d, at, 'no-window'); continue; }
        /* LE PROTOCOLE DE §8, TEL QUEL — une seule paire, donc les paliers, la
           reprise de chaque palier, les 🎲 échappées et le ⟳ rebâtiment. */
        const run = relaxGeometry({
          positions: x, elements: els, bonds, weights,
          pairs: [{ i: d.i, j: d.j, target: d.target }],
          movable: winAtoms, steps, stageStep,
          escapes, escapeSteps, kickDeg, seed, rebuild, clashDistance,
          onStep: emitOf({ i: d.i, j: d.j, target: d.target, index: k + 1, total: planned.length }, p),
          stepEvery,
        });
        stepsTaken += Number(run.steps) || 0;
        evaluations += Number(run.evaluations) || 0;
        if (!run.ok) { skip(pass, d, at, run.reason || 'refused'); continue; }
        x = run.positions;
        const pair = run.pairs[0] || null;
        const after = pair ? pair.after : at;
        const dev = after - d.target;
        pass.driven += 1;
        if (pair && pair.reached) pass.reached += 1;
        if (Math.abs(dev) < Math.abs(d.dev) - 1e-9) pass.improved += 1;
        if (run.escapes) {
          escapeLog.wanted += Number(run.escapes.wanted) || 0;
          escapeLog.tried += Number(run.escapes.tried) || 0;
          escapeLog.improved += Number(run.escapes.improved) || 0;
          escapeLog.rejected += Number(run.escapes.rejected) || 0;
          if (run.escapes.used) escapeLog.used = true;
        }
        /* LE ⟳ REBÂTIMENT, RÉSUMÉ DU PREMIER GESTE AU DERNIER — ce que la partie hors
           fenêtre a gagné pendant tout le construit automatique. */
        if (run.rebuild && run.rebuild.used) {
          const r = run.rebuild;
          if (!rebuildLog) {
            rebuildLog = {
              used: true, drives: 0, atoms: r.atoms, moved: 0, parts: r.parts,
              untouched: r.untouched,
              bonds: { rms: { before: r.bonds.rms.before, after: r.bonds.rms.after } },
              angles: { rms: { before: r.angles.rms.before, after: r.angles.rms.after } },
            };
          }
          rebuildLog.drives += 1;
          rebuildLog.moved = r.moved;
          rebuildLog.bonds.rms.after = r.bonds.rms.after;
          rebuildLog.angles.rms.after = r.angles.rms.after;
        }
        records.push({
          pass: p, i: d.i, j: d.j, target: d.target, order: d.order,
          before: at, after, dev, reached: !!(pair && pair.reached),
          reason: run.reason, stages: run.stages, restores: run.restorations,
          steps: run.steps, evaluations: run.evaluations,
          moved: run.moved.length, window: winAtoms.length,
          kicks: run.escapes ? run.escapes.tried : 0,
          clashes: run.clashes ? run.clashes.count : 0,
        });
      }
      /* LE BALAYAGE SUIVANT — la molécule est RELUE telle que les gestes l'ont
         laissée : les longueurs fausses qu'on y trouve (celles qu'ils ont CRÉÉES, et
         celles qu'ils n'ont pas réussi à corriger) sont celles du balayage suivant —
         « se il protocollo sulla prima distanza ha generato altre distanze incorrette
         si passa alla seconda ». */
      const next = badDistancesOf({ elements: els, bonds, positions: x, tolerance: limit });
      pass.after = { severity: next.severity, count: next.count };
      const moved = pass.reached > 0 || pass.improved > 0
        || next.severity < found.severity - 1e-9;
      passLog.push(pass);
      if (!next.count) { reason = 'converged'; left = []; break; }
      left = next.distances;
      if (!moved) { reason = 'stalled'; break; }
      if (p >= passMax) { reason = 'max-passes'; break; }
      found = next;
    }
  }

  /* ── LE RAPPORT — relu sur les coordonnées RÉELLEMENT obtenues, jamais supposé ──
     `moved` est mesuré sur ces coordonnées-là (un atome que le geste a laissé à sa
     place n'est pas annoncé comme déplacé), `worst` est la pire distance du PREMIER
     balayage relue à la fin, et `left` sort du DERNIER balayage : ce qui reste faux
     est donc mesuré, pas déduit de ce que les gestes ont promis. */
  const moved = [];
  for (let i = 0; i < count; i += 1) {
    if (Math.abs(x[i * 3] - x0[i * 3]) + Math.abs(x[i * 3 + 1] - x0[i * 3 + 1])
      + Math.abs(x[i * 3 + 2] - x0[i * 3 + 2]) > 1e-9) moved.push(i);
  }
  let worst = first.worst ? { ...first.worst } : null;
  if (worst) {
    worst.after = gap(x, worst.i, worst.j);
    worst.afterDeviation = worst.after - worst.target;
    worst.reached = Math.abs(worst.afterDeviation) <= RELAX_BOND_TOLERANCE;
    worst.driven = records.some((r) => r.i === worst.i && r.j === worst.j);
  }
  let leftSeverity = 0;
  for (const d of left) leftSeverity += d.abs;
  return {
    ok: true,
    reason,
    converged: !left.length,
    positions: x,
    moved,
    before,
    after: summaryOf(energyOf(baseTerms, x)),
    terms: termInfo,
    found: first.count,
    tolerance: limit,
    worst,
    distances: records,
    skipped,
    left,
    leftSeverity,
    passes: passLog,
    passCount: passLog.length,
    truncated,
    steps: stepsTaken,
    evaluations,
    escapes: escapeLog,
    clashes: clashReportOf({ positions: x, bonds, minDistance: clashDistance }),
    rebuild: rebuildLog,
  };
};


