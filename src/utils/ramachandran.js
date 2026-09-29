/* ============================================================================
   src/utils/ramachandran.js
   🪢 LE GRAPHE DE RAMACHANDRAN — VOIR SI UNE CHAÎNE PEPTIDIQUE TIENT DEBOUT.

   La demande, mot pour mot : « In the calculation you did not consider steric
   clashes along atoms and now they are one on top of each other. Would be nice
   to see the Ramachandran plot. »

   Ce que ce module est — deux lectures et un dessin, rien d'autre :

     1 · LES ANGLES φ ET ψ DE CHAQUE RÉSIDU, lus sur les coordonnées REÇUES :
           φ = C(i−1) · N(i) · CA(i) · C(i)       (l'angle qui suit la liaison N–CA)
           ψ = N(i) · CA(i) · C(i) · N(i+1)       (celui qui suit CA–C)
           ω = CA(i) · C(i) · N(i+1) · CA(i+1)    (la liaison peptidique, ~180°)
         Le dièdre est celui de utils/torsionDrive.js (`dihedralDeg`, la convention
         signée IUPAC, celle des lecteurs χ/δ du viewer) : il n'y a PAS de second
         lecteur de dièdre dans le dossier. Un résidu n'a son φ que si le précédent
         est bien son VOISIN (même chaîne, numéro − 1) — un trou dans la chaîne n'a
         pas de dièdre, donc pas de point — et son ψ que si le suivant l'est aussi.
         Les deux extrémités d'une chaîne n'ont donc qu'un seul angle, et le module
         le DIT (`breaks`, `measured`) au lieu de dessiner un point inventé.

     2 · LA RÉGION DE CHAQUE POINT — « α », « β », « α gauche », ou AUCUNE (un
         point hors des régions est un OUTLIER, et il est nommé). Les contours sont
         ceux de la figure classique (Ramachandran–Ramakrishnan–Sasisekharan 1963,
         reprise par Lovell et al. 2003 pour les aires « core »), approchés par des
         POLYGONES en degrés — le MÊME jeu de polygones sert à classer et à dessiner,
         donc le graphe ne peut pas mentir sur sa propre classification. Trois jeux,
         parce que la figure classique en a trois : un résidu ordinaire (et un résidu
         suivi d'une proline, dont le β est plus large), une GLYCINE (dont les deux
         miroirs sont permis), une PROLINE (dont le cycle ferme le φ sur ≈ −75°).
         ⚠ C'est un PLAN DE LECTURE, pas un calcul : aucun potentiel, aucune énergie,
         aucun atome ajouté — les contours ne sont pas des isocontours d'énergie.

     3 · LE DESSIN, calculé ici et écrit par l'appelant : `ramaPlotPoint` place un
         (φ, ψ) dans un carré, `ramaPlotPath` écrit le chemin SVG d'un polygone. Les
         deux sont PURS et testés (_ramachandran_test.mjs), donc la géométrie du
         graphe ne se vérifie pas à l'œil.

   Module SANS React et sans NGL : il reçoit des atomes (ceux que le viewer lit avec
   `structureAtomRecords`) et rend des nombres. Voir _ramachandran_test.mjs.
   ========================================================================= */

import { dihedralDeg } from './torsionDrive.js';

/** LES TROIS ATOMES DU SQUELETTE — les noms PDB, tels qu'un fichier les écrit. */
export const RAMA_BACKBONE = ['N', 'CA', 'C'];

/** LE CADRE DU GRAPHE — φ en abscisse, ψ en ordonnée, les deux de −180° à +180°
 *  (la convention de toutes les figures publiées). */
export const RAMA_RANGE = { min: -180, max: 180 };

/** LA TAILLE DU DESSIN, en unités du viewBox — et la marge qui porte les axes. */
export const RAMA_PLOT = { size: 268, pad: 26 };

/** LES COULEURS DES TROIS BASSINS — celles que le panneau et le graphe partagent
 *  (un seul endroit, donc une couleur ne peut pas diverger entre la légende et le
 *  point qu'elle décrit). */
export const RAMA_REGION_COLORS = {
  alpha: '#ef4444',        // α droite — hélices
  beta: '#f59e0b',         // β — feuillets et PPII
  leftalpha: '#10b981',    // α gauche — rare hors glycine
  outlier: '#7c3aed',      // hors des régions permises
};

/** LES NOMS DES RÉGIONS, dans l'ordre où la légende les écrit. */
export const RAMA_REGION_NAMES = {
  alpha: 'α right', beta: 'β', leftalpha: 'α left', outlier: 'outside',
};

