/* ============================================================================
   src/utils/forceFieldKcal.js
   ⚙ LE CHAMP DE FORCES RÉEL — EN kcal/mol, AVEC LES CHARGES, LE SOLVANT, L'ENTROPIE
   ET LES ATOMES AJOUTÉS.

   La demande, mot pour mot : « implement a standard protocol … it would be great if
   you could apply the kcal/mol and add charge/solvent/entropy/added atoms ».

   Ce module est LA physique du calcul de structure (`utils/structureCalc.js`) : une
   fonction, des FAMILLES nommées, et des UNITÉS qui veulent dire quelque chose. Il ne
   connaît ni React ni NGL, il ne touche ni ses arguments ni l'écran, et il est
   déterministe : les mêmes coordonnées rendent le même nombre, au chiffre près.

   LES UNITÉS — les seules du dossier :
     • énergie    kcal/mol      (1 kcal = 4.184 kJ ; 1 kcal/mol = 6.9477e-21 J)
     • température K            (k_B = R = 1.98720425864083e-3 kcal·mol⁻¹·K⁻¹)
     • longueur   Å             • charge e (proton)  • temps ps  • masse amu
   L'énergie est donc COMPARABLE à celle de n'importe quel programme : un modèle à
   −120 kcal/mol n'est pas « meilleur » qu'un modèle à −80 sans dire sur quoi les deux
   ont été mesurés, mais les deux nombres sont dans la même unité, et chacun des termes
   est un terme PUBLIÉ :

     bond      Σ k_liaison·(d − d₀)², k = 300 kcal·mol⁻¹·Å⁻², d₀ par couple d'éléments
     angle     Σ k_angle·(θ − θ₀)²,   k = 50 kcal·mol⁻¹·rad⁻², θ₀ par hybridation
     planar    Σ k_plan·(dièdre du cycle)², k = 20 kcal·mol⁻¹·rad⁻²
     vdw       Lennard-Jones 12-6, ε_i par élément (kcal/mol), r_min = r_i + r_j (Bondi)
     elec      Σ 332.0637·q_i·q_j/(ε(r)·r) avec ε(r) = 4·r — le diélectrique dépendant de
               la distance, c'est-à-dire le modèle de solvant POLAIRE implicite standard
               (une charge écrantée par le milieu : 1/r → 1/r²)
     solv      solvatation NON polaire γ·A, γ = 7.2 cal·mol⁻¹·Å⁻² (0.0072 kcal/mol/Å²),
               A = surface exposée estimée par recouvrement des sphères de van der Waals
               (rayon de sonde 1.4 Å — la molécule d'eau)
     entropy   l'entropie conformationnelle QUASI-HARMONIQUE : un terme par torsion,
               S = R·(ln √(2π·k_B·T/k) + ½) avec la courbure k du potentiel qui la
               contient, plus les termes de translation et de rotation de la molécule
               entière. Rendue en cal·mol⁻¹·K⁻¹ ET en −T·S (kcal/mol).
     rama      Σ k_rama·(écart au bassin/100°)², k = 20 kcal/mol, lu sur LES POLYGONES
               DU GRAPHE 🪢 (aucun polygone recopié) — c'est le potentiel statistique du
               squelette, en kcal/mol
     chi       Σ k_χ·(1 + cos 3χ)/2, k = 1.5 kcal/mol — les trois conformères décalés
     omega     Σ k_ω·(1 − cos(over))/(1 − cos(180° − tolérance)), k = 20 kcal/mol AU CIS,
               NULLE dans le plateau de ± 30° — la barrière trans à SENS UNIQUE
     restraint Σ k_NOE·over² hors d'un PUITS PLAT de ± 0.25 Å, k = 20 kcal/mol/Å² —
               c'est le potentiel de contrainte standard d'un calcul de structure
               (XPLOR/CNS, CYANA) : la distance demandée ne coûte RIEN tant qu'elle est
               tenue, et coûte quadratiquement dès qu'elle ne l'est plus. LE POIDS ⚖
               D'UNE LIGNE (la colonne du panneau 🧬) MULTIPLIE ce k : k = k_NOE ×
               poids, un poids de 0 rend la ligne inerte (voir `ffRestraintWeightOf`)

   LES ATOMES AJOUTÉS — `hydrogenatedOf` complète la valence des atomes lourds par des
   HYDROGÈNES placés à leur géométrie idéale (longueurs de la table de `geometryRelax`,
   angles tétraédriques/trigonal-planaires). Tout le champ lit alors la molécule
   complète : les charges d'un H comptent dans le terme électrostatique, ses contacts
   comptent dans vdW et dans la surface. Le rapport rend le nombre d'atomes lourds et le
   nombre d'hydrogènes ajoutés, jamais un chiffre caché.

   LES CHARGES PARTIELLES — il n'y a PAS de bibliothèque de paramètres dans cette
   application, et le module ne prétend pas en avoir une : les charges sont
   ÉQUILIBRÉES PAR ÉLECTRONÉGATIVITÉ (PEOE, Gasteiger–Marsili 1980, χ = a + b·q + c·q²)
   sur le graphe de liaisons, PUIS corrigées par les charges FORMELLES que la chimie
   impose (carboxylate −1, guanidinium +1, ammonium +1, thiolate −1, phosphate −2).
   C'est une estimation, elle est DITE (`method`, `groups`, `net`), et la somme des
   charges d'une molécule neutre est nulle — un test le vérifie sur un peptide.

   ⚠ CE QUE CE MODULE N'EST TOUJOURS PAS — et le panneau le répète mot pour mot :
   aucune polarisabilité, aucun solvant EXPLICITE, aucune contre-ion, aucune
   dépendance à la force ionique, et la dynamique reste DIHÉDRALE : ce module dit ce
   que coûte une conformation, il ne déplace pas un atome.
   ========================================================================= */

/* ── 1 · LES UNITÉS, LES CONSTANTES, ET LES TABLES D'ÉLÉMENTS ────────────────── */
/* LES TABLES ET LE GRAPHE DU ⚒ — les cibles de liaison, d'angle et de cycle, le
   lecteur des coordonnées à plat et le graphe de liaisons viennent de
   `utils/geometryRelax.js` : une seule vérité dans le dossier, jamais une copie. Les
   POLYGONES du squelette viennent du module du graphe 🪢 (`ramachandran.js`) : le
   potentiel φ/ψ et ce que le graphe peint sont les mêmes bassins. */
import {
  RELAX_WEIGHTS, buildRelaxTerms, bondGraphOf, flatPositions, bondLengthTarget,
} from './geometryRelax.js';
import { RAMA_REGIONS, pointInPolygon, ramaGapOf, ramaRegionOf } from './ramachandran.js';
import { dihedralDeg } from './torsionDrive.js';



/** LES UNITÉS DU CHAMP — telles que le panneau les écrit. */
export const FF_KCAL_UNITS = {
  energy: 'kcal/mol', temperature: 'K', time: 'ps', length: 'Å', charge: 'e', mass: 'amu',
};

/** La température de RÉFÉRENCE des termes d'entropie (298.15 K). */
export const FF_REFERENCE_TEMPERATURE = 298.15;
/** k_B, PAR MOLÉCULE, dans les unités du champ : 1.98720425864083e-3 kcal·mol⁻¹·K⁻¹.
 *  C'est aussi R — et c'est le seul facteur qui relie une température à une énergie. */
export const FF_GAS_CONSTANT = 1.98720425864083e-3;
/** LA CONSTANTE DE COULOMB en kcal·Å·mol⁻¹·e⁻². */
export const FF_COULOMB = 332.0637133;
/** LE DIÉLECTRIQUE — ε(r) = 4·r : le milieu écranté de façon dépendante de la distance,
 *  le modèle implicite le plus simple qui existe. Un couple de charges produit alors
 *  83.016·q_i·q_j/r² kcal/mol. */
export const FF_DIELECTRIC = 4;
/** LE PONT ENTRE L'ÉNERGIE ET L'INERTIE — 1 kcal/mol vaut 418.4 amu·Å²·ps⁻². C'est lui
 *  qui fait de `√(k_B·T/M)` une VITESSE (Å/ps) et de `√(k_B·T/I)` une vitesse angulaire
 *  (rad/ps) : sans lui, une dynamique de corps rigide en amu ne serait pas thermostatée.
 *  4.184 kJ/mol ÷ 6.02214076·10²³ ÷ 1.66054·10⁻²⁷ kg = 418.4 (1 amu·Å²/ps²).
 *  ⚠ Le moteur DIHÉDRAL du dossier n'en a pas besoin — son inertie est RÉDUITE et
 *  calibrée pour que `√(R·T/m)` rende des degrés par picoseconde (voir
 *  `STRUCTURE_CALC_MD_MASS`) — mais une eau TIP3P a une VRAIE masse (15.9994 + 2 × 1.008
 *  amu) et un VRAI moment d'inertie : la conversion est donc écrite ici, une seule fois. */
export const FF_KCAL_PER_AMU_A2_PS2 = 418.4;
/** LES AMPLITUDES — les k de chaque famille, dans les unités dites plus haut. */
export const FF_BOND_K = 300;        // kcal·mol⁻¹·Å⁻²
export const FF_ANGLE_K = 50;        // kcal·mol⁻¹·rad⁻²
export const FF_PLANAR_K = 20;       // kcal·mol⁻¹·rad⁻²
/** La portée de la liste des couples non liés (Å) : au-delà, le couple n'existe pas. */
export const FF_VDW_PAIR_LIMIT = 6.5;
/* ⚠ LE PLANCHER D'UN COUPLE — ET LE TROU QU'IL AVAIT CREUSÉ. La constante dit « en dessous
   de 0.9 Å, le r⁻¹² n'est plus lu tel quel » (deux atomes au même endroit : la puissance 12
   y devient un nombre que rien ne peut additionner sans dominer tout le champ). Elle servait
   de SEUIL D'EXCLUSION — un couple plus court était RETIRÉ de la liste (`ffPairListOf`),
   ignoré par la somme (`ffNonbondedEnergyOf`) et compté ZÉRO par le coût lui-même : deux
   atomes qui se traversent s'effaçaient donc de la physique, et le champ n'avait plus rien
   pour les séparer (le défaut rapporté : « atoms can come too close and the LJ potential is
   not considered »). La constante reste le PLANCHER, mais c'est maintenant un plancher de
   RAMPE : sous 0.9 Å l'énergie est ÉTENDUE LINÉAIREMENT au lieu d'être annulée, donc le mur
   reste un mur (une pente de `FF_VDW_FLOOR_K` kcal/mol par ångström, 10⁴ fois la pente d'un
   contact normal) et deux atomes ne peuvent plus se superposer GRATUITEMENT. */
export const FF_VDW_SAME_ATOM = 0.9;
/** La pente de la rampe sous le plancher (kcal·mol⁻¹·Å⁻¹) : la même pour le LJ, la répulsion
 *  seule et la queue du puits — un seul mur, une seule pente, dite ici et lue par les trois. */
export const FF_VDW_FLOOR_K = 1e4;
/** Un couple 1-4 (trois liaisons entre les deux) : atténué comme dans AMBER. */
export const FF_VDW_FOURTH_SCALE = 0.5;
export const FF_ELEC_FOURTH_SCALE = 1 / 1.2;
/** Le solvant NON polaire : 7.2 cal·mol⁻¹·Å⁻², et la sonde de l'eau (1.4 Å). */
export const FF_SASA_GAMMA = 7.2e-3;   // kcal·mol⁻¹·Å⁻²
export const FF_SASA_PROBE = 1.4;      // Å
export const FF_SASA_POINTS = 92;      // points par atome (Shrake–Rupley)
/** LE RECOUVREMENT DES CALOTTES DANS LA SURFACE ESTIMÉE — 0.6. La surface du champ est
 *  un PRODUIT de fractions restantes (voir `ffSurfaceOf`), et les calottes de deux
 *  voisines se recouvrent : sans ce coefficient le modèle enterre trop (mesuré sur
 *  CH₃OH, 4 voisins par atome : 0.6 rend 152 Å² pour 161 Å² exacts, C₂H₅OH 170 pour
 *  193, C₆H₁₄ 149 pour 205). Le coefficient est MESURÉ, il est DIT, et le rapport rend
 *  toujours la valeur exacte à côté (`ffSasaOf`) : une estimation qui s'annonce. */
export const FF_SURFACE_CAP_OVERLAP = 0.6;
/** ω, χ1, φ/ψ — les trois potentiels de torsion, en kcal/mol. */
export const FF_OMEGA_K = 20;
export const FF_OMEGA_TARGET = 180;
export const FF_OMEGA_TOLERANCE = 30;   // ° : dans la tolérance, la barrière est nulle
export const FF_CHI_K = 1.5;
export const FF_CHI_TOLERANCE = 12;     // ° de part et d'autre d'un puits
export const FF_RAMA_K = 20;            // kcal/mol à 100° hors du bassin
export const FF_RAMA_SPAN = 100;        // ° — l'échelle du terme de Ramachandran
/** LA CONTRAINTE DE DISTANCE — un PUITS PLAT de ± 0.25 Å, k = 100 kcal/mol/Å². C'est le
 *  haut de la plage d'une contrainte NOE d'un vrai protocole (XPLOR/CNS vont de 20 à 100),
 *  et c'est MESURÉ : à k = 50 une chaîne de six carbones demandée à 3.90 Å se pose à
 *  4.19 Å (0.29 Å d'écart, donc un dépassement) ; à k = 100 elle se pose à 4.145 Å — DANS
 *  la tolérance. Elle reste TROIS FOIS plus douce qu'une liaison (300), donc la géométrie
 *  covalente ne peut pas être écrasée pour satisfaire une distance. */
export const FF_NOE_K = 100;
export const FF_RESTRAINT_TOLERANCE = 0.25;
/* ⛓ LES CONTRAINTES DE DIHÈDRE — la STRUCTURE SECONDAIRE IMPOSÉE (la peinture 🖌️ de
   « Sequence and structure » : H hélice α, E feuillet β) convertie en cibles de φ/ψ,
   en degrés. La forme est le PUITS PLAT des distances, transposé aux degrés : rien
   dans la tolérance, k·(écart − tolérance)² au-delà. k = 0.02 kcal·mol⁻¹·deg⁻² :
   10° dehors = 2 kcal/mol, 30° = 18 — l'ordre de grandeur de la barrière ω (20). */
export const FF_DIHEDRAL_K = 0.02;
export const FF_DIHEDRAL_TOLERANCE = 30;   // °
/* ⚠ LE FOND DU PUITS — ET LE DÉFAUT QU'IL AVAIT CREUSÉ. Le puits plat dit « dans les
   ± 30°, rien ne coûte rien » : c'est une FENÊTRE, pas un puits, et une fenêtre n'a
   aucun minimum — partout dedans la pente est nulle, donc rien n'y rappelle l'idéal, et
   la structure s'arrête là où le RESTE du champ la pousse : SUR la paroi. Mesuré sur le
   protocole du dossier (12 résidus ALA peints H, `_diag_helix.mjs`) : le modèle sorti du
   bâtisseur est une hélice exacte (écart φ 0.0°, i→i+4 O···N 3.09 Å, pénalité 0) et le
   protocole complet la DÉFAIT — φ rms 31.7°, ψ rms 26.0°, 12 φ/ψ HORS de la fenêtre,
   i→i+4 ≈ 6.9 Å (le rapport de l'utilisateur : « poorly helical »). La largeur de la
   fenêtre n'est pas la cause : à ± 10° l'écart tombe à 12.0° mais les ponts H ne
   reviennent pas, parce que la structure se pose ENCORE sur la paroi. D'où ce SECOND
   chiffre, le CENTRE DU PUITS : kc·(écart)² à l'intérieur de la fenêtre, borné à
   kc·tolérance² — donc, au-delà de la fenêtre, un simple DÉCALAGE CONSTANT (la forme du
   champ loin du but, et donc la recherche du recuit, ne changent pas ; la somme des deux
   quadratiques reste convexe et son seul minimum est la cible).
 *
 *  ⚠ LE CHIFFRE EST CHOISI PAR MESURE, PAS AU GOÛT — et la mesure N'EST PAS MONOTONE,
 *  parce que la raideur se bat avec l'amplitude du recuit (180°) : un puits trop raide
 *  rend chaque saut de 180° si cher que la marche de Metropolis REFUSE tout et que le
 *  protocole reste sur le tirage au sort. Balayage sur le protocole complet du dossier
 *  (draw=true, 🎯 dyana, même graine, `_kc_sweep.mjs` / `_kc_sweep_out.txt`) :
 *      kc     φ rms   ψ rms   max φ/ψ   α      ⛓ hors fenêtre
 *      0      25.5°   20.6°   30.2/30.9 10/12   2      ← la fenêtre plate (l'ancien)
 *      0.02   15.4°   15.7°   41.7/47.3  9/12   2      ← un fond mou ne suffit pas
 *      0.05    1.9°    1.8°    3.7/3.5  10/12   0
 *      0.10    1.6°    1.3°    2.5/3.2  10/12   0      ← LE CHIFFRE RETENU
 *      0.20   26.0°   20.7°   64.2/67.9  9/12   3      ← le recuit se bloque (trop raide)
 *      0.50   28.1°   23.3°   75.6/77.2  9/12   3
 *  À 0.1 l'écart résiduel (≤ 3.2°) vaut la limite de la recherche, plus celle du puits :
 *  en dessous de 0.05 la paroi reprend la main, au-dessus de 0.2 l'amplitude du recuit
 *  l'emporte. ⚠ 0 PAR DÉFAUT dans la FONCTION : sans ce chiffre, `ffDihedralCostOf` est
 *  EXACTEMENT le puits plat d'avant, et toute contrainte qui ne le donne pas est
 *  inchangée (c'est ce que fait le balayage à kc = 0, et les tests du puits plat). */