/** LES POLYGONES, EN DEGRÉS — trois jeux, comme la figure classique. Chaque polygone
 *  est une suite de couples [φ, ψ] ; le premier point est refermé sur le dernier. */
export const RAMA_REGIONS = {
  /* Un résidu ordinaire : le bassin α (autour de −60, −45), le β (autour de −120,
     +135, qui descend jusqu'à −60/+100 avec les structures étendues) et le petit
     bassin α GAUCHE (autour de +60, +45). */
  general: {
    alpha: [[-160, -45], [-120, -15], [-80, -5], [-45, -20], [-35, -50], [-50, -75], [-90, -80], [-140, -70], [-175, -55]],
    beta: [[-180, 140], [-130, 180], [-50, 180], [-40, 140], [-55, 105], [-95, 95], [-140, 100], [-175, 115]],
    leftalpha: [[35, 10], [85, 0], [105, 45], [70, 70], [35, 45]],
  },
  /* La GLYCINE — ses deux miroirs sont permis (elle n'a pas de chaîne latérale qui
     gêne), donc le bassin α gauche s'ouvre largement vers le bas. */
  gly: {
    alpha: [[-160, -45], [-120, -15], [-80, -5], [-45, -20], [-35, -50], [-50, -75], [-90, -80], [-140, -70], [-175, -55]],
    beta: [[-180, 140], [-130, 180], [-50, 180], [-40, 140], [-55, 105], [-95, 95], [-140, 100], [-175, 115]],
    leftalpha: [[35, -60], [120, -45], [175, -25], [175, 35], [120, 65], [55, 55], [30, 20]],
  },
  /* La PROLINE — le cycle ferme le φ sur ≈ −75° : il n'y a AUCUN bassin α gauche, et
     un φ positif est un outlier (le test le vérifie). */
  pro: {
    alpha: [[-95, -35], [-70, -10], [-45, -15], [-35, -45], [-50, -70], [-90, -60]],
    beta: [[-95, 140], [-70, 180], [-35, 180], [-33, 140], [-45, 105], [-75, 100]],
  },
  /* UN RÉSIDU SUIVI D'UNE PROLINE — son β est plus large et son α plus étroit, ce que
     la figure classique distingue aussi (`next` = le résidu d'après). */
  prePro: {
    alpha: [[-160, -45], [-120, -15], [-80, -5], [-50, -20], [-40, -50], [-55, -70], [-95, -75], [-140, -65]],
    beta: [[-180, 120], [-130, 180], [-55, 180], [-45, 120], [-60, 95], [-110, 90], [-175, 100]],
  },
};

/* ── LES RÉSIDUS ET LES ATOMES DU SQUELETTE ────────────────────────────────── */

const upper = (v) => String(v == null ? '' : v).trim().toUpperCase();

/** LES RÉSIDUS DE LA LISTE D'ATOMES — un « résidu de squelette » est un résidu qui a
 *  ses TROIS atomes N, CA et C (c'est la définition, et elle exclut d'elle-même les
 *  acides nucléiques, dont le N s'appelle N1 ou N9). Le regroupement suit la chaîne et
 *  l'INDEX de résidu quand le lecteur le donne (`residueIndex`), sinon le NUMÉRO
 *  (`resno`) : deux résidus de même numéro dans deux chaînes restent séparés. */
export const backboneResiduesOf = (atoms = []) => {
  const byRes = new Map();
  const out = [];
  for (const a of Array.from(atoms || [])) {
    if (!a) continue;
    const name = upper(a.name != null ? a.name : a.atomname);
    if (RAMA_BACKBONE.indexOf(name) < 0) continue;
    if (![a.x, a.y, a.z].every((n) => Number.isFinite(Number(n)))) continue;
    const chain = String(a.chain != null ? a.chain : (a.chainIndex != null ? a.chainIndex : '')) || '_';
    const key = `${chain}|${a.residueIndex != null ? `i${a.residueIndex}` : `n${a.resno}`}`;
    let r = byRes.get(key);
    if (!r) {
      r = {
        key, chain, resname: upper(a.resname) || 'UNK',
        resno: Number.isFinite(Number(a.resno)) ? Number(a.resno) : null,
        residueIndex: Number.isFinite(Number(a.residueIndex)) ? Number(a.residueIndex) : null,
        atoms: {}, order: out.length,
      };
      byRes.set(key, r);
      out.push(r);
    }
    /* Le PREMIER atome de chaque nom gagne : un fichier qui porte deux N (une
       alternance) ne fait pas deux squelettes. */
    if (!r.atoms[name]) r.atoms[name] = [Number(a.x), Number(a.y), Number(a.z)];
  }
  return out;
};