export const FF_DIHEDRAL_CENTRE_K = 0.1;

/** LES MASSES ATOMIQUES (amu) — ce qu'il faut pour l'entropie de rotation. */
export const FF_MASSES = {
  H: 1.008, D: 2.014, HE: 4.003, LI: 6.94, B: 10.81, C: 12.011, N: 14.007, O: 15.999,
  OW: 15.9994, HW: 1.008,
  F: 18.998, NE: 20.18, NA: 22.99, MG: 24.305, AL: 26.982, SI: 28.086, P: 30.974,
  S: 32.06, CL: 35.45, AR: 39.948, K: 39.098, CA: 40.078, SE: 78.971, BR: 79.904,
  I: 126.904,
};
/** La masse d'un élément inconnu — celle du carbone, et le rapport le dit (`unknown`). */
export const FF_MASS_FALLBACK = 12.011;

/** LES ε DE LENNARD-JONES (kcal/mol) — le puits d'un couple homonucléaire, table
 *  « all atom » classique (0.086 pour un carbone, 0.21 pour un oxygène de carbonyle).
 *  ε_ij = √(ε_i·ε_j) — la moyenne géométrique, la règle de mélange standard. */
export const FF_VDW_EPSILON = {
  H: 0.0157, D: 0.0157, C: 0.086, N: 0.17, O: 0.21, F: 0.061, P: 0.2, S: 0.25,
  OW: 0.1521, HW: 0,
  CL: 0.265, BR: 0.32, I: 0.4, SI: 0.4, B: 0.09, SE: 0.29, HE: 0.021, NE: 0.072,
  NA: 0.03, MG: 0.11, K: 0.03, CA: 0.12, AL: 0.4,
};
export const FF_VDW_EPSILON_FALLBACK = 0.1;

/** LA VALENCE USUELLE d'un atome lourd : elle décide COMBIEN d'hydrogènes le modèle
 *  ajoute (`hydrogenatedOf`). Un élément absent de cette table n'en reçoit aucun —
 *  le module n'invente pas une valence. */
export const FF_VALENCE = {
  H: 1, D: 1, B: 3, C: 4, N: 3, O: 2, F: 1, SI: 4, P: 3, S: 2, CL: 1, SE: 2, BR: 1, I: 1,
  /* 💧 L'EAU EXPLICITE — OW porte ses deux H (donc rien n'est ajouté) et HW n'en
     porte aucun : un atome d'eau traversé par `hydrogenatedOf` reste intact. */
  OW: 2, HW: 0,
};

/** LES RAYONS DE VAN DER WAALS (Å) — la table de Bondi, LA MÊME que celle de
 *  `geometryRelax.js` : une seule table dans le dossier, jamais deux. */
export const FF_VDW_RADII = {
  H: 1.20, D: 1.20, HE: 1.40, C: 1.70, N: 1.55, O: 1.52, F: 1.47, NE: 1.54,
  /* 💧 L'EAU EXPLICITE — rayon = σ/2 de TIP3P (voir FF_TIP3P) : le rayon d'un
     élément n'est PAS un rayon de Bondi ici, c'est la moitié d'un σ de mélange,
     et `ffNonbondedOf` en fait la somme r_min du couple — exactement ce que
     TIP3P demande. HW vaut 0 : aucun rayon propre, la répulsion vient de OW. */
  OW: 1.5753, HW: 0,
  SI: 2.10, P: 1.80, S: 1.80, CL: 1.75, AR: 1.88, B: 1.92, AL: 1.84,
  SE: 1.90, BR: 1.85, I: 1.98, LI: 1.82, NA: 2.27, K: 2.75, MG: 1.73, CA: 2.31,
};
export const FF_VDW_RADIUS_FALLBACK = 1.70;
/* ── 💧 L'EAU EXPLICITE — DEUX PSEUDO-ÉLÉMENTS, TIP3P ────────────────────────
   Le solvant EXPLICITE de la dynamique (voir `STRUCTURE_CALC_SOLVENTS`) est une
   BOÎTE DE MOLÉCULES D'EAU RIGIDES, et leurs atomes portent `OW` et `HW` au lieu
   de `O` et `H`. C'est ce qui permet au champ de leur donner LEURS paramètres
   sans une seconde table : `ffElementOf` les résout comme n'importe quel
   élément, `ffPairListOf` fabrique leurs couples, `hydrogenatedOf` ne touche pas
   à une eau complète (valence d'OW = 2, déjà pourvue) et `partialChargesOf`
   leur donne les charges FIXES de TIP3P au lieu d'une électroégativité.
   ⚠ `rmin` d'un couple est une SOMME de rayons (`ffNonbondedOf`) : le rayon de
   OW vaut donc σ/2 = 1.5753 Å (σ = 3.1506), et celui de HW zéro — l'atome d'eau
   n'a pas de répulsion propre dans TIP3P, et c'est voulu. */
export const FF_TIP3P = {
  ow: { sigma: 3.1506, radius: 1.5753, epsilon: 0.1521, charge: -0.834, mass: 15.9994 },
  hw: { sigma: 0, radius: 0, epsilon: 0, charge: 0.417, mass: 1.008 },
  /* LA GÉOMÉTRIE RIGIDE — longueur O–H et angle H–O–H de TIP3P. */
  oh: 0.9572, angle: 104.52,
};
/** LES EAUX D'UN TABLEAU D'ÉLÉMENTS — le nombre de molécules (2 H par O). */
export const ffWatersIn = (elements = []) => {
  let oxygens = 0; let hydrogens = 0;
  for (const el of Array.from(elements || [])) {
    const e = upper(el);
    if (e === 'OW') oxygens += 1;
    else if (e === 'HW') hydrogens += 1;
  }
  return { oxygens, hydrogens, molecules: oxygens };
};

const upper = (v) => String(v == null ? '' : v).trim().toUpperCase();
const elementAt = (els, k) => upper(els && els[k] != null ? els[k] : '');

/** Les paramètres d'un élément : masse, rayon, ε, valence. */
export const ffElementOf = (el) => {
  const e = upper(el);
  return {
    element: e,
    mass: FF_MASSES[e] != null ? FF_MASSES[e] : FF_MASS_FALLBACK,
    radius: FF_VDW_RADII[e] != null ? FF_VDW_RADII[e] : FF_VDW_RADIUS_FALLBACK,
    epsilon: FF_VDW_EPSILON[e] != null ? FF_VDW_EPSILON[e] : FF_VDW_EPSILON_FALLBACK,
    valence: FF_VALENCE[e] != null ? FF_VALENCE[e] : 0,
    known: FF_VDW_RADII[e] != null,
  };
};

/** LE COUPLE NON LIÉ — r_min, ε, et la charge des deux atomes : c'est TOUT ce dont un
 *  terme de van der Waals et un terme électrostatique ont besoin, et le module le
 *  fabrique une fois par couple (`ffPairListOf`). `scale.lj` et `scale.elec` atténuent
 *  un couple 1-4, comme dans AMBER et comme le dit le rapport. */
export const ffNonbondedOf = (i, j, els, charges, scale = {}) => {
  const a = ffElementOf(elementAt(els, i));
  const b = ffElementOf(elementAt(els, j));
  const qa = Number(charges ? charges[i] : 0) || 0;
  const qb = Number(charges ? charges[j] : 0) || 0;
  const lj = Number(scale.lj) || 1;
  const el = Number(scale.elec) || 1;
  return {
    i, j, elements: [a.element, b.element],
    rmin: a.radius + b.radius,
    epsilon: Math.sqrt(a.epsilon * b.epsilon) * lj,
    charges: [qa, qb],
    cqq: FF_COULOMB * qa * qb * el,
    fourth: lj !== 1 || el !== 1,
    known: a.known && b.known,
  };
};

/** LE MUR D'UN COUPLE SOUS LE PLANCHER — la RAMPE qui remplace l'annulation : au-dessus du
 *  plancher, `e` tel quel (± la queue du puits) ; en dessous, la même valeur PLUS une pente
 *  de `FF_VDW_FLOOR_K` kcal/mol par ångström parcouru vers zéro. C'est ce qui garde un
 *  GRADIENT sous le plancher (un couple évalué à un r constant n'aurait aucune force et
 *  deux atomes coincés resteraient coincés) tout en restant fini et continu au plancher. */
const floorWallOf = (r, e) => (r >= FF_VDW_SAME_ATOM ? e : e + FF_VDW_FLOOR_K * (FF_VDW_SAME_ATOM - r));
/** LA DISTANCE À LAQUELLE UN COUPLE EST LU — le plancher, jamais zéro : c'est ce qui rend
 *  le mur continu (`floorWallOf`) au lieu de le laisser partir à l'infini ou disparaître. */
const floorDistanceOf = (r) => (r >= FF_VDW_SAME_ATOM ? r : FF_VDW_SAME_ATOM);

/* ── 2bis · LA FORCE IONIQUE — L'ATMOSPHÈRE IONIQUE QUI ÉCRANTE UNE CHARGE ─────
   LA DEMANDE : « In MD and “structure calculation” allow to define the pH and ionic strength so
   that the molecule can be protonated or deprotonated and charge can be taken into
   consideration. » Le pH décide de CE QUE la molécule porte (§4bis, les groupes ionisables) ;
   la force ionique décide de COMMENT deux charges se voient dans cette solution.
   Le modèle est celui de Debye–Hückel, et il est entier : le potentiel de Coulomb d'un couple
   est multiplié par `exp(−κ·r)`, où κ (en Å⁻¹) vaut `3.29·√I` à 298 K pour une force ionique I
   en mol/L — l'atmosphère ionique d'un sel 150 mM (κ ≈ 1.27 Å⁻¹, longueur de Debye ≈ 0.79 Å)
   écrante donc une charge à courte portée, ce qui est le fait connu d'un tampon physiologique.
   ⚠⚠ UNE SEULE RÈGLE COMPTE, ET C'EST CELLE QUI PROTÈGE LE RESTE DU DOSSIER : I = 0 (le
   DÉFAUT) rend κ = 0, et `ffScreeningOf(0, r)` vaut **1 exactement** — le terme de Coulomb est
   alors, AU CHIFFRE PRÈS, celui d'avant cette section (aucun test du dossier ne peut bouger,
   aucune session enregistrée ne change de physique). Un appelant qui ne dit rien obtient donc
   le champ d'origine. */
export const FF_DEBYE_FACTOR = 3.29;   // κ = 3.29·√I, Å⁻¹ (I en mol/L, 298 K — Debye–Hückel)
export const FF_IONIC_STRENGTH_DEFAULT = 0;
/** κ DE LA FORCE IONIQUE — `0` pour toute valeur absente, nulle ou illisible (le défaut). */
export const ffDebyeKappaOf = (ionicStrength = FF_IONIC_STRENGTH_DEFAULT) => {
  const i = Number(ionicStrength);
  return Number.isFinite(i) && i > 0 ? FF_DEBYE_FACTOR * Math.sqrt(i) : 0;
};
/** LA LONGUEUR DE DEBYE (Å) — `1/κ`, l'échelle sur laquelle une charge est écrantée. Elle
 *  n'existe que si κ > 0 : sans sel, la réponse est `Infinity` (aucune échelle), pas un zéro
 *  qui laisserait croire à un écrantage total. */
export const ffDebyeLengthOf = (kappa = 0) => (Number(kappa) > 0 ? 1 / Number(kappa) : Infinity);
/** LE FACTEUR D'ÉCRANAGE D'UN COUPLE À LA DISTANCE r — `exp(−κ·r)`, et **exactement 1** sans
 *  sel. C'est la SEULE définition de l'écrantage ionique du dossier (le prix ET la pente d'un
 *  couple la lisent), donc un couple ne peut pas être poussé par une force que son prix ignore. */
export const ffScreeningOf = (kappa, r) => (!(Number(kappa) > 0) ? 1 : Math.exp(-Number(kappa) * Number(r)));

/** L'ÉNERGIE DE VAN DER WAALS D'UN COUPLE (kcal/mol) — Lennard-Jones 12-6 :
 *  ε·((r_min/r)¹² − 2·(r_min/r)⁶), nulle au minimum (r = r_min), répulsive en dessous,
 *  attractive au-dessus (jusqu'à −ε). C'est le MUR et le PUITS du dossier : deux atomes
 *  ne se traversent plus (l'ancien « cœur dur » était le seul terme du même genre, et il
 *  n'avait aucun puits — le champ réel en a un).
 *  ⚠ SOUS LE PLANCHER (`FF_VDW_SAME_ATOM`) le couple n'est PLUS une exception : la valeur
 *  au plancher est prolongée par la rampe (`floorWallOf`), donc un empilement coûte des
 *  millions de kcal/mol au lieu de zéro — voir la note de la constante. */
export const ffVdwCostOf = (r, pair) => {
  if (!pair || !Number.isFinite(r)) return 0;
  const rr = floorDistanceOf(r);
  const x = (pair.rmin / rr) ** 6;
  return floorWallOf(r, pair.epsilon * (x * x - 2 * x));
};

/** L'ÉNERGIE ÉLECTROSTATIQUE D'UN COUPLE (kcal/mol) — Coulomb écranté par le
 *  diélectrique dépendant de la distance : 332.0637·q_i·q_j/(ε(0)·r²). Nulle si l'une
 *  des deux charges est nulle (aucun terme inventé pour un atome neutre).
 *  ⚠ LE PLANCHER S'APPLIQUE AUSSI ICI : sous `FF_VDW_SAME_ATOM` la charge est lue à la
 *  distance du plancher, donc un couple d'ions opposés ne part pas à −∞ en se superposant
 *  (c'est le LENNARD-JONES qui sépare, avec sa pente — la charge ne peut pas aspirer). */
export const ffCoulombCostOf = (r, pair, dielectric = FF_DIELECTRIC, kappa = 0) => {
  if (!pair || !pair.cqq || !Number.isFinite(r)) return 0;
  const eps = Math.max(1e-6, Number(dielectric) || FF_DIELECTRIC);
  const rr = floorDistanceOf(r);
  /* 🌊 …ET L'ATMOSPHÈRE IONIQUE (voir §2bis) — κ = 0 (le défaut) rend 1, donc la branche du
     haut est, au chiffre près, la formule d'avant cette section : `q·q/(ε·r²)`. */
  if (!(Number(kappa) > 0)) return pair.cqq / (eps * rr * rr);
  return (pair.cqq * ffScreeningOf(kappa, rr)) / (eps * rr * rr);
};

/** LA RÉPULSION SEULE (kcal/mol) — ε·(r_min/r)¹², SANS le puits attractif et sans la
 *  charge : c'est le terme non lié du calcul de structure de type DYANA/CYANA, où deux
 *  atomes ne se traversent pas mais ne s'attirent pas. Un atome isolé n'a donc AUCUNE
 *  raison de venir se coller à un autre : ce sont les distances demandées qui assemblent
 *  la molécule, et c'est exactement la philosophie de ces programmes.
 *  ⚠ MÊME MUR QUE LE LJ : la rampe sous le plancher empêche un empilement gratuit (c'est
 *  la fonction cible de DYANA, donc celle d'une boîte d'eau explicite — deux eaux qui se
 *  traversent doivent coûter, sinon rien ne les sépare). */
export const ffRepulsionCostOf = (r, pair) => {
  if (!pair || !Number.isFinite(r)) return 0;
  const rr = floorDistanceOf(r);
  const x = (pair.rmin / rr) ** 6;
  return floorWallOf(r, pair.epsilon * x * x);
};

/** LE GRADIENT NON LIÉ D'UN COUPLE — `dV/dr`, en kcal·mol⁻¹·Å⁻¹ : la dérivée EXACTE de
 *  `ffNonbondedCostOf`, terme à terme, plancher et diélectrique compris. C'est ce dont un
 *  corps rigide a besoin pour bouger : la force sur l'atome `i` vaut `V'(r)·û` (û allant de
 *  `i` vers `j`), celle de `j` son opposée, donc un pas de Langevin lit UN nombre par couple
 *  au lieu d'une différence finie par degré de liberté.
 *   · au-dessus du plancher — LJ : `12·ε·x·(1−x)/r` (x = (r_min/r)⁶) ; répulsion seule :
 *     `−12·ε·x²/r` ; Coulomb : `−2·q_i·q_j/(ε·r³)` ;
 *   · SOUS le plancher (`FF_VDW_SAME_ATOM`) la pente est celle de la RAMPE,
 *     `−FF_VDW_FLOOR_K`, pour le Lennard-Jones comme pour la répulsion (les deux passent
 *     par `floorWallOf`), et Coulomb y est PLAT (sa distance est lue au plancher).
 *  ⚠ Un test compare ce gradient à la dérivée NUMÉRIQUE de `ffNonbondedCostOf` (LJ,
 *  répulsion seule, Coulomb, diélectrique, rampe) : les deux ne peuvent pas diverger.
 *  @returns {number} dV/dr (0 quand le couple n'a ni ε ni charge lisible) */