/* ── LES ANGLES, LA CLASSE, ET LA RÉGION ───────────────────────────────────── */

/** LE DIÈDRE, PAR LE LECTEUR DU DOSSIER (utils/torsionDrive.js) — `null` quand les
 *  quatre points n'en font pas un (trois atomes alignés, deux confondus). */
const angle4 = (p0, p1, p2, p3) => {
  const d = dihedralDeg(p0, p1, p2, p3);
  return Number.isFinite(Number(d)) ? Number(d) : null;
};

/** LA CLASSE D'UN RÉSIDU — « general », « gly », « pro », « prePro ». `nextResname` =
 *  le nom du résidu SUIVANT sur la même chaîne (c'est ce qui fait le « pre-Pro » de la
 *  figure classique, dont le β est plus large). La forme chargée de l'histidine, la
 *  sélénométhionine, les cystéines pontées : ordinaires. */
export const ramaKlassOf = ({ resname, nextResname } = {}) => {
  const name = upper(resname);
  const after = upper(nextResname);
  if (name === 'GLY') return 'gly';
  if (name === 'PRO' || name === 'HYP') return 'pro';
  if (after === 'PRO' || after === 'HYP') return 'prePro';
  return 'general';
};

/** LE POINT EST-IL DANS LE POLYGONE — lancer de rayon, la méthode classique (le
 *  compte des croisements d'une demi-droite). Pur, sans état, testé aux bords. */
export const pointInPolygon = (phi, psi, polygon = []) => {
  const pts = Array.from(polygon || []);
  if (pts.length < 3) return false;
  let inside = false;
  for (let a = 0, b = pts.length - 1; a < pts.length; b = a, a += 1) {
    const [xa, ya] = pts[a];
    const [xb, yb] = pts[b];
    if ((ya > psi) !== (yb > psi) && phi < ((xb - xa) * (psi - ya)) / (yb - ya) + xa) {
      inside = !inside;
    }
  }
  return inside;
};

/** LA RÉGION D'UN (φ, ψ) — « alpha », « beta », « leftalpha », ou « outlier » quand le
 *  point n'est dans AUCUN bassin de sa classe. L'ordre est celui de `RAMA_REGION_COLORS`
 *  (α, β, α gauche) : deux bassins qui se touchent ne se disputent pas un point, c'est
 *  le premier nommé qui le prend — et le graphe dessine les mêmes polygones, donc la
 *  couleur du point dit vraiment où il est tombé. */
export const ramaRegionOf = (phi, psi, klass = 'general') => {
  const set = RAMA_REGIONS[klass] || RAMA_REGIONS.general;
  for (const region of ['alpha', 'beta', 'leftalpha']) {
    if (set[region] && pointInPolygon(Number(phi), Number(psi), set[region])) return region;
  }
  return 'outlier';
};

/** LE CENTRE DE CHAQUE BASSIN D'UNE CLASSE — la moyenne de ses sommets. C'est la
 *  règle de mesure des outliers : la distance à ce centre (voir `ramachandranOf`),
 *  un chiffre simple et DIT comme tel (ce n'est pas une énergie, ni une distance au
 *  bord du bassin). */
export const ramaRegionCentroidsOf = (klass = 'general') => {
  const set = RAMA_REGIONS[klass] || RAMA_REGIONS.general;
  const out = {};
  for (const region of Object.keys(set)) {
    const pts = set[region];
    const n = pts.length || 1;
    out[region] = [
      pts.reduce((s, p) => s + p[0], 0) / n,
      pts.reduce((s, p) => s + p[1], 0) / n,
    ];
  }
  return out;
};

/** L'ÉTIQUETTE D'UN RÉSIDU — « A:ALA23 » (chaîne, nom, numéro), ou ce qu'on a. */
export const ramaLabelOf = (res) => {
  if (!res) return '?';
  const chain = res.chain && res.chain !== '_' ? `${res.chain}:` : '';
  const num = res.resno != null ? String(res.resno) : (res.residueIndex != null ? String(res.residueIndex + 1) : '?');
  return `${chain}${res.resname || 'UNK'}${num}`;
};