export const ffNonbondedGradientOf = (r, pair, {
  dielectric = FF_DIELECTRIC, repulsionOnly = false, electrostatics = true, kappa = 0,
} = {}) => {
  if (!pair || !Number.isFinite(r) || r <= 0) return 0;
  if (r < FF_VDW_SAME_ATOM) return -FF_VDW_FLOOR_K;
  const x = (pair.rmin / r) ** 6;
  const dVdw = (12 * pair.epsilon * x * (repulsionOnly ? -x : (1 - x))) / r;
  const eps = Math.max(1e-6, Number(dielectric) || FF_DIELECTRIC);
  /* LA PENTE DE COULOMB, AVEC L'ÉCRANAGE IONIQUE — la dérivée EXACTE de ce que
     `ffCoulombCostOf` rend : sans sel, `−2·q·q/(ε·r³)` (la formule historique, inchangée au
     chiffre près) ; avec sel, `q·q·e^(−κ·r)·(−2/r − κ)/(ε·r²)` — la dérivée de `q·q·e^(−κr)/(εr²)`.
     Un corps rigide d'eau lit CETTE pente : elle ne peut donc pas diverger du prix (le test
     `_water_md_test.mjs` compare les deux, κ = 0 comme κ > 0). */
  const dElec = (!repulsionOnly && electrostatics && pair.cqq)
    ? ((Number(kappa) > 0)
      ? (pair.cqq * ffScreeningOf(kappa, r) * (-2 / r - Number(kappa))) / (eps * r * r)
      : (-2 * pair.cqq) / (eps * r * r * r))
    : 0;
  return dVdw + dElec;
};

/** LE COÛT NON LIÉ D'UN COUPLE, SELON LA FONCTION CIBLE — la SEULE définition de ce
 *  qu'un couple coûte, lue par le champ (`ffNonbondedEnergyOf`) ET par les moteurs de
 *  torsion (`utils/structureCalc.js`). `repulsionOnly` remplace le Lennard-Jones 12-6
 *  par sa seule branche répulsive ; `electrostatics: false` éteint Coulomb (ce que fait
 *  DYANA : pas de charges, l'écrantage est le travail du solvant explicite). */
export const ffNonbondedCostOf = (r, pair, {
  dielectric = FF_DIELECTRIC, repulsionOnly = false, electrostatics = true, kappa = 0,
} = {}) => {
  if (repulsionOnly) return ffRepulsionCostOf(r, pair);
  return ffVdwCostOf(r, pair) + (electrostatics ? ffCoulombCostOf(r, pair, dielectric, kappa) : 0);
};

/* ── LE COÛT D'UN COUPLE SELON LA FONCTION CIBLE — voir `FF_TARGET_FUNCTIONS` plus bas
   (déclarée après les portées du champ, qu'elle cite). */


/* ── 2 · LES COUPLES NON LIÉS — vdW, ÉLECTROSTATIQUE, SURFACE ──────────────────
   Une seule MARCHE rend les couples que le graphe ne lie pas (1-2 et 1-3 sont exclus,
   1-4 est atténué comme dans AMBER), dans une seule portée. Le même couple porte son ε,
   son r_min, son q_i·q_j et de quoi mesurer la surface : un pas de torsion qui le fait
   bouger relit UN terme, jamais trois listes. */

/** LA PORTÉE DES COUPLES NON LIÉS (Å). 8 Å : au-delà, un diélectrique ε(r) = 4·r a
 *  déjà divisé une charge par plus de vingt, et un Lennard-Jones par 10⁶. La portée est
 *  DITE ici, donc elle n'est pas une approximation cachée. */
export const FF_PAIR_LIMIT = 8;
/** La portée de la surface (Å) : r_i + r_j + 2·sonde au maximum, prise large. */
export const FF_SURFACE_LIMIT = 2 * FF_VDW_RADIUS_FALLBACK + 2 * FF_SASA_PROBE;

/* ── 🎯 LES FONCTIONS CIBLES — CE QUE LA MOLÉCULE CHERCHE À MINIMISER ──────────
   La demande de cette session : « if the present plan is correct I wouldn't throw it but
   I would add the option to run as Dyana as well. » Une fonction cible se décrit
   ENTIÈREMENT ici, une fois : le champ (`ffKcalEnergyOf`), les moteurs de torsion
   (`annealFrames`, `mdFrames`, `minimizeFrames`, `torsionEngineOf`) et le panneau lisent
   CETTE liste — aucun d'eux ne peut donc porter un autre jeu de règles que celui affiché,
   et le rapport d'un geste dit lequel il a conduit.
     · `classic` — le champ du dossier, tel quel (aucun réglage ne change : c'est le
       défaut, donc une session enregistrée et un test restent identiques) ;
     · `dyana`   — la fonction cible de DYANA / CYANA : RÉPULSION SEULE (aucune attraction
       de van der Waals, aucune charge), PAS de terme de surface non polaire, ATOMES UNIS
       (aucun hydrogène ajouté : le champ lit le squelette lourd tel qu'il est) et une
       portée de couples plus courte (3.5 Å) — la physique de ces programmes, et le plus
       court chemin vers une dynamique rapide (la surface coûte 91 % d'un pas, mesuré).
       Les familles de géométrie (liaisons, angles, cycles plans), ω, les bassins φ/ψ, χ1
       et VOS DISTANCES restent celles du module : le rapport DIT lesquelles sont éteintes
       au lieu de laisser croire qu'il a changé de programme entier.
   ⚠ DÉCLARÉES ICI, APRÈS LES PORTÉES — `pairLimit` cite `FF_PAIR_LIMIT`, et un `const`
   cité plus haut que sa déclaration est une TDZ : le module entier jetterait. */
export const FF_TARGET_FUNCTION_PAIR_LIMIT = 3.5;
export const FF_TARGET_FUNCTIONS = [
  {
    id: 'classic', label: 'classic · the whole field',
    repulsionOnly: false, electrostatics: true, surface: true,
    pairLimit: FF_PAIR_LIMIT, unitedAtoms: false,
    of: 'bonds, angles, planar rings, van der Waals, charges, non-polar surface, ω, φ/ψ, χ1 and your distances',
    off: [],
  },
  {
    id: 'dyana', label: 'DYANA / CYANA · target function',
    repulsionOnly: true, electrostatics: false, surface: false,
    pairLimit: FF_TARGET_FUNCTION_PAIR_LIMIT, unitedAtoms: true,
    of: 'bonds, angles, planar rings, ω, φ/ψ, χ1 and your distances',
    off: ['the attraction of van der Waals', 'the charges (electrostatics)', 'the non-polar surface',
      'the hydrogens this module adds (united atoms)'],
  },
];
/** LA FONCTION CIBLE DEMANDÉE, TOUJOURS DÉFINIE — un identifiant inconnu rend le modèle
 *  historique (`classic`) : ni un moteur ni le panneau ne peuvent jeter pour un
 *  identifiant qu'ils n'ont pas écrit eux-mêmes. */
export const ffTargetFunctionOf = (id) => FF_TARGET_FUNCTIONS
  .find((t) => t.id === String(id == null ? '' : id))
  || FF_TARGET_FUNCTIONS.find((t) => t.id === 'classic');

/** LA PORTÉE D'UNE MARCHE DE COUPLES NON LIÉS — le rayon réellement employé par
 *  `ffPairListOf` (un nombre manquant ou absurde retombe sur `FF_PAIR_LIMIT`). Un moteur
 *  qui doit lire À LA MAIN un couple hors de la marche (voir `structureCalc.js` : les
 *  couples qu'un PAS vient de créer) prend la portée ICI : la sienne ne peut donc pas
 *  dériver de celle du champ. */
export const ffPairReachOf = (limit) => Math.max(1, Number(limit) || FF_PAIR_LIMIT);

/** LES VOISINS JUSQU'À TROIS LIAISONS D'UNE MOLÉCULE — `{nb1, nb2, nb3}`, trois tableaux de
 *  `Set` : `nb1[i]` les atomes liés à `i` (couple 1-2), `nb2[i]` ceux à deux liaisons (1-3),
 *  `nb3[i]` ceux à trois (1-4). Au-delà, le couple est LIBRE, et c'est lui qui porte la
 *  physique. C'est la topologie qu'emploie `ffPairListOf` ; elle est rendue à part pour
 *  qu'un moteur qui juge un couple HORS de la marche juge la MÊME topologie que la marche
 *  (`structureCalc.js`), au lieu d'en réécrire une seconde. */
export const ffExclusionSetsOf = ({ bonds = [], atomCount = 0 } = {}) => {
  const count = Math.max(0, Math.floor(Number(atomCount) || 0));
  const graph = bondGraphOf({ bonds, atomCount: count });
  const nb1 = []; const nb2 = []; const nb3 = [];
  for (let i = 0; i < count; i += 1) nb1.push(new Set(graph.neighbours(i)));
  for (let i = 0; i < count; i += 1) {
    const two = new Set();
    for (const k of nb1[i]) for (const m of nb1[k]) if (m !== i && !nb1[i].has(m)) two.add(m);
    nb2.push(two);
  }
  for (let i = 0; i < count; i += 1) {
    const three = new Set();
    for (const k of nb1[i]) for (const m of nb1[k]) for (const n of nb1[m]) {
      if (n !== i && !nb1[i].has(n) && !nb2[i].has(n)) three.add(n);
    }
    nb3.push(three);
  }
  return { nb1, nb2, nb3 };
};

/** LE COUPLE NON LIÉ DE DEUX ATOMES, À UN ORDRE TOPOLOGIQUE DONNÉ — le MÊME constructeur
 *  que la marche (`ffPairListOf`), donc un moteur qui lit un couple à la main obtient
 *  exactement le couple du champ : `fourth: true` atténue un 1-4 (voir
 *  `FF_VDW_FOURTH_SCALE` / `FF_ELEC_FOURTH_SCALE`), `false` lit un couple libre. */
export const ffPairOf = (i, j, elements, charges, fourth = false) => ffNonbondedOf(
  i, j, elements, charges,
  fourth ? { lj: FF_VDW_FOURTH_SCALE, elec: FF_ELEC_FOURTH_SCALE } : {},
);


/** LES COUPLES NON LIÉS D'UNE GÉOMÉTRIE — `{ok, reason, pairs, count, topology,
 *  unknown, limit}`. `pairs[k]` = `{i, j, rmin, epsilon, charges, cqq, topological,
 *  known}` ; `topological` = 3 pour un couple 1-4 (atténué), 0 sinon. `topology` compte
 *  `{bonded, linked, fourth, free}` — un rapport qui ne cache pas ce qu'il a écarté. */
export const ffPairListOf = ({
  positions = null, elements = [], bonds = [], charges = null, limit = FF_PAIR_LIMIT,
  /* ⚠ LA LISTE DE SURFACE EST UN COÛT, PAS UNE OBLIGATION — elle porte TOUS les couples de
     la portée (1-2 et 1-3 compris) et c'est elle qui enterre un atome. Une fonction cible
     sans terme non polaire (DYANA, voir `FF_TARGET_FUNCTIONS`) n'en a aucun besoin : elle
     est alors vide AU LIEU d'être calculée puis jetée — c'est la moitié du travail d'un pas
     de dynamique qui disparaît, mesuré (voir le rapport de la sonde de performance). Le
     défaut reste `true` : la liste historique ne change pas d'un chiffre. */
  surface = true,
} = {}) => {
  const read = flatPositions(positions);
  const els = Array.from(elements || []);
  const count = read ? read.count : els.length;
  const out = {
    ok: false, reason: 'bad-points', pairs: [], surface: [], count: 0,
    topology: { bonded: 0, linked: 0, fourth: 0, free: 0 }, unknown: 0, limit,
  };
  if (!read || !count) return out;
  const x = read.flat;
  const reach = ffPairReachOf(limit);
  const doSurface = surface !== false;
  /* LES VOISINS JUSQU'À TROIS LIAISONS — la topologie d'un couple, une fois pour toutes,
     lue par la fonction du CHAMP (`ffExclusionSetsOf`) : un moteur qui juge un couple HORS
     de la marche emploie donc la même. Au-delà c'est un couple LIBRE, et c'est lui qui
     porte la physique. */
  const { nb1, nb2, nb3 } = ffExclusionSetsOf({ bonds, atomCount: count });
  const cell = (v) => Math.floor(v / reach);
  const key = (a, b, c) => `${a},${b},${c}`;
  const grid = new Map();
  for (let i = 0; i < count; i += 1) {
    const k = key(cell(x[i * 3]), cell(x[i * 3 + 1]), cell(x[i * 3 + 2]));
    const bucket = grid.get(k);
    if (bucket) bucket.push(i); else grid.set(k, [i]);
  }
  for (let i = 0; i < count; i += 1) {
    const cx = cell(x[i * 3]); const cy = cell(x[i * 3 + 1]); const cz = cell(x[i * 3 + 2]);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          const bucket = grid.get(key(cx + dx, cy + dy, cz + dz));
          if (!bucket) continue;
          for (const j of bucket) {
            if (j <= i) continue;
            const d = Math.hypot(
              x[i * 3] - x[j * 3], x[i * 3 + 1] - x[j * 3 + 1], x[i * 3 + 2] - x[j * 3 + 2],
            );
            /* ⚠ PLUS DE COUPLE RETIRÉ PARCE QU'IL EST TROP COURT (le défaut rapporté :
               « atoms can come too close and the LJ potential is not considered »). Un
               couple plus court que `FF_VDW_SAME_ATOM` RESTE dans la liste et la somme le
               lit au plancher, avec la rampe (`ffVdwCostOf`) : c'est ce qui fait qu'un
               empilement coûte au lieu de s'effacer de la physique. Seule la portée
               (`reach`) écarte un couple. */
            if (!(d <= reach)) continue;
            /* ⚠ LA SURFACE A BESOIN DES COUPLES 1-2 ET 1-3 — ce sont EUX qui enterrent
               un atome (une liaison à 1.09 Å masque la moitié de la sphère d'un H), et
               le terme de van der Waals les exclut. La liste de surface est donc
               gardée à part, et elle porte TOUS les couples de la portée. */
            if (doSurface) out.surface.push({ i, j });
            if (nb1[i].has(j)) { out.topology.bonded += 1; continue; }
            if (nb2[i].has(j)) { out.topology.linked += 1; continue; }
            const fourth = nb3[i].has(j);
            if (fourth) out.topology.fourth += 1; else out.topology.free += 1;
            const pair = ffPairOf(i, j, els, charges, fourth);
            if (!pair.known) out.unknown += 1;
            out.pairs.push(pair);
          }
        }
      }
    }
  }
  out.ok = true; out.reason = 'ok'; out.count = out.pairs.length;
  return out;
};

/** L'ÉNERGIE DES COUPLES NON LIÉS — `{vdw, elec, count, repulsive, worstVdw,
 *  worstElec}` (kcal/mol). `repulsive` compte les couples dont le LJ est positif (deux
 *  atomes qui se traversent) : c'est le chiffre que le panneau nomme « clashes », et il
 *  vient du MÊME terme que l'énergie au lieu d'un compteur à part. */
export const ffNonbondedEnergyOf = (pairs, positions, {
  dielectric = FF_DIELECTRIC, repulsionOnly = false, electrostatics = true, kappa = 0,
} = {}) => {
  const out = { vdw: 0, elec: 0, count: 0, repulsive: 0, worstVdw: null, worstElec: null };
  const read = flatPositions(positions);
  if (!read || !Array.isArray(pairs)) return out;
  const x = read.flat;
  for (const p of pairs) {
    const d = Math.hypot(
      x[p.i * 3] - x[p.j * 3], x[p.i * 3 + 1] - x[p.j * 3 + 1], x[p.i * 3 + 2] - x[p.j * 3 + 2],
    );
    /* ⚠ AUCUN COUPLE N'EST SAUTÉ PARCE QU'IL EST TROP COURT : la somme lit un couple
       empilé au plancher (voir `ffVdwCostOf`) et le COMPTE — sans quoi le rapport d'une
       molécule où deux atomes se traversent aurait l'air d'une molécule propre. */
    if (!Number.isFinite(d)) continue;
    out.count += 1;
    /* ⚠ LA FAMILLE EST CELLE DE LA FONCTION CIBLE (`ffNonbondedCostOf`) : en mode DYANA
       il n'y a NI puits attractif NI charge, donc `vdw` ne porte que la répulsion et
       `elec` reste à zéro — le rapport dit la vérité de ce qu'il a sommé. */
    const v = repulsionOnly
      ? ffRepulsionCostOf(d, p)
      : ffVdwCostOf(d, p);
    const e = repulsionOnly || !electrostatics ? 0 : ffCoulombCostOf(d, p, dielectric, kappa);
    out.vdw += v;
    out.elec += e;
    if (v > 0) out.repulsive += 1;
    if (repulsionOnly) out.repulsionOnly = true;
    if (!out.worstVdw || Math.abs(v) > Math.abs(out.worstVdw.energy)) {
      out.worstVdw = { i: p.i, j: p.j, distance: d, rmin: p.rmin, energy: v };
    }
    if (!out.worstElec || Math.abs(e) > Math.abs(out.worstElec.energy || 0)) {
      out.worstElec = { i: p.i, j: p.j, distance: d, charges: p.charges, energy: e };
    }
  }
  return out;
};

/* ── 3 · LES FAMILLES, EN FONCTIONS PURES D'UN ÉCART ───────────────────────────
   La dynamique, le recuit et la minimisation appellent CES fonctions : un seul endroit
   définit ce que coûte un écart, donc aucun moteur ne peut minimiser autre chose que
   ce que le score juge. */

/** La liaison — k·(d − d₀)², k en kcal·mol⁻¹·Å⁻². */
export const ffBondCostOf = (d, target, k = FF_BOND_K) => {
  const dev = Number(d) - Number(target);
  return Number.isFinite(dev) ? k * dev * dev : 0;
};
/** L'angle — k·(θ − θ₀)², les deux en degrés, k en kcal·mol⁻¹·rad⁻². */
export const ffAngleCostOf = (deg, target, k = FF_ANGLE_K) => {
  const dev = (Number(deg) - Number(target)) * (Math.PI / 180);
  return Number.isFinite(dev) ? k * dev * dev : 0;
};
/** Le cycle plan — même forme que l'angle, δ en degrés. */
export const ffPlanarCostOf = (deg, target = 0, k = FF_PLANAR_K) => ffAngleCostOf(deg, target, k);

/** LA CONTRAINTE — le puits plat du calcul de structure : rien dans la tolérance,
 *  k·(écart − tolérance)² au-delà. C'est la forme de tous les programmes de calcul de
 *  structure (XPLOR/CNS, CYANA) et elle est écrite ici UNE fois. */
export const ffRestraintCostOf = (d, { target, tolerance = FF_RESTRAINT_TOLERANCE } = {}, k = FF_NOE_K) => {
  const dev = Math.abs(Number(d) - Number(target)) - Math.max(0, Number(tolerance) || 0);
  return dev > 0 && Number.isFinite(dev) ? k * dev * dev : 0;
};

/** LE POIDS D'UNE LIGNE DE LA TABLE DES DISTANCES — le facteur que la colonne ⚖ du
 *  panneau 🧬 écrit, et que les gestes du champ (▶ MD, ⚒ Minimise, ▶ Run) lisent.
 *
 *  Il MULTIPLIE la raideur : `k = FF_NOE_K × poids`. Un poids de 2 rend la ligne deux
 *  fois plus chère qu'une autre dépassée du même écart ; un poids de 0.5 l'adoucit ;
 *  un poids de 0 la rend INERTE — elle ne pèse RIEN dans le champ (le moteur et la
 *  note l'ignorent) même si elle est encore affichée et mesurée par la table.
 *
 *  ⚠ CE QUI N'EST PAS UN POIDS — un poids ABSENT, illisible, négatif ou NaN vaut 1 :
 *  c'est le chiffre historique, donc une table sans poids se comporte EXACTEMENT comme
 *  avant, et une frappe à moitié tapée ne peut pas rendre un calcul fou. Le module ne
 *  borne pas le haut : 100 est permis (une ligne qui doit passer avant tout le reste),
 *  et c'est le rapport (`weight`, `k` par ligne) qui dit ce qui a été lu. */
export const ffRestraintWeightOf = (weight) => {
  /* ⚠ `false` N'EST PAS UN POIDS DE 0 — un booléen est « pas de poids donné », pas une
     mise en pause : sans ce garde, `Number(false)` vaut 0 et une case à cocher ferait
     disparaître une contrainte du champ. */
  if (typeof weight === 'boolean' || weight == null || weight === '') return 1;
  const w = Number(weight);
  return Number.isFinite(w) && w >= 0 ? w : 1;
};

/** LA RAIDEUR D'UNE LIGNE — `FF_NOE_K` multiplié par son poids ⚖ (une seule
 *  définition : le champ et le moteur de torsion ne peuvent pas lire deux chiffres
 *  différents pour la même ligne). */
export const ffRestraintKOf = (weight) => FF_NOE_K * ffRestraintWeightOf(weight);

/** ω — LA BARRIÈRE TRANS, À SENS UNIQUE : nulle à moins de la tolérance de 180°, puis
 *  STRICTEMENT CROISSANTE — elle ne redescend JAMAIS. Le point opposé à trans (le ω cis,
 *  à 180°) paie TOUT k : c'est ce que fixe la normalisation par `1 − cos(180° − tolérance)`.
 *
 *  ⚠ UN cos 2 AURAIT UN SECOND MINIMUM, ET C'EST CELUI QUI A CASSÉ L'HÉLICE DE LA PAGE. Sa
 *  valeur au cis vaut k/4 = 5 kcal/mol — MOINS que le sommet de sa propre barrière (20
 *  kcal/mol, à 120° de trans) : le cis était donc un PUITS, pas un mur. Or les quatre
 *  moteurs qui protègent ω (recuit, trempe, dynamique, minimisation) ne gardent qu'un pas
 *  qui NE MONTE PAS son coût : y descendre était permis, en ressortir refusé. MESURÉ sur
 *  l'hélice (12 résidus, protocole entier) : le tirage des dièdres pose les 11 ω
 *  uniformément dans (−180, 180); 2 tombent du côté cis (144.6° et 152.1°), et ces 2 liens
 *  finissaient à 180.0° EXACTEMENT après le protocole complet — 10.01 kcal/mol de barrière
 *  payés pour rien, les ponts i→i+4 des deux bouts à 5.98 et 5.42 Å au lieu de 3.09.
 *  Un terme monotone fait au contraire REVENIR tout ω tiré de travers : chaque degré
 *  parcouru va vers trans, donc un pas accepté ne peut que rapprocher de la fenêtre. */
export const ffOmegaCostOf = (deg, {
  target = FF_OMEGA_TARGET, tolerance = FF_OMEGA_TOLERANCE, k = FF_OMEGA_K,
} = {}) => {
  const d = Number(deg);
  if (!Number.isFinite(d)) return 0;
  /* LA FENÊTRE EST BORNÉE À [0°, 180°] : au-delà il n'y a plus de cercle, et un chiffre
     illisible redonne le plateau entier — le terme ne rend jamais un NaN. */
  const tol = Math.max(0, Math.min(Number(tolerance) || 0, 180));
  const dev = Math.abs(((d - Number(target) + 540) % 360) - 180);   // écart réel, 0..180
  if (!Number.isFinite(dev) || dev <= tol) return 0;
  const over = (dev - tol) * (Math.PI / 180);
  /* LE DÉNOMINATEUR EST LA VALEUR À L'OPPOSÉ DE TRANS (dev = 180°, le cis) : le terme y
     vaut EXACTEMENT k, et il y monte sans jamais redescendre (`1 − cos` est croissant sur
     (0°, 180°]). Une tolérance de 180° est déjà sortie plus haut : jamais de division par
     zéro, et le terme tend vers k quand la fenêtre s'ouvre sur tout le cercle. */
  const far = 1 - Math.cos((180 - tol) * (Math.PI / 180));
  return far > 0 ? (k * (1 - Math.cos(over))) / far : 0;
};

/** ⛓ LA CONTRAINTE DE DIHÈDRE ISSUE DE LA STRUCTURE SECONDAIRE IMPOSÉE — LE PUITS
 *  PLAT des distances, transposé aux degrés : zéro tant que l'angle est dans la
 *  fenêtre `target ± tolerance`, puis k·(écart − tolérance)². C'est la forme de
 *  toutes les contraintes de dièdre d'un calcul de structure (XPLOR/CNS, CYANA),
 *  écrite ici UNE fois, comme celle des distances — le recuit, la dynamique et la
 *  minimisation relisent CE puits, donc aucun moteur ne minimise autre chose que ce
 *  que la note juge. L'écart est le plus court sur le cercle : une cible de −57° et
 *  un angle de +300° sont à zéro.
 *
 *  `centreK` AJOUTE LE FOND DU PUITS (voir `FF_DIHEDRAL_CENTRE_K`) : kc·(écart)² tant
 *  que l'angle est DANS la fenêtre, borné à kc·tolérance² — deux quadratiques dans le
 *  même écart, dont la somme est convexe et ne se creuse qu'à la cible. Sans `centreK`
 *  (le défaut, 0), c'est le puits plat, au chiffre près. */
export const ffDihedralCostOf = (deg, {
  target = 0, tolerance = FF_DIHEDRAL_TOLERANCE, k = FF_DIHEDRAL_K, centreK = 0,
} = {}) => {
  const d = Number(deg);
  if (!Number.isFinite(d)) return 0;
  const tol = Math.max(0, Number(tolerance) || 0);
  const dev = Math.abs(((d - Number(target) + 540) % 360) - 180);
  if (!Number.isFinite(dev)) return 0;
  const kc = Number(centreK);
  /* LE FOND — nul si le chiffre est absent, illisible ou négatif : une contrainte sans
     centre reste le puits plat, et un centre négatif ne peut pas CREUSER sous zéro. */
  const floor = Number.isFinite(kc) && kc > 0 ? kc * Math.min(dev, tol) ** 2 : 0;
  const over = dev - tol;
  return (over > 0 ? k * over * over : 0) + floor;
};

/** χ1 — les trois conformères décalés : 1 + cos 3χ s'annule sur 60°, 180° et −60°. */
export const ffChiCostOf = (deg, k = FF_CHI_K) => {
  const d = Number(deg);
  return Number.isFinite(d) ? k * (1 + Math.cos(3 * d * (Math.PI / 180))) / 2 : 0;
};

/** LE POTENTIEL STATISTIQUE DU SQUELETTE — k·(écart au bassin/100°)², l'écart étant
 *  celui que `ramaGapOf` mesure sur LES POLYGONES DU GRAPHE 🪢 : zéro dedans, et une
 *  pénalité quadratique en dehors, en kcal/mol. */
export const ffRamaCostOf = (gapDeg, k = FF_RAMA_K) => {
  const g = Number(gapDeg);
  return Number.isFinite(g) && g > 0 ? k * (g / FF_RAMA_SPAN) ** 2 : 0;
};


/* ── 4 · LES CHARGES PARTIELLES — PEOE, PUIS LA CHARGE FORMELLE DE LA CHIMIE ─── */

/** LES PARAMÈTRES PEOE DE GASTEIGER–MARSILI — χ(q) = a + b·q + c·q². Ils sont publiés
 *  (Tetrahedron 36 (1980) 3219) et ils valent pour tout élément de la chimie organique :
 *  c'est justement pourquoi ce modèle est employé ici — l'application n'a AUCUNE
 *  bibliothèque de paramètres, et une estimation DITE vaut mieux qu'un chiffre inventé. */
export const FF_PEOE = {
  H: { a: 7.17, b: 6.24, c: -0.56 }, D: { a: 7.17, b: 6.24, c: -0.56 },
  C: { a: 7.98, b: 9.18, c: 1.88 }, N: { a: 11.54, b: 10.82, c: 1.36 },
  O: { a: 14.18, b: 14.66, c: 2.24 }, F: { a: 14.66, b: 13.85, c: 2.31 },
  S: { a: 10.14, b: 9.13, c: 1.38 }, CL: { a: 11, b: 9.69, c: 1.35 },
  BR: { a: 10.08, b: 8.47, c: 1.16 }, I: { a: 9.9, b: 7.96, c: 0.96 },
  P: { a: 8.9, b: 8.24, c: 1.62 }, B: { a: 6.3, b: 5.1, c: 0.6 },
  SI: { a: 7.3, b: 7.2, c: 1.0 }, SE: { a: 9.7, b: 8.7, c: 1.3 },
};
/** Ce qu'un élément inconnu prend : une électro-négativité moyenne, donc des charges
 *  petites — le module ne fabrique pas un ion avec un élément qu'il ne connaît pas. */
export const FF_PEOE_FALLBACK = { a: 8.0, b: 8.0, c: 1.0 };
/** Combien d'itérations d'égalisation, et la fraction transférée à chacune (α = 0.5,
 *  comme dans la publication : au-delà de 12 itérations la charge ne bouge plus au
 *  1/1000, et un calcul de structure n'a pas besoin de mieux). */
export const FF_PEOE_ITERATIONS = 12;
export const FF_PEOE_DAMPING = 0.5;

/** LA CHARGE D'UN ATOME À UN ÉTAT DONNÉ — χ(q), la fonction de la publication. */
const peoeChi = (p, q) => p.a + p.b * q + p.c * q * q;
/** UNE ITÉRATION D'ÉGALISATION — chaque liaison transfère le long de son gradient. */
const peoeStep = (q, graph, params) => {
  const delta = new Float64Array(q.length);
  for (const { i, j } of graph.list) {
    const pi = params[i]; const pj = params[j];
    if (!pi || !pj) continue;
    const ci = peoeChi(pi, q[i]); const cj = peoeChi(pj, q[j]);
    /* LA DURETÉ EST UNE SOMME, PAS UNE DIFFÉRENCE — c'est η_i + η_j du modèle, et
       l'oublier fait DIVERGER l'itération (mesuré : 1e5 de charge au premier pas quand
       un atome dur est lié à un atome mou). Le gradient 2c·q est pris en valeur absolue :
       il ne peut qu'augmenter la dureté, jamais l'annuler. */
    const eta = Math.abs(pi.b) + Math.abs(pj.b)
      + 2 * (Math.abs(pj.c * q[j]) + Math.abs(pi.c * q[i]));
    const dq = FF_PEOE_DAMPING * (cj - ci) / Math.max(1e-6, eta);
    delta[i] += dq; delta[j] -= dq;
  }
  for (let k = 0; k < q.length; k += 1) q[k] += delta[k] * 0.5;
};

/** LES GROUPES IONISABLES QUE LE GRAPHE MONTRE — carboxylate, guanidinium, ammonium
 *  (y compris un N-terminal à trois H), thiolate, phosphate. Rien d'autre n'est deviné :
 *  un imidazole reste neutre, une histidine protonée serait un choix que le fichier ne
 *  dit pas. `{name, charge, atoms, spread}` par groupe. */
export const ffFormalGroupsOf = ({ elements = [], graph = null } = {}) => {
  const els = Array.from(elements || []);
  if (!graph) return [];
  const out = [];
  const nbs = (k) => graph.neighbours(k);
  const isEl = (k, e) => upper(els[k]) === e;
  const hCount = (k) => nbs(k).filter((m) => isEl(m, 'H') || isEl(m, 'D')).length;
  for (let k = 0; k < els.length; k += 1) {
    /* CARBOXYLATE — un carbone à deux oxygènes dont l'un n'a pas d'hydrogène : la
       fonction a perdu son proton, donc −0.5 sur chacun des deux oxygènes. */
    if (isEl(k, 'C')) {
      const oxygens = nbs(k).filter((m) => isEl(m, 'O'));
      if (oxygens.length === 2 && !oxygens.some((m) => hCount(m) > 0)) {
        out.push({ name: 'carboxylate', charge: -1, atoms: oxygens, spread: -0.5 });
      }
      /* GUANIDINIUM — le carbone de l'arginine porte trois azotes : +1 sur les N. */
      const nitrogens = nbs(k).filter((m) => isEl(m, 'N'));
      if (nitrogens.length === 3 && nbs(k).length === 3) {
        out.push({ name: 'guanidinium', charge: 1, atoms: nitrogens, spread: 1 / 3 });
      }
    }
    /* PHOSPHATE — un phosphore à quatre oxygènes dont deux au moins sont terminaux. */
    if (isEl(k, 'P')) {
      const oxygens = nbs(k).filter((m) => isEl(m, 'O'));
      const terminal = oxygens.filter((m) => nbs(m).length === 1);
      if (oxygens.length >= 4 && terminal.length >= 2) {
        out.push({ name: 'phosphate', charge: -2, atoms: terminal, spread: -2 / terminal.length });
      }
    }
    /* AMMONIUM — un azote à quatre liaisons, ou une amine à trois hydrogènes (le
       N-terminal d'un peptide, tel que les fichiers le donnent). */
    if (isEl(k, 'N')) {
      const heavy = nbs(k).filter((m) => !isEl(m, 'H') && !isEl(m, 'D'));
      const h = hCount(k);
      if (heavy.length + h >= 4 && h >= 1) {
        out.push({ name: 'ammonium', charge: 1, atoms: [k], spread: 1 });
      }
    }
    /* THIOLATE — un soufre sans hydrogène et à un seul voisin : l'anion du cysteine. */
    if ((isEl(k, 'S') || isEl(k, 'SE')) && nbs(k).length === 1 && hCount(k) === 0) {
      out.push({ name: 'thiolate', charge: -1, atoms: [k], spread: -1 });
    }
  }
  return out;
};

/* ── 4bis · LE pH — CE QUE LA MOLÉCULE PORTE VRAIMENT À CE pH-LÀ ───────────────
   LA DEMANDE : « In MD and “structure calculation” allow to define the pH and ionic strength so
   that the molecule can be protonated or deprotonated and charge can be taken into
   consideration. » La force ionique est réglée plus haut (§2bis, l'écrantage) ; ici c'est la
   CHARGE elle-même qui suit le pH.
   Le graphe de la molécule dit quels GROUPES IONISABLES elle porte — carboxylate, phosphate,
   thiolate, ammonium, guanidinium : c'est la lecture de `ffFormalGroupsOf`, celle qui distribuait
   déjà la charge formelle de la chimie. Ce que le pH change, c'est son DEGRÉ D'IONISATION, par
   Henderson–Hasselbalch :
     · un ACIDE (carboxylate, phosphate, thiolate) est NEUTRE à pH bas et CHARGÉ à pH haut :
       α = 1/(1+10^(pKa−pH)) ;
     · une BASE (ammonium, guanidinium) est CHARGÉE à pH bas et NEUTRE à pH haut :
       α = 1/(1+10^(pH−pKa)) ;
   et la charge du groupe est multipliée par α (le carboxylate passe donc de −0.5 par oxygène à
   pH 7 à presque 0 à pH 2 : la molécule EST protonée, la charge est prise en compte).
   ⚠⚠ LE pKa EST UNE VALEUR MOYENNE PAR FAMILLE, ÉCRITE ICI ET NULLE PART AILLEURS — un fichier
   ne dit pas son pKa, et ce module ne le devine pas : ce qu'il ne sait pas, il le DIT (le rapport
   du champ rend `pka` et le nom de chaque groupe). ⚠ ET L'IMIDAZOLE D'UNE HISTIDINE N'EST PAS un
   groupe de ce graphe : à tout pH elle reste ce que le graphe montre, exactement comme le
   module le disait déjà de la charge formelle.
   ⚠⚠ `ph == null` (LE DÉFAUT) VEUT DIRE « la chimie que le graphe montre » : α = 1 pour tout le
   monde, donc les charges d'avant cette section, au chiffre près — aucun test, aucune session
   enregistrée ne bouge tant que personne ne donne un pH. */