/** LE CONTOUR QUE LE GRAPHE DESSINE EN FOND — le jeu `general`, celui que tout le
 *  monde reconnaît. Les résidus qui relèvent d'un autre jeu sont comptés à part
 *  (`gly`, `pro`, `prePro`) et leur point est classé par LEUR jeu, pas par celui du
 *  fond : le panneau le dit en clair. */
export const RAMA_PLOT_REGIONS = RAMA_REGIONS.general;

/* ── LE DESSIN — LA GÉOMÉTRIE EST ICI, PAS DANS LE PANNEAU ─────────────────── */

const fmt = (v) => Number(v).toFixed(2);

/** OÙ TOMBE UN (φ, ψ) DANS LE CARRÉ DU GRAPHE — φ vers la DROITE, ψ vers le HAUT (la
 *  convention de toutes les figures : l'origine est en bas à gauche sur −180/−180).
 *  La place est bornée au cadre : un angle absurde (hors de −180…180) irait sinon
 *  dessiner un point hors du graphe. Rend `{x, y}` en unités du viewBox. */
export const ramaPlotPoint = (phi, psi, opts = {}) => {
  const size = Number(opts.size) || RAMA_PLOT.size;
  const pad = opts.pad == null ? RAMA_PLOT.pad : Number(opts.pad);
  const inner = Math.max(1, size - 2 * Math.max(0, pad));
  const span = RAMA_RANGE.max - RAMA_RANGE.min;
  const clamp = (v) => Math.max(RAMA_RANGE.min, Math.min(RAMA_RANGE.max, Number(v)));
  const fx = (clamp(phi) - RAMA_RANGE.min) / span;
  const fy = (clamp(psi) - RAMA_RANGE.min) / span;
  return { x: Number(pad) + fx * inner, y: Number(pad) + (1 - fy) * inner };
};

/** LE CHEMIN SVG D'UN POLYGONE DE RÉGION — `M x y L x y … Z`, refermé. `''` quand le
 *  polygone n'a pas trois sommets (rien à dessiner, plutôt qu'un chemin faux). */
export const ramaPlotPath = (polygon, opts = {}) => {
  const pts = Array.from(polygon || []);
  if (pts.length < 3) return '';
  return `${pts.map((p, k) => {
    const q = ramaPlotPoint(p[0], p[1], opts);
    return `${k ? 'L' : 'M'} ${fmt(q.x)} ${fmt(q.y)}`;
  }).join(' ')} Z`;
};

/** LES LIGNES ET LES ÉTIQUETTES DES AXES — les quatre traits de −180, −90, 0, 90, 180
 *  sur chaque axe, avec leur place dans le carré (le panneau n'a plus qu'à les
 *  écrire ; c'est le même calcul que les points, donc les axes ne peuvent pas dériver
 *  du cadre). */
export const ramaPlotGrid = (opts = {}) => {
  const size = Number(opts.size) || RAMA_PLOT.size;
  const pad = opts.pad == null ? RAMA_PLOT.pad : Number(opts.pad);
  const inner = Math.max(1, size - 2 * Math.max(0, pad));
  const marks = [];
  for (let d = RAMA_RANGE.min; d <= RAMA_RANGE.max; d += 90) marks.push(d);
  return {
    marks,
    x: marks.map((d) => ({ deg: d, at: Number(pad) + ((d - RAMA_RANGE.min) / (RAMA_RANGE.max - RAMA_RANGE.min)) * inner })),
    y: marks.map((d) => ({ deg: d, at: Number(pad) + (1 - ((d - RAMA_RANGE.min) / (RAMA_RANGE.max - RAMA_RANGE.min))) * inner })),
    size, pad, inner,
  };
};

/* ── LE GRAPHE D'UNE MOLÉCULE ──────────────────────────────────────────────── */

/**
 * LE GRAPHE DE RAMACHANDRAN D'UNE CHAÎNE PEPTIDIQUE — un point par résidu.
 *
 * Ce qu'il rend, et rien d'autre : pour chaque résidu de squelette (ses atomes N, CA
 * et C), son φ, son ψ, son ω (l'angle de la liaison peptidique, ~180° pour une liaison
 * trans), sa CLASSE (ordinaire, glycine, proline, pré-proline), sa RÉGION et sa place
 * dans le carré du graphe. Un résidu dont le φ ou le ψ n'existe pas (l'extrémité d'une
 * chaîne, un trou dans la numérotation, un atome manquant) n'a PAS de point : il est
 * compté dans `breaks`, et le panneau le dit — un graphe qui invente un point est pire
 * qu'un graphe vide.
 *
 * `outliers` = les résidus dont le point n'est dans aucun bassin de LEUR classe ; pour
 * chacun, `nearest` nomme le bassin le plus proche et donne la distance (en degrés) à
 * son CENTRE — le seul jugement que ce module porte sur un outlier, et il est écrit.
 *
 * @param {{atoms?:Array<object>, klass?:Function}} spec
 *   `atoms` = `[{ name|atomname, resname, resno, chain|chainIndex, residueIndex, x, y, z }]`
 *   (la forme que le viewer lit avec `structureAtomRecords`).
 * @returns {{count:number, measured:number, breaks:number, gly:number, pro:number,
 *            prePro:number, klass:object, regions:object, outliers:object[],
 *            residues:object[], atoms:object[]}}
 */