export const FF_PKA = {
  carboxylate: 3.9,    // Asp 3.9 · Glu 4.1 · C-terminal 3.1 → la moyenne de la famille
  phosphate: 6.8,      // un phosphate d'acide nucléique, une phosphosérine
  thiolate: 8.3,       // la cysteine
  ammonium: 9.0,       // Lys 10.5 · N-terminal ≈ 8 → la moyenne de la famille
  guanidinium: 12.5,   // l'arginine
};
/** LES FAMILLES ACIDES — celles qui sont CHARGÉES à pH HAUT (l'autre forme de la formule). */
export const FF_PKA_ACIDS = ['carboxylate', 'phosphate', 'thiolate'];
/** LE pH PAR DÉFAUT — `null` : aucune titration, la chimie telle que le graphe la montre
 *  (`α = 1`). C'est le chiffre qui garantit qu'une session sans pH garde sa physique. */
export const FF_PH_DEFAULT = null;
/** LE DEGRÉ D'IONISATION D'UN GROUPE À UN pH — `1` quand le pH ou le pKa manque (le défaut
 *  honnête : on ne change pas la charge d'un groupe dont on ne sait rien). */
export const ffIonisationOf = (group = {}, ph = FF_PH_DEFAULT) => {
  const name = String((group && group.name) || '');
  const pka = FF_PKA[name];
  /* ⚠ `Number(null)` VAUT 0 — un pH absent serait donc lu « pH 0 » et déprotonerait tout. La
     lecture commence donc par refuser le vide : `null`, `undefined` et `''` valent « pas de
     pH », c'est-à-dire le facteur 1. */
  if (ph == null || ph === '') return 1;
  const value = Number(ph);
  if (!Number.isFinite(value) || !Number.isFinite(pka)) return 1;
  const d = FF_PKA_ACIDS.includes(name) ? pka - value : value - pka;
  return 1 / (1 + (10 ** d));
};
/** LA LECTURE COMPLÈTE — `{ph, factors, groups, ionised, net, atWork}` : le facteur de chaque
 *  groupe (dans l'ordre de `ffFormalGroupsOf`), sa charge à ce pH, la charge que les groupes
 *  ionisables apportent, et si le pH a VRAIMENT fait quelque chose (le rapport du geste s'en
 *  sert pour dire « lu » au lieu de laisser croire à un réglage oublié). */
export const ffIonisationReportOf = ({ groups = [], ph = FF_PH_DEFAULT } = {}) => {
  /* ⚠ `Number(null)` VAUT 0 : `listed` se demande AVANT toute conversion (voir
     `ffIonisationOf`) — sinon un pH absent serait rapporté « pH 0 ». */
  const listed = !(ph == null || ph === '') && Number.isFinite(Number(ph));
  const value = listed ? Number(ph) : NaN;
  const factors = [];
  const rows = [];
  let net = 0;
  (Array.isArray(groups) ? groups : []).forEach((g) => {
    const raw = ffIonisationOf(g, ph);
    /* ⚠ LA FORME ACIDE N'EST TITRÉE QUE SI UN pH EST DONNÉ (voir `ffIonisableGroupsOf`) :
       sans pH, un carboxyle ou un thiol reste NEUTRE — le facteur 0 est donc ce qui GARDE le
       champ d'origine quand personne n'a rien demandé. Dès qu'un pH est donné, c'est le facteur
       de Henderson–Hasselbalch qui s'applique, comme pour la forme ionisée. */
    const factor = (listed || (g && g.form !== 'acid')) ? raw : 0;
    factors.push(factor);
    const charge = Number(g && g.spread) * factor;
    net += charge * (Array.isArray(g && g.atoms) ? g.atoms.length : 1);
    rows.push({
      name: String((g && g.name) || ''), pka: FF_PKA[String((g && g.name) || '')] ?? null,
      form: String((g && g.form) || 'ionised'), factor: Number(factor.toFixed(6)),
      charge: Number(charge.toFixed(6)), raw: Number(raw.toFixed(6)),
    });
  });
  return {
    ph: listed ? Number(value.toFixed(4)) : null,
    listed,
    factors, groups: rows,
    ionised: rows.filter((r) => r.factor > 1e-6).length,
    net: Number(net.toFixed(6)),
    atWork: listed && rows.some((r) => (r.form === 'acid'
      ? r.factor > 1e-9            // une forme ACIDE que le pH a chargée (elle est neutre par défaut)
      : r.factor < 1 - 1e-9)),     // une forme IONISÉE que le pH a déchargée (elle est chargée par défaut)
  };
};

/** LES GROUPES QUE LE pH PEUT TITRER — la réunion de ce que le graphe reconnaît DÉJÀ
 *  (`ffFormalGroupsOf` : les formes CHARGÉES de la chimie) et des formes ACIDES que ce premier
 *  lecteur ne voit pas parce qu'elles portent encore leur proton : un CARBOXYLE (un carbone à
 *  deux oxygènes dont l'un porte un H) et un THIOL (un soufre à un voisin et un H).
 *
 *  ⚠ POURQUOI LA SECONDE LECTURE EST INDISPENSABLE — un modèle bâti par l'application est un
 *  SQUELETTE LOURD : le module d'hydrogénation (`hydrogenatedOf`) y replace les H des fonctions,
 *  donc la fonction acide d'un résidu Asp/Glu est un COOH, et le lecteur des formes chargées
 *  n'y trouve AUCUN carboxylate (mesuré). Sans cette seconde lecture, un Asp resterait NEUTRE à
 *  tout pH, et donner un pH ne changerait rien à la charge de la molécule — exactement ce que la
 *  demande de cette session veut corriger (« so that the molecule can be protonated or
 *  deprotonated »). Avec elle, les deux formes d'une même fonction sont titrées par le MÊME pKa
 *  (`FF_PKA`), donc un carboxylate et un carboxyle ne peuvent pas diverger.
 *
 *  ⚠ CE QUE LA TITRATION CHANGE, ET CE QU'ELLE NE CHANGE PAS — elle change la CHARGE (le
 *  déplacement des électrons), pas la GÉOMÉTRIE : ce moteur tourne des dièdres, il ne retire ni
 *  ne pose un atome, donc l'hydrogène que le modèle a placé reste où la géométrie le met. C'est
 *  la même convention que la charge formelle de la chimie, qui n'a jamais déplacé un H non plus.
 *
 *  ⚠ ET LA FORME ACIDE N'EST TITRÉE QUE SI UN pH EST DONNÉ (voir `ffIonisationReportOf`) : sans
 *  pH — « la chimie que le graphe montre » — elle reste NEUTRE, exactement ce que ce module
 *  faisait avant cette section. Donner un pH est donc le geste qui dit « compte les charges de
 *  cette solution-là » ; ne rien donner laisse le champ d'origine, au chiffre près. */
export const ffIonisableGroupsOf = ({ elements = [], graph = null } = {}) => {
  const els = Array.from(elements || []);
  if (!graph) return [];
  const out = ffFormalGroupsOf({ elements: els, graph }).map((g) => ({ ...g, form: 'ionised' }));
  const spoken = new Set();
  out.forEach((g) => (g.atoms || []).forEach((k) => spoken.add(k)));
  const nbs = (k) => graph.neighbours(k);
  const isEl = (k, e) => upper(els[k]) === e;
  const hCount = (k) => nbs(k).filter((m) => isEl(m, 'H') || isEl(m, 'D')).length;
  for (let k = 0; k < els.length; k += 1) {
    /* CARBOXYLE — le carbone porte DEUX oxygènes et l'un des deux a encore son proton. */
    if (isEl(k, 'C')) {
      const oxygens = nbs(k).filter((m) => isEl(m, 'O'));
      if (oxygens.length === 2 && oxygens.some((m) => hCount(m) > 0)
        && !oxygens.some((m) => spoken.has(m))) {
        out.push({ name: 'carboxylate', charge: -1, atoms: oxygens, spread: -0.5, form: 'acid' });
        oxygens.forEach((m) => spoken.add(m));
      }
    }
    /* THIOL — le soufre du cysteine réduit : un voisin lourd et son hydrogène. */
    if ((isEl(k, 'S') || isEl(k, 'SE')) && nbs(k).length === 2 && hCount(k) === 1 && !spoken.has(k)) {
      out.push({ name: 'thiolate', charge: -1, atoms: [k], spread: -1, form: 'acid' });
      spoken.add(k);
    }
  }
  return out;
};

/** LES CHARGES PARTIELLES D'UNE MOLÉCULE — `{ok, reason, charges, net, method,
 *  iterations, groups, unknown, min, max}`. Les charges sont en unités de charge
 *  élémentaire (e) ; leur somme est la charge NETTE de la molécule (nulle pour une
 *  molécule neutre — un test le vérifie sur un peptide) ; et rien n'est caché : `method`
 *  vaut `peoe`, `peoe+formal` (des groupes ionisables ont été reconnus) ou `zero`
 *  (aucune liaison lisible : le module ne charge pas des atomes isolés). */
export const partialChargesOf = ({ elements = [], bonds = [], atomCount = 0, ph = FF_PH_DEFAULT } = {}) => {
  const els = Array.from(elements || []);
  const count = els.length || Math.max(0, Math.round(Number(atomCount) || 0));
  const out = {
    ok: false, reason: 'no-graph', charges: new Float64Array(Math.max(0, count)), net: 0,
    method: 'zero', iterations: 0, groups: [], unknown: 0, min: 0, max: 0,
    /* 💧 LE COMPTE DES EAUX EXPLICITES — posé même quand la molécule n'a aucun graphe
       lisible, pour que `method` et le rapport ne dépendent jamais d'un chemin de sortie. */
    waters: ffWatersIn(els),
    /* 🧪 LE pH — LU, ET DIT : `ph` nul veut dire « la chimie que le graphe montre » (§4bis), et
       `ionisation` porte le détail (le pKa et le facteur de chaque groupe). */
    ph: null, ionisation: ffIonisationReportOf({ groups: [], ph }), ionisable: [],
  };
  if (!count) return out;
  const graph = bondGraphOf({ bonds, atomCount: count });
  if (!graph.list.length) { out.ok = true; out.reason = 'ok'; return out; }
  const params = els.map((e) => FF_PEOE[upper(e)] || FF_PEOE_FALLBACK);
  out.unknown = els.filter((e) => !FF_PEOE[upper(e)]).length;
  const q = new Float64Array(count);
  for (let it = 0; it < FF_PEOE_ITERATIONS; it += 1) peoeStep(q, graph, params);
  const groups = ffFormalGroupsOf({ elements: els, graph });
  /* 🧪 LA CHARGE SUIT LE pH (§4bis) — le graphe dit QUELLES fonctions sont ionisables
     (`ffIonisableGroupsOf` : les formes chargées ET les formes acides qu'un squelette
     hydrogéné porte), le pH dit À QUEL POINT elles le sont : la charge de chaque groupe est
     multipliée par son degré d'ionisation. Sans pH (`null`), les formes ionisées gardent leur
     facteur 1 et les formes acides le leur (0) : cette boucle est alors, au chiffre près,
     celle d'avant cette section. */
  const ionisable = ffIonisableGroupsOf({ elements: els, graph });
  const ionisation = ffIonisationReportOf({ groups: ionisable, ph });
  for (let g = 0; g < ionisable.length; g += 1) {
    const spread = Number(ionisable[g].spread) * ionisation.factors[g];
    for (const k of ionisable[g].atoms) q[k] += spread;
  }
  /* 💧 LES EAUX EXPLICITES PORTENT LEURS CHARGES FIXES (TIP3P) — elles sont posées APRÈS
     l'électroégativité et les groupes formels, donc rien ne peut les écraser : une eau
     n'est pas chargée par PEOE, elle EST chargée (q_O = −0.834 e, q_H = +0.417 e). Sans
     cela, une molécule d'eau explicite porterait les charges de son oxygène de carbonyle,
     et le modèle ne serait plus celui qu'il annonce (voir `FF_TIP3P`). `method` le DIT. */
  const waters = ffWatersIn(els);
  if (waters.molecules) {
    for (let k = 0; k < count; k += 1) {
      const e = upper(els[k]);
      if (e === 'OW') q[k] = FF_TIP3P.ow.charge;
      else if (e === 'HW') q[k] = FF_TIP3P.hw.charge;
    }
  }
  let min = Infinity; let max = -Infinity; let net = 0;
  for (let k = 0; k < count; k += 1) {
    if (q[k] < min) min = q[k];
    if (q[k] > max) max = q[k];
    net += q[k];
  }
  out.ok = true; out.reason = 'ok'; out.charges = q;
  out.net = Number(net.toFixed(6));
  out.min = Number(min.toFixed(6)); out.max = Number(max.toFixed(6));
  out.iterations = FF_PEOE_ITERATIONS;
  out.method = waters.molecules
    ? (groups.length ? 'tip3p+peoe+formal' : 'tip3p+peoe')
    : (groups.length ? 'peoe+formal' : 'peoe');
  /* 🧪 …ET LE pH DANS LE NOM DE LA MÉTHODE QUAND IL A VRAIMENT CHANGÉ QUELQUE CHOSE — un
     lecteur qui voit `peoe+formal+ph` sait que la charge lue n'est pas celle du graphe brut.
     ⚠ ET « formal » AUSSI QUAND LE pH A TITRÉ DES FORMES ACIDES (un COOH n'est pas un groupe
     formel pour `ffFormalGroupsOf`, mais la charge qu'il reçoit en est une) : sans cela le nom
     dirait « peoe+ph », c'est-à-dire la moitié de ce qui s'est passé. Sans pH, RIEN de ceci
     n'ajoute un mot : les quatre chaînes d'avant sont rendues telles quelles. */
  if (ionisation.atWork && !groups.length && ionisable.length) {
    out.method = waters.molecules ? 'tip3p+peoe+formal' : 'peoe+formal';
  }
  if (ionisation.atWork) out.method = `${out.method}+ph`;
  out.groups = groups;
  /* 🧪 …ET LES FONCTIONS QUE LE pH A TITRÉES, telles quelles (elles peuvent être plus
     nombreuses que `groups` : un COOH et un thiol sont des formes ACIDES, que le lecteur des
     formes chargées ne voit pas). */
  out.ionisable = ionisable;
  out.waters = waters;
  out.ph = ionisation.ph;
  out.ionisation = ionisation;
  return out;
};

/* ── 5 · LES ATOMES AJOUTÉS — LES HYDROGÈNES, À LEUR GÉOMÉTRIE IDÉALE ──────────
   Un squelette lourd ne dit pas où sont les hydrogènes, et sans eux la moitié des
   charges et la moitié de la surface manquent. `hydrogenatedOf` complète chaque atome
   lourd jusqu'à sa valence (`FF_VALENCE`) en plaçant les H à la longueur de la table du
   dossier (`bondLengthTarget`) et à l'angle de l'hybridation : tétraédrique pour un
   carbone à trois voisins, trigonal-plan pour un carbone à deux, coudé pour un oxygène.

   ⚠ LA PLACE D'UN HYDROGÈNE EST UNE FONCTION RIGIDE DE SES VOISINS : elle se relit
   entièrement sur la géométrie reçue, et une rotation rigide d'un côté de molécule
   autour d'une charnière emmène ses hydrogènes avec elle. C'est ce qui permet au modèle
   d'ajouter des atomes SANS ajouter un degré de liberté : la dynamique reste dihédrale,
   et le champ lit quand même la molécule complète. */

const vSub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vAdd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const vScale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const vDot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vCross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vNorm = (a) => Math.sqrt(vDot(a, a));
const vUnit = (a) => { const n = vNorm(a); return n < 1e-9 ? [0, 0, 0] : vScale(a, 1 / n); };
const RAD = Math.PI / 180;

/** La longueur d'une liaison à un hydrogène — la table du ⚒, ou 1.09 Å. */
const hLengthOf = (el) => {
  const t = Number(bondLengthTarget(el, 'H', 1));
  return Number.isFinite(t) && t > 0 ? t : 1.09;
};

/** LES H D'UN ATOME, PLACÉS AUTOUR D'UN AXE — `count` directions réparties sur le cône
 *  d'angle `coneDeg` autour de `axis`, à partir de `phaseRef` (qui fixe la rotation,
 *  donc la géométrie est REPRODUCTIBLE au chiffre près). */
const placeAroundAxis = ({ center, axis, ref, coneDeg, count, length, phaseRad = 0 }) => {
  const u = vUnit(axis);
  const raw = ref ? vSub(ref, center) : [1, 0, 0];
  let x = vUnit(vSub(raw, vScale(u, vDot(raw, u))));
  if (vNorm(x) < 1e-6) x = vUnit(Math.abs(u[0]) < 0.9 ? vCross(u, [1, 0, 0]) : vCross(u, [0, 1, 0]));
  const y = vCross(u, x);
  const cone = (Number.isFinite(coneDeg) ? coneDeg : 109.47) * RAD;
  const out = [];
  for (let k = 0; k < count; k += 1) {
    const a = phaseRad + (2 * Math.PI * k) / count;
    const d = vAdd(
      vScale(u, Math.cos(cone)),
      vScale(vAdd(vScale(x, Math.cos(a)), vScale(y, Math.sin(a))), Math.sin(cone)),
    );
    out.push(vAdd(center, vScale(d, length)));
  }
  return out;
};

/** LES HYDROGÈNES MANQUANTS D'UNE MOLÉCULE — `{ok, reason, list, skipped}` avec
 *  `list[k] = {parent, position}` dans l'ordre des atomes. Un atome dont la valence
 *  est déjà complète, un élément sans valence connue et un hydrogène déjà présent ne
 *  reçoivent rien. */
export const ffHydrogensOf = ({ positions = null, elements = [], bonds = [] } = {}) => {
  const read = flatPositions(positions);
  const els = Array.from(elements || []);
  const count = read ? read.count : els.length;
  const out = { ok: false, reason: 'bad-points', list: [], skipped: 0 };
  if (!read || !count) return out;
  const x = read.flat;
  const pt = (k) => [x[k * 3], x[k * 3 + 1], x[k * 3 + 2]];
  const graph = bondGraphOf({ bonds, atomCount: count });
  const used = new Float64Array(count);
  for (const { i, j, order } of graph.list) {
    const o = Number(order) || 1;
    used[i] += o; used[j] += o;
  }
  for (let k = 0; k < count; k += 1) {
    const el = elementAt(els, k);
    if (el === 'H' || el === 'D') continue;
    const valence = ffElementOf(el).valence;
    if (!valence) { out.skipped += 1; continue; }
    const missing = Math.max(0, Math.round(valence - used[k]));
    if (!missing) continue;
    const nbs = graph.neighbours(k);
    const center = pt(k);
    const dirs = nbs.map((m) => vUnit(vSub(pt(m), center)));
    const length = hLengthOf(el);
    let list = [];
    if (nbs.length >= 3) {
      /* TROIS VOISINS — la quatrième direction du tétraèdre, opposée à leur somme. */
      list = placeAroundAxis({
        center, axis: vScale(dirs.reduce((s, d) => vAdd(s, d), [0, 0, 0]), -1),
        ref: dirs[0], coneDeg: 0, count: Math.min(missing, 2), length,
      });
    } else if (nbs.length === 2) {
      /* DEUX VOISINS — la bissectrice (trigonal-plan), sauf deux H : tétraédriques de
         part et d'autre du plan des deux voisins. */
      const bis = vScale(vAdd(dirs[0], dirs[1]), -1);
      const normal = vUnit(vCross(dirs[0], dirs[1]));
      if (missing === 1) {
        list = placeAroundAxis({ center, axis: bis, ref: normal, coneDeg: 0, count: 1, length });
      } else {
        const half = 54.735 * RAD;
        const b = vUnit(bis);
        list = [
          vAdd(center, vScale(vAdd(vScale(b, Math.cos(half)), vScale(normal, Math.sin(half))), length)),
          vAdd(center, vScale(vAdd(vScale(b, Math.cos(half)), vScale(normal, -Math.sin(half))), length)),
        ];
      }
    } else if (nbs.length === 1) {
      /* UN SEUL VOISIN — le cône de l'hybridation autour de la liaison. La PHASE est
         prise sur le voisin du voisin (l'anti d'un méthyle) : la même dans un même
         calcul ; faute de voisin du voisin elle vaut 0 — arbitraire, mais reproductible.
         ⚠ L'ANGLE EST CELUI DU CHAMP (tétraédrique, 109.47°), même pour un oxygène :
         un H ajouté ne doit apporter AUCUNE tension avec lui (la cible d'angle du champ
         est celle de l'hybridation, pas la valeur coudée de l'eau isolée). */
      const grand = graph.neighbours(nbs[0]).filter((m) => m !== k);
      const ref = grand.length ? pt(grand[0]) : null;
      list = placeAroundAxis({
        center, axis: dirs[0], ref, coneDeg: 109.47, count: missing, length,
        phaseRad: ref ? Math.PI : 0,
      });
    } else {
      /* AUCUN VOISIN — un atome seul garde la symétrie de son hybridation. */
      list = placeAroundAxis({
        center, axis: [1, 0, 0], ref: [0, 1, 0],
        coneDeg: 109.47, count: Math.min(missing, 4), length,
      });
    }
    for (const p of list) out.list.push({ parent: k, position: p });
  }
  out.ok = true; out.reason = 'ok';
  return out;
};

/** LA MOLÉCULE COMPLÈTE — les coordonnées, les éléments et les liaisons REÇUS, plus les
 *  hydrogènes de `ffHydrogensOf`. `{ok, reason, positions, elements, bonds, added,
 *  heavy, atoms, skipped, hydrogens}` : `heavy` est le nombre d'atomes reçus, `added`
 *  le nombre d'hydrogènes ajoutés, et `atoms = heavy + added` — le panneau écrit ces
 *  trois chiffres, jamais « je ne sais pas combien d'atomes j'ai regardés ». */
export const hydrogenatedOf = ({ positions = null, elements = [], bonds = [] } = {}) => {
  const read = flatPositions(positions);
  if (!read) {
    return {
      ok: false, reason: 'bad-points', positions: null, elements: [], bonds: [],
      added: 0, heavy: 0, atoms: 0, skipped: 0, hydrogens: [],
    };
  }
  const from = Array.from(elements || []);
  const gen = ffHydrogensOf({ positions: read.flat, elements: from, bonds });
  const pos = Array.from(read.flat);
  const els = from.slice();
  const list = Array.from(bonds || []).map((b) => (Array.isArray(b)
    ? { i: Number(b[0]), j: Number(b[1]), order: Number(b[2]) || 1 }
    : { i: Number(b && b.i), j: Number(b && b.j), order: Number(b && b.order) || 1 }));
  for (const h of gen.list) {
    const idx = els.length;
    els.push('H');
    pos.push(h.position[0], h.position[1], h.position[2]);
    list.push({ i: h.parent, j: idx, order: 1 });
    h.index = idx;
  }
  return {
    ok: true, reason: 'ok', positions: pos, elements: els, bonds: list,
    added: gen.list.length, heavy: read.count, atoms: els.length,
    skipped: gen.skipped, hydrogens: gen.list,
  };
};

/* ── 6 · LA SURFACE, ET LE SOLVANT NON POLAIRE ──────────────────────────────── */

/** LA CALOTTE QU'UNE SPHÈRE COUPE DANS UNE AUTRE — la fraction de la surface de la
 *  sphère de rayon r_i masquée par une sphère de rayon r_j à la distance d (0 → rien,
 *  1 → tout). C'est la géométrie exacte du recouvrement de deux sphères. */
const capFractionOf = (ri, rj, d) => {
  if (!(d > 0) || !(ri > 0)) return 0;
  const cos = (ri * ri + d * d - rj * rj) / (2 * d * ri);
  if (cos >= 1) return 0;                       // disjointes : rien n'est masqué
  if (cos <= -1) return 1;                      // l'autre sphère recouvre tout
  return (1 - cos) / 2;
};

/** LA SURFACE EXPOSÉE, PAR CALOTTES DE COUPLE — l'estimation qui se lit SUR LES COUPLES
 *  (donc un pas de torsion ne relit que les couples qui traversent sa charnière) :
 *  chaque sphère d'atome est augmentée de la sonde d'eau (1.4 Å), et la fraction qu'elle
 *  garde est le PRODUIT des fractions restantes de chacune de ses calottes voisines —
 *  « un point de la sphère est accessible s'il n'est dans aucune des sphères voisines ».
 *  La somme des calottes, elle, sature et enterre un méthyle entier dès deux voisins
 *  (mesuré : 0 Å² pour CH₃OH), et un produit ne sature jamais : un atome seul garde
 *  toute sa sphère, un atome en cage n'en garde presque rien, et le rapport rend AUSSI
 *  la valeur exacte (Shrake–Rupley, `ffSasaOf`) pour que le lecteur puisse comparer les
 *  deux sur sa molécule. */
export const ffSurfaceOf = ({
  positions = null, elements = [], pairs = [], probe = FF_SASA_PROBE, gamma = FF_SASA_GAMMA,
} = {}) => {
  const read = flatPositions(positions);
  const els = Array.from(elements || []);
  const count = read ? read.count : els.length;
  const out = { ok: false, reason: 'bad-points', total: 0, energy: 0, perAtom: [], buried: 0 };
  if (!read || !count) return out;
  const x = read.flat;
  const radii = new Float64Array(count);
  const share = new Float64Array(count).fill(1);
  for (let k = 0; k < count; k += 1) radii[k] = ffElementOf(elementAt(els, k)).radius + probe;
  for (const p of Array.from(pairs || [])) {
    const ri = radii[p.i]; const rj = radii[p.j];
    const d = Math.hypot(
      x[p.i * 3] - x[p.j * 3], x[p.i * 3 + 1] - x[p.j * 3 + 1], x[p.i * 3 + 2] - x[p.j * 3 + 2],
    );
    if (!(d > 1e-6)) continue;
    /* LA CALOTTE QUE j COUPE DANS LA SPHÈRE DE i — l'angle au sommet du cône vaut
       cos θ = (r_i² + d² − r_j²)/(2·d·r_i), et la fraction de sphère enlevée est
       (1 − cos θ)/2. Une sphère entièrement à l'intérieur d'une autre est complètement
       recouverte (cos θ < −1), deux sphères disjointes ne se coupent pas (cos θ > 1).
       Les fractions restantes se MULTIPLIENT : deux voisines qui se chevauchent ne
       peuvent pas enterrer deux fois la même calotte. */
    share[p.i] *= 1 - FF_SURFACE_CAP_OVERLAP * capFractionOf(ri, rj, d);
    share[p.j] *= 1 - FF_SURFACE_CAP_OVERLAP * capFractionOf(rj, ri, d);
  }
  let total = 0;
  const perAtom = [];
  for (let k = 0; k < count; k += 1) {
    const full = 4 * Math.PI * radii[k] * radii[k];
    const area = full * Math.max(0, share[k]);
    total += area;
    if (share[k] <= 1e-6) out.buried += 1;
    perAtom.push({
      i: k, element: elementAt(els, k), radius: radii[k],
      area: Number(area.toFixed(4)), exposed: Number(share[k].toFixed(4)),
    });
  }
  out.ok = true; out.reason = 'ok';
  out.total = Number(total.toFixed(4));
  out.energy = Number((gamma * total).toFixed(6));
  out.perAtom = perAtom;
  return out;
};

/** LA SURFACE EXACTE (SHRAKE–RUPEY) — la mesure indépendante du rapport : chaque atome
 *  est recouvert de `FF_SASA_POINTS` points répartis en spirale dorée sur sa sphère
 *  (une répartition déterministe, donc la même sur toutes les machines), et un point
 *  est accessible s'il n'est dans aucune autre sphère. Elle ne sert PAS au champ — elle
 *  dit au lecteur ce que la famille estime, en Å². */
export const ffSasaOf = ({
  positions = null, elements = [], probe = FF_SASA_PROBE, points = FF_SASA_POINTS,
} = {}) => {
  const read = flatPositions(positions);
  const els = Array.from(elements || []);
  const count = read ? read.count : els.length;
  const out = { ok: false, reason: 'bad-points', total: 0, perAtom: [], probe, points: 0 };
  if (!read || !count) return out;
  const x = read.flat;
  const n = Math.max(8, Math.round(Number(points) || FF_SASA_POINTS));
  const radii = new Float64Array(count);
  for (let k = 0; k < count; k += 1) radii[k] = ffElementOf(elementAt(els, k)).radius + probe;
  /* LA SPIRALE DORÉE — n directions réparties uniformément sur la sphère. */
  const dirs = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let k = 0; k < n; k += 1) {
    const z = 1 - (2 * k + 1) / n;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const a = golden * k;
    dirs.push([r * Math.cos(a), r * Math.sin(a), z]);
  }
  let total = 0;
  const perAtom = [];
  for (let i = 0; i < count; i += 1) {
    let accessible = 0;
    for (const d of dirs) {
      const px = x[i * 3] + d[0] * radii[i];
      const py = x[i * 3 + 1] + d[1] * radii[i];
      const pz = x[i * 3 + 2] + d[2] * radii[i];
      let hidden = false;
      for (let j = 0; j < count && !hidden; j += 1) {
        if (j === i) continue;
        const dx = px - x[j * 3]; const dy = py - x[j * 3 + 1]; const dz = pz - x[j * 3 + 2];
        if (dx * dx + dy * dy + dz * dz < radii[j] * radii[j]) hidden = true;
      }
      if (!hidden) accessible += 1;
    }
    const full = 4 * Math.PI * radii[i] * radii[i];
    const area = (full * accessible) / n;
    total += area;
    perAtom.push({ i, element: elementAt(els, i), area: Number(area.toFixed(4)) });
  }
  out.ok = true; out.reason = 'ok';
  out.total = Number(total.toFixed(4));
  out.perAtom = perAtom;
  out.points = n;
  return out;
};

/* ── 7 · L'ENTROPIE — QUASI-HARMONIQUE POUR LES TORSIONS, RIGIDE POUR LE CORPS ──
   « add … entropy ». L'entropie est une GRANDEUR (cal·mol⁻¹·K⁻¹) et un terme de free
   energy (−T·S, en kcal/mol) ; elle se calcule en trois morceaux, tous publiés :

     • conformation, quasi-harmonique : une torsion retenue par un potentiel de courbure
       k est un oscillateur harmonique de fonction de partition Z = √(2π·k_B·T/k), donc
       S = R·(ln Z + ½). La courbure est celle du potentiel qui retient VRAIMENT la
       torsion dans ce champ (le bassin φ/ψ, le puits de χ1, la barrière trans) : elle
       est écrite ici, une fois, et le panneau la lit.
     • rotation, rotateur rigide : S = R·[ln((√π/σ)(8π²k_B T/h²)^{3/2}√(I_A I_B I_C)) + 3/2],
       les trois moments d'inertie venant du tenseur de la molécule complète (hydrogènes
       compris) et σ = 1.
     • translation, gaz parfait à 1 bar (Sackur–Tetrode).

   ⚠ CE TERME NE DÉPLACE PAS UN ATOME, et le panneau le dit : dans un même calcul les
   amplitudes du champ sont des constantes, donc l'entropie d'un modèle est un DÉCALAGE
   de sa free energy — elle dit ce que coûte une conformation bien définie (une torsion
   serrée dans un puits étroit a MOINS d'entropie qu'une torsion libre), elle ne tire
   pas la géométrie. C'est le prix des contraintes, et il est comparable d'un modèle à
   l'autre : c'est exactement ce qu'un calcul de structure doit pouvoir lire. */

const R_CAL = 1000 * FF_GAS_CONSTANT;             // 1.9872 cal·mol⁻¹·K⁻¹
const AVOGADRO = 6.02214076e23;
const PLANCK = 6.62607015e-34;                    // J·s
const KB_SI = 1.380649e-23;                       // J/K
const AMU_KG = 1.66053906660e-27;                 // kg par amu
const AMU_A2_KG_M2 = AMU_KG * 1e-20;              // amu·Å² → kg·m²
const STANDARD_PRESSURE = 1e5;                    // Pa (1 bar)

/** LA COURBURE DES POTENTIELS DE TORSION (kcal·mol⁻¹·rad⁻²) — la dérivée seconde du
 *  terme au fond de son puits : 2k/(Δ)² pour le bassin φ/ψ, 9k/2 pour le cos 3χ de χ1,
 *  k_ω/(1 − cos(180° − tolérance)) pour la barrière trans de ω — la SEULE courbure non
 *  nulle du terme ω, prise là où il commence à mordre (le bord du plateau) : dedans il
 *  est exactement plat. L'ancien cos 2 en valait 2k = 40, une raideur que le terme actuel
 *  n'a nulle part. C'est ce que l'entropie quasi-harmonique lit. */
export const FF_ENTROPY_CURVATURE = {
  rama: (2 * FF_RAMA_K) / ((FF_RAMA_SPAN * RAD) ** 2),
  chi: 4.5 * FF_CHI_K,
  omega: FF_OMEGA_K / (1 - Math.cos((180 - FF_OMEGA_TOLERANCE) * RAD)),
};


/** L'ENTROPIE D'UN MODÈLE — `{ok, reason, sTransport, sRotation, sConformation, total,
 *  tds, temperature, dof, mass, inertia}`. `total` est en cal·mol⁻¹·K⁻¹, `tds` en
 *  kcal/mol (le terme que le score peut lire), `dof` compte les degrés de liberté
 *  torsoriels comptés. */