export const ramachandranOf = ({ atoms = [] } = {}) => {
  const list = backboneResiduesOf(atoms);
  const out = {
    count: list.length, measured: 0, breaks: 0,
    gly: 0, pro: 0, prePro: 0,
    klass: { general: 0, gly: 0, pro: 0, prePro: 0 },
    regions: { alpha: 0, beta: 0, leftalpha: 0, outlier: 0 },
    outliers: [], residues: [],
  };
  /* LE VOISIN — même chaîne ET numéro consécutif : deux résidus qui se suivent dans
     une liste mais que la numérotation sépare (un trou, une chaîne recollée) n'ont PAS
     de dièdre commun, et le module préfère l'absence au chiffre inventé. Sans numéro
     du tout (une liste d'atomes sans resno), c'est l'ordre de lecture qui décide. */
  const neighbourOf = (a, b) => !!a && !!b && a.chain === b.chain
    && (a.resno == null || b.resno == null || a.resno === b.resno - 1);
  for (let k = 0; k < list.length; k += 1) {
    const r = list[k];
    const prev = k > 0 ? list[k - 1] : null;
    const next = k + 1 < list.length ? list[k + 1] : null;
    const klass = ramaKlassOf({
      resname: r.resname,
      nextResname: next && next.chain === r.chain ? next.resname : null,
    });
    const hasN = !!r.atoms.N; const hasCA = !!r.atoms.CA; const hasC = !!r.atoms.C;
    const phi = hasN && hasCA && hasC && neighbourOf(prev, r) && prev.atoms.C
      ? angle4(prev.atoms.C, r.atoms.N, r.atoms.CA, r.atoms.C) : null;
    const psi = hasN && hasCA && hasC && neighbourOf(r, next) && next.atoms.N
      ? angle4(r.atoms.N, r.atoms.CA, r.atoms.C, next.atoms.N) : null;
    const omega = hasCA && hasC && neighbourOf(r, next) && next.atoms.N && next.atoms.CA
      ? angle4(r.atoms.CA, r.atoms.C, next.atoms.N, next.atoms.CA) : null;
    const both = phi != null && psi != null;
    const region = both ? ramaRegionOf(phi, psi, klass) : null;
    const entry = {
      key: r.key, order: r.order, chain: r.chain, resname: r.resname, resno: r.resno,
      residueIndex: r.residueIndex,
      N: r.atoms.N || null, CA: r.atoms.CA || null, C: r.atoms.C || null,
      klass, phi, psi, omega, region,
      point: both ? ramaPlotPoint(phi, psi) : null,
    };
    entry.label = ramaLabelOf(entry);
    out.residues.push(entry);
    out.klass[klass] = (out.klass[klass] || 0) + 1;
    if (klass === 'gly') out.gly += 1;
    if (klass === 'pro') out.pro += 1;
    if (klass === 'prePro') out.prePro += 1;
    if (!both) { out.breaks += 1; continue; }
    out.measured += 1;
    out.regions[region] = (out.regions[region] || 0) + 1;
    if (region !== 'outlier') continue;
    /* L'OUTLIER — nommé, et situé : à quelle distance du centre du bassin le plus
       proche, et lequel. La mesure est la distance à ce CENTRE (voir
       `ramaRegionCentroidsOf`), pas au bord : elle est donc surestimée, et le
       panneau l'écrit ainsi. */
    const centroids = ramaRegionCentroidsOf(klass);
    let nearest = null;
    for (const name of Object.keys(centroids)) {
      const [cphi, cpsi] = centroids[name];
      const distance = Math.hypot(phi - cphi, psi - cpsi);
      if (!nearest || distance < nearest.distance) nearest = { region: name, distance };
    }
    out.outliers.push({ ...entry, nearest });
  }
  out.atoms = atoms;
  return out;
};