export const ffEntropyOf = ({
  positions = null, elements = [], torsions = {}, temperature = FF_REFERENCE_TEMPERATURE,
} = {}) => {
  const read = flatPositions(positions);
  const els = Array.from(elements || []);
  const count = read ? read.count : els.length;
  const T = Number.isFinite(Number(temperature)) ? Number(temperature) : FF_REFERENCE_TEMPERATURE;
  const out = {
    ok: false, reason: 'bad-points', sTransport: 0, sRotation: 0, sConformation: 0,
    total: 0, tds: 0, temperature: T, dof: { rama: 0, chi: 0, omega: 0 },
    mass: 0, inertia: { xx: 0, yy: 0, zz: 0, det: 0 },
  };
  if (!read || !count) return out;
  const x = read.flat;
  const masses = new Float64Array(count);
  let massTotal = 0;
  for (let k = 0; k < count; k += 1) {
    masses[k] = ffElementOf(elementAt(els, k)).mass;
    massTotal += masses[k];
  }
  /* LE CENTRE DE MASSE ET LE TENSEUR D'INERTIE — en amu·Å², puis converti. Le produit
     des trois moments est le DÉTERMINANT du tenseur : les valeurs propres ne servent pas
     au rotateur rigide, donc elles ne sont pas calculées. */
  let cx = 0; let cy = 0; let cz = 0;
  for (let k = 0; k < count; k += 1) {
    cx += masses[k] * x[k * 3]; cy += masses[k] * x[k * 3 + 1]; cz += masses[k] * x[k * 3 + 2];
  }
  cx /= massTotal || 1; cy /= massTotal || 1; cz /= massTotal || 1;
  let xx = 0; let yy = 0; let zz = 0; let xy = 0; let xz = 0; let yz = 0;
  for (let k = 0; k < count; k += 1) {
    const m = masses[k];
    const rx = x[k * 3] - cx; const ry = x[k * 3 + 1] - cy; const rz = x[k * 3 + 2] - cz;
    xx += m * (ry * ry + rz * rz);
    yy += m * (rx * rx + rz * rz);
    zz += m * (rx * rx + ry * ry);
    xy -= m * rx * ry; xz -= m * rx * rz; yz -= m * ry * rz;
  }
  const det = xx * (yy * zz - yz * yz) - xy * (xy * zz - yz * xz) + xz * (xy * yz - yy * xz);
  out.mass = Number(massTotal.toFixed(4));
  out.inertia = {
    xx: Number(xx.toFixed(4)), yy: Number(yy.toFixed(4)), zz: Number(zz.toFixed(4)),
    det: Number(det.toFixed(4)),
  };
  /* LA TRANSLATION — Sackur–Tetrode, à la pression standard. */
  const mKg = massTotal * AMU_KG;
  if (mKg > 0 && T > 0) {
    const arg = ((2 * Math.PI * mKg * KB_SI * T) / (PLANCK * PLANCK)) ** 1.5
      * ((KB_SI * T) / STANDARD_PRESSURE);
    out.sTransport = Number(((KB_SI * (Math.log(arg) + 2.5) * AVOGADRO) / 4.184).toFixed(6));
  }
  /* LA ROTATION — rotateur rigide (σ = 1). Un atome seul n'a pas de rotation. */
  const detSI = det * AMU_A2_KG_M2 ** 3;
  if (detSI > 1e-90 && T > 0) {
    const arg = Math.sqrt(Math.PI) * ((8 * Math.PI * Math.PI * KB_SI * T) / (PLANCK * PLANCK)) ** 1.5
      * Math.sqrt(detSI);
    out.sRotation = Number(((KB_SI * (Math.log(arg) + 1.5) * AVOGADRO) / 4.184).toFixed(6));
  }
  /* LA CONFORMATION — un terme PAR DEGRÉ DE LIBERTÉ, à la courbure du potentiel qui le
     retient. Les comptes viennent des listes de torsion de l'appelant (le squelette lu
     par le calcul lui-même) : aucune torsion n'est devinée ici. */
  const kT = FF_GAS_CONSTANT * T;
  const one = (k, dof) => (dof > 0 && k > 0 && kT > 0
    ? dof * R_CAL * (0.5 * Math.log((2 * Math.PI * kT) / k) + 0.5) : 0);
  const ramaDof = 2 * Math.max(0, Math.round(Number(torsions.rama) || 0));
  const chiDof = Math.max(0, Math.round(Number(torsions.chi) || 0));
  const omegaDof = Math.max(0, Math.round(Number(torsions.omega) || 0));
  out.dof = { rama: ramaDof, chi: chiDof, omega: omegaDof };
  out.sConformation = Number((
    one(FF_ENTROPY_CURVATURE.rama, ramaDof)
    + one(FF_ENTROPY_CURVATURE.chi, chiDof)
    + one(FF_ENTROPY_CURVATURE.omega, omegaDof)
  ).toFixed(6));
  out.total = Number((out.sTransport + out.sRotation + out.sConformation).toFixed(6));
  out.tds = Number(((-T * out.total) / 1000).toFixed(6));
  out.ok = true; out.reason = 'ok';
  return out;
};


/* ── 8 · LE CHAMP, SOMMÉ — LES FAMILLES, LES LIGNES DU PANNEAU, ET L'ÉNERGIE ───
   « One force field » : une fonction, des familles NOMMÉES, et le panneau qui les
   affiche. Le recuit, la dynamique, la minimisation et la note lisent TOUS ce module
   (aucun moteur n'a sa propre physique), et l'énergie est en kcal/mol. */

/** LES FAMILLES DU CHAMP, DANS L'ORDRE OÙ ELLES SE LISENT — l'identifiant est aussi la
 *  clef du rapport (`ffKcalEnergyOf(...).bond`, `.elec`, …). */
export const FORCE_FIELD_KCAL_FAMILIES = [
  'bond', 'angle', 'planar', 'vdw', 'elec', 'solv', 'rama', 'chi', 'omega', 'restraint', 'dihedral', 'entropy',
];

/** LES LIGNES DU CHAMP POUR LE PANNEAU — `{id, icon, label, k, unit, rule, of}` par
 *  famille, dans l'ordre de `FORCE_FIELD_KCAL_FAMILIES`. Aucun chiffre du champ n'est
 *  écrit dans le JSX : le panneau écrit ces lignes-là. */
export const ffKcalRowsOf = ({
  temperature = FF_REFERENCE_TEMPERATURE,
} = {}) => ([
  { id: 'bond', icon: '🔗', label: 'Bond lengths', k: FF_BOND_K, unit: 'kcal·mol⁻¹·Å⁻²',
    of: 'every bond of the graph, hydrogens included', rule: 'harmonic, k·(d − d₀)², d₀ from the element pair' },
  { id: 'angle', icon: '📐', label: 'Bond angles', k: FF_ANGLE_K, unit: 'kcal·mol⁻¹·rad⁻²',
    of: 'every i–j–k of the graph', rule: 'harmonic, k·(θ − θ₀)², θ₀ from the hybridisation of j' },
  { id: 'planar', icon: '▭', label: 'Planar rings', k: FF_PLANAR_K, unit: 'kcal·mol⁻¹·rad⁻²',
    of: 'every planar 5- or 6-ring', rule: 'harmonic on the ring dihedrals, target 0°' },
  { id: 'vdw', icon: '🛡', label: 'van der Waals', k: 1, unit: 'ε kcal/mol',
    of: `every non-bonded pair inside ${FF_PAIR_LIMIT} Å (1-4 scaled × ${FF_VDW_FOURTH_SCALE})`,
    rule: 'Lennard-Jones 12-6, ε·((r₀/r)¹² − 2(r₀/r)⁶), r₀ = r_i + r_j (Bondi), ε = √(ε_i ε_j)' },
  { id: 'elec', icon: '⚡', label: 'Electrostatics', k: FF_COULOMB, unit: 'kcal·Å·mol⁻¹·e⁻²',
    of: 'the same pairs, with the partial charges', rule: `Coulomb screened by a distance-dependent dielectric: 332.0637·q_i·q_j/(${FF_DIELECTRIC}·r²)` },
  { id: 'solv', icon: '🏖', label: 'Non-polar solvent', k: FF_SASA_GAMMA * 1000, unit: 'cal·mol⁻¹·Å⁻²',
    of: 'every atom, from the overlaps of its neighbours',
    rule: `γ·A with A from pairwise sphere overlaps (water probe ${FF_SASA_PROBE} Å)` },
  { id: 'rama', icon: '🧭', label: 'φ/ψ statistical', k: FF_RAMA_K, unit: 'kcal/mol per 100°',
    of: 'every residue with both φ and ψ',
    rule: 'zero inside a basin of the 🪢 plot (the very polygons), then k·(gap/100°)²' },
  { id: 'chi', icon: '🔀', label: 'χ1 staggered', k: FF_CHI_K, unit: 'kcal/mol',
    of: 'every residue with a χ1 (N–CA–CB–X)',
    rule: `three staggered wells (60°, 180°, −60°): k·(1 + cos 3χ)/2, outside past ± ${FF_CHI_TOLERANCE}° of a well` },
  { id: 'omega', icon: '🪢', label: 'ω trans', k: FF_OMEGA_K, unit: 'kcal/mol',
    of: 'every peptide C–N bond (read from the chemistry)',
    rule: `ONE-WAY barrier: k·(1 − cos(over))/(1 − cos(180° − ${FF_OMEGA_TOLERANCE}°)), ZERO inside ± ${FF_OMEGA_TOLERANCE}° of ${FF_OMEGA_TARGET}°, then strictly rising to k = ${FF_OMEGA_K} kcal/mol at the cis — never a second minimum` },
  { id: 'restraint', icon: '📏', label: 'Your distances', k: FF_NOE_K, unit: 'kcal·mol⁻¹·Å⁻²',
    of: 'every line of the distance table',
    rule: `FLAT-BOTTOM well of ± ${FF_RESTRAINT_TOLERANCE} Å, then k·(over)² — the standard restraint of XPLOR/CNS; the ⚖ weight typed on a line multiplies this k, and a weight of 0 makes that line inert` },
  { id: 'dihedral', icon: '⛓', label: 'Secondary-structure φ/ψ', k: FF_DIHEDRAL_K, unit: 'kcal·mol⁻¹·deg⁻²',
    of: 'every φ and ψ converted from the imposed secondary structure (🖌️ H helix, E sheet)',
    rule: `FLAT-BOTTOM window of ± ${FF_DIHEDRAL_TOLERANCE}° around the ideal angle of that letter (H: φ −57°, ψ −47° · E: φ −139°, ψ +135°), then k·(over)² — nothing for a coil. The window alone has no bottom (every angle inside it costs the same), so the ideal is recalled by a centre of its own: kc·(dev)² inside the window, capped at kc·${FF_DIHEDRAL_TOLERANCE}² = ${Number((FF_DIHEDRAL_CENTRE_K * FF_DIHEDRAL_TOLERANCE ** 2).toFixed(6))} kcal/mol beyond it — a constant there, so the shape of the field far from the goal is unchanged. kc = ${FF_DIHEDRAL_CENTRE_K} kcal·mol⁻¹·deg⁻²` },
  { id: 'entropy', icon: '🎲', label: 'Conformational entropy', k: FF_REFERENCE_TEMPERATURE, unit: 'K',
    of: 'every torsion the field confines (φ/ψ, χ1, ω)',
    rule: `quasi-harmonic, S = R·(ln√(2π·k_B·T/k) + ½) with the curvature of its own well; read at ${temperature} K, in cal·mol⁻¹·K⁻¹ and in −T·S (kcal/mol)` },
]);

/** LA MESURE D'UNE LIGNE DE TORSION — `deg` quand elle porte UN angle (ω, χ1), et le
 *  COUPLE (φ, ψ) quand c'est un résidu : un bassin de Ramachandran est une tache du plan
 *  φ×ψ, donc un seul des deux angles ne mesure rien (le lecteur du graphe 🪢 rend les
 *  deux au même titre). ⚠ Sans cette lecture, les lignes φ/ψ — qui portent `phi` et
 *  `psi`, jamais `deg` — étaient sautées par le rapport : la famille « φ/ψ » du champ
 *  valait zéro en toute circonstance, et le total `forceFieldEnergyOf` ne portait PAS ce
 *  que le recuit, la dynamique et la minimisation, eux, payaient (`costRama` du moteur
 *  les relit par `ramaPenaltyOf`). Un chiffre lu par le panneau et un chiffre payé par
 *  les moteurs doivent être le MÊME : c'est cette fonction qui les recolle. */
const ffTorsionMeasureOf = (row) => {
  if (Number.isFinite(row.deg)) return row.deg;
  if (Number.isFinite(row.phi) && Number.isFinite(row.psi)) return row.phi;
  return NaN;
};

/** LE RAPPORT D'UNE FAMILLE DE TORSION — `{count, measured, penalty, violations,
 *  worst, list}`, LA MÊME FORME pour φ/ψ, χ1 et ω : chaque ligne porte son coût et
 *  `over` (de combien elle est sortie de son puits), et le panneau comme les tests n'ont
 *  qu'une forme à connaître. */
export const ffTorsionFamilyOf = (list) => {
  const rows = Array.from(list || []);
  let penalty = 0; let violations = 0; let measured = 0; let worst = null;
  for (const row of rows) {
    if (!Number.isFinite(ffTorsionMeasureOf(row))) continue;
    measured += 1;
    penalty += Number(row.cost) || 0;
    const over = Math.max(0, Number(row.over) || 0);
    if (over > 0) violations += 1;
    if (!worst || over > worst.over) worst = { ...row, over };
  }
  return {
    count: rows.length, measured, penalty: Number(penalty.toFixed(6)),
    violations, worst, list: rows,
  };
};


/* ── 9 · L'ÉNERGIE DU CHAMP, SUR DES COORDONNÉES ────────────────────────────── */

/** L'ANGLE i–j–k EN DEGRÉS, lu sur trois points (NaN quand il n'existe pas). C'est le
 *  lecteur du champ : le moteur de structureCalc emploie LE MÊME, donc un angle n'a
 *  qu'une valeur dans le dossier. */
export const ffAngleDegOf = (a, b, c) => {
  const u = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const v = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
  const nu = Math.hypot(u[0], u[1], u[2]); const nv = Math.hypot(v[0], v[1], v[2]);
  if (!(nu > 1e-9) || !(nv > 1e-9)) return NaN;
  const cos = Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (nu * nv)));
  return (Math.acos(cos) * 180) / Math.PI;
};

/** LE RAPPORT D'UNE FAMILLE GÉOMÉTRIQUE — compté, mesuré, énergie, pire écart. */
const geomFamilyOf = (rows, key) => {
  let penalty = 0; let worst = null; let sum = 0;
  for (const row of rows) {
    penalty += row.cost;
    sum += row.dev * row.dev;
    if (!worst || Math.abs(row.dev) > Math.abs(worst.dev)) worst = row;
  }
  const out = {
    count: rows.length, penalty: Number(penalty.toFixed(6)), worst,
    rms: rows.length ? Number(Math.sqrt(sum / rows.length).toFixed(6)) : 0,
  };
  out[key] = out.penalty;
  return out;
};

/**
 * L'ÉNERGIE DU CHAMP RÉEL SUR CES COORDONNÉES — tout en kcal/mol, famille par famille.
 *
 * @param {{positions:any, elements:any[], bonds:any[], restraints?:any[], ramaPairs?:any[],
 *          omegas?:any[], chis?:any[], hydrogenate?:boolean, exactSurface?:boolean,
 *          temperature?:number, dielectric?:number}} spec
 *   `ramaPairs` = `[{phiAtoms, psiAtoms, klass, ca}]` (les couples du squelette, lus par
 *   `backboneTorsionsOf` de structureCalc) ; `omegas` = `[{i, j, probeAtoms, target}]` ;
 *   `chis` = `[{atoms, ca}]`. `hydrogenate: false` lit la molécule TELLE QU'ELLE EST
 *   (aucun atome ajouté) — le rapport dit alors `added: 0`, il ne fait pas semblant.
 * @returns {{ok:boolean, reason:string, total:number, enthalpy:number, freeEnergy:number,
 *            bond:number, angle:number, planar:number, vdw:number, elec:number, solv:number,
 *            rama:number, chi:number, omega:number, restraint:number, entropy:number,
 *            added:object, charges:object, surface:object, nonbonded:object,
 *            bondReport:object, angleReport:object, planarReport:object,
 *            ramaReport:object, chiReport:object, omegaReport:object,
 *            restraintReport:object, entropyReport:object, rows:object[],
 *            worstVdw:object|null, worstElec:object|null, atoms:any[], bonds:any[]}}
 *   `enthalpy` = la somme des douze familles d'énergie (le chiffre que les moteurs
 *   minimisent), `freeEnergy` = `enthalpy + entropy.tds` (l'entropie est un décalage de
 *   free energy, voir §7), `total` en est un synonyme pour l'enthalpie.
 */
export const ffKcalEnergyOf = ({
  positions = null, elements = [], bonds = [], restraints = [],
  ramaPairs = [], omegas = [], chis = [], dihedrals = [],
  hydrogenate = true, exactSurface = false,
  temperature = FF_REFERENCE_TEMPERATURE, dielectric = FF_DIELECTRIC,
  /* 🧪 LE pH ET LA FORCE IONIQUE — deux réglages de la CHIMIE du champ (voir §2bis et §4bis) :
     le pH dit ce que la molécule porte, la force ionique comment deux charges se voient. `null`
     et `0` sont les défauts, et ils rendent EXACTEMENT le champ d'avant ces deux sections. */
  ph = FF_PH_DEFAULT, ionicStrength = FF_IONIC_STRENGTH_DEFAULT,
  /* 🎯 LA FONCTION CIBLE — `classic` (le défaut, le champ d'origine) ou `dyana`
     (voir `FF_TARGET_FUNCTIONS`) : elle décide des familles non liées, du terme de
     surface ET de l'ajout d'hydrogènes. Le reste du champ est le même dans les deux cas,
     et le rapport DIT lequel a été lu (`targetFunction`, `switchedOff`). */
  targetFunction = 'classic',
} = {}) => {
  const tf = ffTargetFunctionOf(targetFunction);
  /* 🌊 κ DE LA FORCE IONIQUE — un seul chiffre pour tout ce qui suit (le prix d'un couple, sa
     pente, le rapport) : `ffDebyeKappaOf(0)` vaut 0, et 0 est « pas de sel ». */
  const kappa = ffDebyeKappaOf(ionicStrength);
  const empty = {
    ok: false, reason: 'bad-points', total: Infinity, enthalpy: Infinity, freeEnergy: Infinity,
    bond: 0, angle: 0, planar: 0, vdw: 0, elec: 0, solv: 0, rama: 0, chi: 0, omega: 0,
    restraint: 0, dihedral: 0, entropy: 0,
    added: { ok: false, heavy: 0, hydrogens: 0, atoms: 0, skipped: 0 },
    charges: { net: 0, method: 'zero', groups: [], unknown: 0 },
    surface: { estimate: 0, exact: null, energy: 0 },
    nonbonded: { count: 0, repulsive: 0, topology: { bonded: 0, linked: 0, fourth: 0, free: 0 }, unknown: 0 },
    bondReport: geomFamilyOf([], 'penalty'), angleReport: geomFamilyOf([], 'penalty'),
    planarReport: geomFamilyOf([], 'penalty'),
    ramaReport: ffTorsionFamilyOf([]), chiReport: ffTorsionFamilyOf([]),
    omegaReport: ffTorsionFamilyOf([]),
    restraintReport: { count: 0, satisfied: 0, violations: 0, penalty: 0, worst: null, list: [] },
    entropyReport: ffEntropyOf({}), rows: ffKcalRowsOf({ temperature }),
    worstVdw: null, worstElec: null, atoms: [], bonds: [],
    targetFunction: tf.id, targetFunctionLabel: tf.label,
    switchedOff: Array.from(tf.off || []), pairLimit: tf.pairLimit,
    waters: { oxygens: 0, hydrogens: 0, molecules: 0 },
    /* 🧪 LES DEUX RÉGLAGES DE LA CHIMIE, POSÉS MÊME SUR UN REFUS — un appelant qui lit
       `field.kappa` sur une molécule sans coordonnées lit 0 (aucun sel), jamais `undefined`. */
    ph: null, ionisation: ffIonisationReportOf({ groups: [], ph }),
    ionicStrength: Number(ionicStrength) > 0 ? Number(ionicStrength) : 0,
    kappa: Number(kappa.toFixed(6)), debyeLength: kappa > 0 ? Number((1 / kappa).toFixed(4)) : null,
  };
  const useHydrogens = hydrogenate && !tf.unitedAtoms;
  const molecule = useHydrogens
    ? hydrogenatedOf({ positions, elements, bonds })
    : (() => {
      const read = flatPositions(positions);
      if (!read) return null;
      return {
        ok: true, reason: 'ok', positions: Array.from(read.flat), elements: Array.from(elements || []),
        bonds: Array.from(bonds || []), added: 0, heavy: read.count, atoms: read.count,
        skipped: 0, hydrogens: [],
      };
    })();
  if (!molecule || !molecule.ok) return empty;
  const els = molecule.elements;
  const charges = partialChargesOf({ elements: els, bonds: molecule.bonds, ph });
  const walk = ffPairListOf({
    positions: molecule.positions, elements: els, bonds: molecule.bonds, charges: charges.charges,
    limit: tf.pairLimit, surface: tf.surface,
  });
  const x = molecule.positions;
  const pt = (k) => [x[k * 3], x[k * 3 + 1], x[k * 3 + 2]];
  const dist = (i, j) => Math.hypot(
    x[i * 3] - x[j * 3], x[i * 3 + 1] - x[j * 3 + 1], x[i * 3 + 2] - x[j * 3 + 2],
  );
  /* 9a · LA GÉOMÉTRIE — les MÊMES cibles que le ⚒ (`buildRelaxTerms`), mais les
     amplitudes du champ réel. Un écart de 0.01 Å sur une liaison coûte donc
     300·10⁻⁴ = 0.03 kcal/mol, un angle faux de 1° coûte 0.015 kcal/mol. */
  const terms = buildRelaxTerms({
    elements: els, bonds: molecule.bonds, pairs: [], weights: RELAX_WEIGHTS, positions: x,
  });
  const bondRows = terms.bonds.map((t) => {
    const d = dist(t.i, t.j);
    return {
      i: t.i, j: t.j, target: t.target, order: t.order, distance: d,
      dev: d - t.target, cost: ffBondCostOf(d, t.target),
    };
  });
  const angleRows = terms.angles.map((t) => {
    const deg = ffAngleDegOf(pt(t.i), pt(t.j), pt(t.k));
    return {
      i: t.i, j: t.j, k: t.k, target: t.target, deg,
      dev: Number.isFinite(deg) ? deg - t.target : 0,
      cost: Number.isFinite(deg) ? ffAngleCostOf(deg, t.target) : 0,
    };
  });
  const planarRows = terms.planars.map((t) => {
    const deg = dihedralDeg(pt(t.i), pt(t.j), pt(t.k), pt(t.l));
    /* PLAT VOULAIT DIRE 0° COMME 180° — un cycle est plat dans les deux conventions. */
    const dev = Number.isFinite(deg) ? Math.min(Math.abs(deg), 180 - Math.abs(deg)) : 0;
    return {
      i: t.i, j: t.j, k: t.k, l: t.l, ring: t.ring, target: 0, deg, dev,
      cost: ffPlanarCostOf(dev, 0),
    };
  });
  const bondReport = geomFamilyOf(bondRows, 'bond');
  const angleReport = geomFamilyOf(angleRows, 'angle');
  const planarReport = geomFamilyOf(planarRows, 'planar');
  /* 9b · LES COUPLES NON LIÉS ET LA SURFACE — SELON LA FONCTION CIBLE : `classic` lit le
     Lennard-Jones entier et Coulomb ; `dyana` ne lit que la RÉPULSION, sans charge, et
     n'a aucun terme de surface (celui-ci coûte 91 % du travail d'un pas, mesuré). */
  const nonbonded = ffNonbondedEnergyOf(walk.pairs, x, {
    dielectric, repulsionOnly: tf.repulsionOnly, electrostatics: tf.electrostatics, kappa,
  });
  const surface = tf.surface
    ? ffSurfaceOf({ positions: x, elements: els, pairs: walk.surface })
    : { total: 0, energy: 0, off: true };
  const exact = exactSurface && tf.surface ? ffSasaOf({ positions: x, elements: els }).total : null;
  /* 9c · LES TROIS POTENTIELS DE TORSION — lus sur les listes de l'appelant. */
  const ramaRows = Array.from(ramaPairs || []).map((row) => {
    const p = row.phiAtoms || []; const s = row.psiAtoms || [];
    const phi = p.length === 4 ? dihedralDeg(pt(p[0]), pt(p[1]), pt(p[2]), pt(p[3])) : NaN;
    const psi = s.length === 4 ? dihedralDeg(pt(s[0]), pt(s[1]), pt(s[2]), pt(s[3])) : NaN;
    const readable = Number.isFinite(phi) && Number.isFinite(psi);
    const gap = readable ? ramaGapOf(phi, psi, row.klass) : 0;
    return {
      ca: row.ca, klass: row.klass || 'general', phi, psi, gap,
      region: readable ? ramaRegionOf(phi, psi, row.klass) : 'outlier',
      over: gap, cost: ffRamaCostOf(gap),
    };
  });
  const omegaRows = Array.from(omegas || []).map((o) => {
    const a = o.probeAtoms || [];
    const deg = a.length === 4 ? dihedralDeg(pt(a[0]), pt(a[1]), pt(a[2]), pt(a[3])) : NaN;
    const target = Number.isFinite(Number(o.target)) ? Number(o.target) : FF_OMEGA_TARGET;
    const dev = Number.isFinite(deg) ? Math.abs(((deg - target + 540) % 360) - 180) : 0;
    return {
      i: o.i, j: o.j, atoms: a, deg, target, dev,
      over: Math.max(0, dev - FF_OMEGA_TOLERANCE), cost: ffOmegaCostOf(deg, { target }),
    };
  });
  const chiRows = Array.from(chis || []).map((e) => {
    const a = e.atoms || [];
    const deg = a.length === 4 ? dihedralDeg(pt(a[0]), pt(a[1]), pt(a[2]), pt(a[3])) : NaN;
    const dev = Number.isFinite(deg) ? Math.abs(((deg - 60 + 180) % 120) - 60) : 0;
    return {
      ca: e.ca, atoms: a, deg, dev,
      over: Math.max(0, dev - FF_CHI_TOLERANCE), inWell: dev <= FF_CHI_TOLERANCE,
      cost: ffChiCostOf(deg),
    };
  });
  const ramaReport = ffTorsionFamilyOf(ramaRows);
  const omegaReport = ffTorsionFamilyOf(omegaRows);
  const chiReport = ffTorsionFamilyOf(chiRows);
  /* 9d · VOS DISTANCES — le puits plat : satisfaite = rien, au-delà = k·over². Le k
     d'une ligne est SON k : `FF_NOE_K` multiplié par le poids ⚖ de la ligne (un poids
     de 0 rend donc la ligne inerte — elle est encore lue, elle ne pèse rien). */
  const restraintRows = Array.from(restraints || []).map((raw) => {
    const r = Array.isArray(raw) ? { i: raw[0], j: raw[1], target: raw[2] } : (raw || {});
    const i = Number(r.i); const j = Number(r.j);
    const target = Number(r.target);
    const tolerance = Number.isFinite(Number(r.tolerance)) ? Number(r.tolerance) : FF_RESTRAINT_TOLERANCE;
    const weight = ffRestraintWeightOf(r.weight);
    const k = FF_NOE_K * weight;
    const d = Number.isInteger(i) && Number.isInteger(j) && i !== j ? dist(i, j) : NaN;
    const dev = Number.isFinite(d) ? d - target : NaN;
    const abs = Number.isFinite(dev) ? Math.abs(dev) : Infinity;
    return {
      i, j, target, tolerance, weight, k, distance: d, dev, abs,
      satisfied: abs <= tolerance, cost: ffRestraintCostOf(d, { target, tolerance }, k),
    };
  });
  const restraintReport = {
    count: restraintRows.length, satisfied: 0, violations: 0, penalty: 0, severity: 0,
    rmsd: 0, tolerance: FF_RESTRAINT_TOLERANCE, worst: null, list: restraintRows,
  };
  for (const row of restraintRows) {
    restraintReport.penalty += row.cost;
    if (row.satisfied) restraintReport.satisfied += 1; else restraintReport.violations += 1;
    if (!restraintReport.worst || row.abs > restraintReport.worst.abs) restraintReport.worst = row;
  }
  restraintReport.penalty = Number(restraintReport.penalty.toFixed(6));
  /* LE DÉPASSEMENT ET L'ÉCART RMS — les deux chiffres que le panneau et la famille lisent
     (le dépassement est ce que le PUITS PLAT laisse passer au-delà de sa tolérance). */
  for (const row of restraintRows) {
    const over = Number.isFinite(row.abs) ? Math.max(0, row.abs - row.tolerance) : 0;
    restraintReport.severity += over * over;
  }
  restraintReport.severity = Number(restraintReport.severity.toFixed(6));
  restraintReport.rmsd = restraintRows.length
    ? Number(Math.sqrt(restraintReport.severity / restraintRows.length).toFixed(6)) : 0;
  /* 9e · LES CONTRAINTES DE DIHÈDRE — la structure secondaire imposée, φ/ψ par φ/ψ :
     le MÊME puits plat que les distances, en degrés. Le rapport dit combien sont dans
     leur fenêtre, lesquelles en sortent, et de combien. */
  const dihedralRows = Array.from(dihedrals || []).map((raw) => {
    const d = raw && typeof raw === 'object' ? raw : {};
    const atoms = Array.from(d.atoms || []);
    const target = Number(d.target);
    const tolerance = Number.isFinite(Number(d.tolerance)) ? Number(d.tolerance) : FF_DIHEDRAL_TOLERANCE;
    const centreK = Number.isFinite(Number(d.centreK)) ? Math.max(0, Number(d.centreK)) : 0;
    const deg = atoms.length === 4 ? dihedralDeg(pt(atoms[0]), pt(atoms[1]), pt(atoms[2]), pt(atoms[3])) : NaN;
    const dev = Number.isFinite(deg) && Number.isFinite(target)
      ? Math.abs(((deg - target + 540) % 360) - 180) : NaN;
    const over = Number.isFinite(dev) ? Math.max(0, dev - tolerance) : Infinity;
    return {
      kind: d.kind || '', letter: String(d.letter || '').toUpperCase(), ca: d.ca, atoms,
      target, tolerance, centreK, deg, dev, over,
      satisfied: Number.isFinite(dev) ? dev <= tolerance : false,
      cost: ffDihedralCostOf(deg, { target, tolerance, centreK }),
    };
  });
  const dihedralReport = {
    count: dihedralRows.length, satisfied: 0, violations: 0, penalty: 0,
    tolerance: FF_DIHEDRAL_TOLERANCE, centreK: FF_DIHEDRAL_CENTRE_K, worst: null, list: dihedralRows,
  };
  for (const row of dihedralRows) {
    dihedralReport.penalty += row.cost;
    if (row.satisfied) dihedralReport.satisfied += 1; else dihedralReport.violations += 1;
    if (!dihedralReport.worst || row.over > dihedralReport.worst.over) dihedralReport.worst = row;
  }
  dihedralReport.penalty = Number(dihedralReport.penalty.toFixed(6));
  /* 9f · L'ENTROPIE — un terme par torsion que le champ retient, plus le corps rigide. */
  const entropyReport = ffEntropyOf({
    positions: x, elements: els, temperature,
    torsions: {
      rama: ramaRows.filter((r) => Number.isFinite(r.phi) && Number.isFinite(r.psi)).length,
      chi: chiRows.filter((r) => Number.isFinite(r.deg)).length,
      omega: omegaRows.filter((r) => Number.isFinite(r.deg)).length,
    },
  });
  const enthalpy = Number((
    bondReport.penalty + angleReport.penalty + planarReport.penalty
    + nonbonded.vdw + nonbonded.elec + surface.energy
    + ramaReport.penalty + chiReport.penalty + omegaReport.penalty + restraintReport.penalty
    + dihedralReport.penalty
  ).toFixed(6));
  return {
    ...empty,
    ok: true, reason: 'ok',
    total: enthalpy, enthalpy,
    freeEnergy: Number((enthalpy + entropyReport.tds).toFixed(6)),
    bond: bondReport.penalty, angle: angleReport.penalty, planar: planarReport.penalty,
    vdw: Number(nonbonded.vdw.toFixed(6)), elec: Number(nonbonded.elec.toFixed(6)),
    solv: surface.energy, rama: ramaReport.penalty, chi: chiReport.penalty,
    omega: omegaReport.penalty, restraint: restraintReport.penalty,
    dihedral: dihedralReport.penalty,
    entropy: entropyReport.tds,
    added: {
      ok: molecule.ok, heavy: molecule.heavy, hydrogens: molecule.added,
      atoms: molecule.atoms, skipped: molecule.skipped,
    },
    charges: {
      net: charges.net, method: charges.method, groups: charges.groups,
      unknown: charges.unknown, min: charges.min, max: charges.max,
      iterations: charges.iterations,
    },
    surface: { estimate: surface.total, exact, energy: surface.energy, probe: FF_SASA_PROBE },
    nonbonded: {
      count: nonbonded.count, repulsive: nonbonded.repulsive,
      topology: walk.topology, unknown: walk.unknown, limit: walk.limit,
    },
    bondReport, angleReport, planarReport,
    ramaReport, chiReport, omegaReport, restraintReport, dihedralReport, entropyReport,
    worstVdw: nonbonded.worstVdw, worstElec: nonbonded.worstElec,
    /* 🎯 LA FONCTION CIBLE LUE, ET CE QU'ELLE A ÉTEINT — le panneau écrit cette phrase
       telle quelle (voir `renderCalcTargetFunction`) : un lecteur voit que les charges ne
       sont pas « oubliées », elles sont ÉTEINTES par la fonction cible qu'il a choisie. */
    targetFunction: tf.id,
    targetFunctionLabel: tf.label,
    switchedOff: Array.from(tf.off || []),
    pairLimit: walk.limit,
    waters: ffWatersIn(els),
    /* 🧪 CE QUE LA CHIMIE A LU — le pH, l'écrantage ionique et le détail des groupes : le
       rapport d'un geste les cite tels quels, et `ionisation.atWork` dit si le pH a changé
       quelque chose (sinon il ne s'est rien passé, et le rapport le dit aussi). */
    ph: charges.ph, ionisation: charges.ionisation,
    ionicStrength: Number(ionicStrength) > 0 ? Number(ionicStrength) : 0,
    kappa: Number(kappa.toFixed(6)),
    debyeLength: kappa > 0 ? Number((1 / kappa).toFixed(4)) : null,
    rows: ffKcalRowsOf({ temperature }),
    atoms: els, bonds: molecule.bonds,
  };
};

