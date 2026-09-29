/* =========================================================================
   _ramachandran_test.mjs — LE GRAPHE DE RAMACHANDRAN : φ ET ψ, ET RIEN D'INVENTÉ.

   La demande, mot pour mot : « In the calculation you did not consider steric
   clashes along atoms and now they are one on top of each other. Would be nice
   to see the Ramachandran plot. »

   Ce qui doit rester vrai, § par § :

     §1 le module et ses TABLES — les trois atomes du squelette, le cadre −180…180,
        les couleurs et les noms des régions, les trois jeux de polygones ;
     §2 LA CLASSE d'un résidu (ordinaire, glycine, proline, pré-proline) ;
     §3 LES RÉGIONS — les points classiques (une hélice α, un feuillet β, une α
        gauche), le miroir de la glycine, la glycine et la proline qui n'ont PAS les
        mêmes bassins, le trou du milieu qui n'est permis à personne, et les
        polygones eux-mêmes (sommets dans le cadre, centroïdes) ;
     §4 LE DESSIN — `ramaPlotPoint` (les quatre coins, le centre, la borne),
        `ramaPlotPath` (le chemin SVG), `ramaPlotGrid` (les axes) et
        `ramaPlotAxisLabels` (le TEXTE, la PLACE et la TAILLE des graduations et des
        deux titres d'axe) : la géométrie du graphe se vérifie par le calcul, pas à
        l'œil — et les caractères des axes, que la demande trouvait trop petits, aussi ;
     §5 LA LECTURE D'UNE CHAÎNE, EXÉCUTÉE — une hélice α idéale construite résidu
        par résidu (φ = −57, ψ = −47 au chiffre près), un feuillet (φ = −120, ψ =
        +130), une chaîne RETOURNÉE (un outlier nommé), les ω de la liaison
        peptidique, et ce qu'un résidu sans voisin donne : RIEN, compté `breaks`
        (les deux extrémités, et un TROU dans la numérotation) ;
     §6 LE BRANCHEMENT DU VIEWER — le panneau 🪢, le bouton « ⟳ Read the backbone »,
        le dessin SVG, la liste des outliers, LE SURVOL D'UN POINT (qui le nomme et dit
        ses deux angles), et la note qui dit ce que le graphe n'est pas.

   Run: node _ramachandran_test.mjs
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dihedralDeg } from './src/utils/torsionDrive.js';
import {
  RAMA_BACKBONE, RAMA_RANGE, RAMA_PLOT, RAMA_REGION_COLORS, RAMA_REGION_NAMES,
  RAMA_REGIONS, RAMA_PLOT_REGIONS, RAMA_PLOT_FONT, RAMA_POINT,
  backboneResiduesOf, ramaKlassOf, pointInPolygon, ramaRegionOf, ramaRegionCentroidsOf,
  ramaLabelOf, ramachandranOf, ramaPlotPoint, ramaPlotPath, ramaPlotGrid,
  ramaPlotAxisLabels, ramaHoverTextOf,
} from './src/utils/ramachandran.js';

let passed = 0;
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const eq = (a, b, what) => {
  assert.deepEqual(a, b, `${what}\n  attendu : ${JSON.stringify(b)}\n  obtenu  : ${JSON.stringify(a)}`);
  passed += 1;
};
const near = (a, b, what, tol = 1e-6) => {
  assert.ok(Math.abs(Number(a) - Number(b)) <= tol,
    `${what}\n  attendu : ${b} ± ${tol}\n  obtenu  : ${a}`);
  passed += 1;
};
const has = (src, needle, what) => {
  assert.ok(src.includes(needle), `${what}\n  cherche : ${needle}`);
  passed += 1;
};
const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const MODULE = read('src/utils/ramachandran.js');
const VIEW = read('src/components/NMRMoleculeViewer.jsx');
const TORSION = read('src/utils/torsionDrive.js');

/* ── 1 · LE MODULE ET SES TABLES ───────────────────────────────────────────── */
eq(RAMA_BACKBONE, ['N', 'CA', 'C'], 'le squelette est N · CA · C (les noms PDB)');
eq(RAMA_RANGE, { min: -180, max: 180 }, 'le cadre du graphe est −180° … +180° sur les deux axes');
ok(RAMA_PLOT.size > 0 && RAMA_PLOT.pad > 0 && RAMA_PLOT.pad * 2 < RAMA_PLOT.size,
  'la taille et la marge du dessin laissent un carré utilisable');
eq(Object.keys(RAMA_REGION_COLORS).sort(), ['alpha', 'beta', 'leftalpha', 'outlier'],
  'quatre couleurs : les trois bassins et les outliers');
eq(Object.keys(RAMA_REGION_COLORS).sort(), Object.keys(RAMA_REGION_NAMES).sort(),
  '⚠ …et chaque couleur a son nom : aucune région ne peut être dessinée sans être nommée');
eq(RAMA_PLOT_REGIONS, RAMA_REGIONS.general,
  'le fond du graphe est le contour des résidus ordinaires (celui que tout le monde reconnaît)');
has(MODULE, "import { dihedralDeg } from './torsionDrive.js';",
  '⚠ le module LIT le dièdre avec le lecteur du dossier : il n\'y a pas de second lecteur de dixièdre');
has(TORSION, 'export const dihedralDeg', '…et ce lecteur est bien celui de utils/torsionDrive.js');
for (const [klass, set] of Object.entries(RAMA_REGIONS)) {
  ok(Object.keys(set).length >= 2, `la classe « ${klass} » a au moins deux bassins (${Object.keys(set).join(', ')})`);
  for (const [region, poly] of Object.entries(set)) {
    ok(poly.length >= 3, `${klass}/${region} : un polygone à ${poly.length} sommets`);
    ok(poly.every((p) => p.length === 2 && p[0] >= RAMA_RANGE.min && p[0] <= RAMA_RANGE.max
      && p[1] >= RAMA_RANGE.min && p[1] <= RAMA_RANGE.max),
    `…et tous ses sommets sont DANS le cadre (φ, ψ)`);
  }
}
ok(!RAMA_REGIONS.pro.leftalpha,
  '⚠ la PROLINE n\'a pas de bassin α gauche : son cycle ferme le φ sur ≈ −75° (le test le vérifie plus bas)');
ok(RAMA_REGIONS.gly.leftalpha.length > RAMA_REGIONS.general.leftalpha.length,
  '…tandis que la GLYCINE a le sien, plus large : elle n\'a pas de chaîne latérale qui gêne');

/* ── 2 · LA CLASSE D'UN RÉSIDU ─────────────────────────────────────────────── */
eq(ramaKlassOf({ resname: 'ALA' }), 'general', 'une alanine est ordinaire');
eq(ramaKlassOf({ resname: 'MSE' }), 'general', '…la sélénométhionine aussi');
eq(ramaKlassOf({ resname: 'gly' }), 'gly', '⚠ la glycine, même écrite en minuscules (le lecteur normalise)');
eq(ramaKlassOf({ resname: 'PRO' }), 'pro', 'la proline a sa propre classe');
eq(ramaKlassOf({ resname: 'HYP' }), 'pro', '…et son dérivé hydroxylé aussi');
eq(ramaKlassOf({ resname: 'ALA', nextResname: 'PRO' }), 'prePro',
  '⚠ un résidu SUIVI d\'une proline a la sienne : la figure classique distingue le pré-proline');
eq(ramaKlassOf({ resname: 'GLY', nextResname: 'PRO' }), 'gly',
  '…mais une GLYCINE reste une glycine, même avant une proline (la classe la plus stricte gagne)');
eq(ramaKlassOf({}), 'general', 'un résidu sans nom est ordinaire (rien n\'est inventé)');

/* ── 3 · LES RÉGIONS — LES POINTS CLASSIQUES ───────────────────────────────── */
eq(ramaRegionOf(-57, -47), 'alpha', 'l\'hélice α (φ −57, ψ −47) est dans le bassin α');
eq(ramaRegionOf(-120, 130), 'beta', 'un feuillet β (φ −120, ψ +130) est dans le bassin β');
eq(ramaRegionOf(-80, -60), 'alpha', '…et une hélice amorcée (φ −80, ψ −60) aussi');
eq(ramaRegionOf(60, 45), 'leftalpha', '⚠ l\'α GAUCHE (φ +60, ψ +45) a son propre bassin');
eq(ramaRegionOf(-60, 60), 'outlier',
  '⚠ le TROU du milieu (φ −60, ψ +60) n\'est permis à AUCUN résidu ordinaire');
eq(ramaRegionOf(150, 10), 'outlier', '…ni la zone des φ très positifs (réservée à la glycine)');
eq(ramaRegionOf(150, 10, 'gly'), 'leftalpha',
  '⚠ …mais la GLYCINE, elle, y est chez elle : c\'est SON miroir (sa chaîne latérale est un H)');
eq(ramaRegionOf(60, -40, 'gly'), 'leftalpha', '…et encore plus bas (φ +60, ψ −40)');
eq(ramaRegionOf(150, 10, 'pro'), 'outlier',
  '⚠ …tandis que la PROLINE n\'a aucun bassin là : son cycle ferme le φ');
eq(ramaRegionOf(-75, -40, 'pro'), 'alpha', '…mais elle est bien chez elle en α (φ −75, ψ −40)');
eq(ramaRegionOf(-75, 150, 'pro'), 'beta', '…et en β (φ −75, ψ +150)');
eq(ramaRegionOf(-120, 130, 'prePro'), 'beta', 'un pré-proline a son β, plus large');
eq(ramaRegionOf(-58, 100, 'general'), 'outlier',
  '⚠ …juste sous le β ordinaire (φ −58, ψ +100) : les deux jeux de polygones diffèrent VRAIMENT');
eq(ramaRegionOf(-58, 100, 'prePro'), 'beta', '…et le même point est dans le β du pré-proline');
eq(ramaRegionOf(-45, -30, 'general'), 'alpha', '…de même, l\'α ordinaire va jusqu\'à φ −40');
eq(ramaRegionOf(-45, -30, 'prePro'), 'outlier', '⚠ …et l\'α du pré-proline, plus étroit, s\'arrête avant');
eq(ramaRegionOf(-999, 999, 'general'), 'outlier', 'un angle absurde est un outlier, jamais une exception');
eq(ramaRegionOf(-57, -47, 'inconnue'), 'alpha',
  '⚠ une classe inconnue retombe sur le jeu ordinaire : le point de l\'α y est bien classé α');
eq(ramaRegionOf(0, 0, 'inconnue'), 'outlier', '…et (0, 0), qui n\'est dans aucun bassin, reste un outlier');
eq(ramaRegionOf(-57, -47, undefined), 'alpha', '…et sans classe du tout aussi');
eq(pointInPolygon(0, 0, [[-1, -1], [1, -1], [1, 1], [-1, 1]]), true,
  'le lancer de rayon trouve un point dans un carré');
eq(pointInPolygon(5, 0, [[-1, -1], [1, -1], [1, 1], [-1, 1]]), false, '…et laisse dehors celui qui est dehors');
eq(pointInPolygon(0, 0, [[1, 1], [2, 2]]), false, '…un polygone à deux sommets n\'a pas d\'intérieur');
eq(pointInPolygon(0, 0, []), false, '…ni un polygone vide');
const centroids = ramaRegionCentroidsOf('general');
near(centroids.alpha[0], -99.4, 'le centre du bassin α est nommé (−99.4, −46.1) — la règle des outliers', 0.1);
near(centroids.alpha[1], -46.1, '…et son ordonnée', 0.1);
near(centroids.beta[1], 131.9, '…celui du β est en haut (ψ ≈ +132)', 0.1);
eq(Object.keys(centroids).sort(), ['alpha', 'beta', 'leftalpha'], 'trois centres pour un résidu ordinaire');
eq(Object.keys(ramaRegionCentroidsOf('pro')).sort(), ['alpha', 'beta'], '…et deux seulement pour une proline');

/* ── 4 · LE DESSIN ─────────────────────────────────────────────────────────── */
const corner = ramaPlotPoint(-180, -180);
const corner2 = ramaPlotPoint(180, 180);
near(corner.x, RAMA_PLOT.pad, '(−180, −180) tombe dans le COIN bas-gauche du cadre', 1e-9);
near(corner.y, RAMA_PLOT.size - RAMA_PLOT.pad, '…en bas (ψ vers le haut, comme toutes les figures)', 1e-9);
near(corner2.x, RAMA_PLOT.size - RAMA_PLOT.pad, '(+180, +180) tombe dans le coin haut-droit', 1e-9);
near(corner2.y, RAMA_PLOT.pad, '…en haut', 1e-9);
const middle = ramaPlotPoint(0, 0);
near(middle.x, RAMA_PLOT.size / 2, '(0, 0) est au MILIEU en abscisse', 1e-9);
near(middle.y, RAMA_PLOT.size / 2, '…et en ordonnée', 1e-9);
eq(ramaPlotPoint(999, -999), ramaPlotPoint(180, -180),
  '⚠ un angle hors du cadre est RAMENÉ au bord (aucun point ne se dessine hors du graphe)');
const shifted = ramaPlotPoint(-180, 180, { size: 100, pad: 10 });
near(shifted.x, 10, 'la taille et la marge sont des réglages (le panneau peut changer l\'échelle)', 1e-9);
near(shifted.y, 10, '…et le coin haut-gauche tombe bien à la marge (ψ = +180 est EN HAUT)', 1e-9);
eq(ramaPlotPath([[0, 0], [90, 0], [90, 90]]), 'M 170.00 170.00 L 230.00 170.00 L 230.00 110.00 Z',
  '⚠ le chemin SVG est calculé ICI (le panneau ne refait pas la géométrie)');
eq(ramaPlotPath([[0, 0], [90, 0]]), '', '…et un polygone dégénéré ne donne aucun chemin');
const grid = ramaPlotGrid();
eq(grid.marks, [-180, -90, 0, 90, 180], 'les axes portent les cinq repères classiques');
eq(grid.x.map((m) => Math.round(m.at)), [50, 110, 170, 230, 290], '…placés par le MÊME calcul que les points');
eq(grid.y.map((m) => Math.round(m.at)), [290, 230, 170, 110, 50], '…et l\'ordonnée descend avec ψ');
near(grid.inner, RAMA_PLOT.size - 2 * RAMA_PLOT.pad, 'le carré utile est la taille moins deux marges', 1e-9);

/* ── 4 bis · LES AXES, PLUS GRANDS, ET LE SURVOL — « Make x and y axis larger
   (characteria are too small) » et « draw each point and hovering on it tell me which
   angle it is ». C'est une demande de LISIBILITÉ, donc elle se vérifie par des nombres :
   la taille des caractères, la place des textes, le fait qu'aucun texte ne sorte du
   viewBox — et la ligne qu'un survol écrit. Le panneau, lui, n'a plus aucun décalage à
   écrire : il écrit ceci. */
ok(RAMA_PLOT_FONT.tick >= 12 && RAMA_PLOT_FONT.title >= RAMA_PLOT_FONT.tick,
  `les caractères des axes sont LISIBLES (${RAMA_PLOT_FONT.tick} et ${RAMA_PLOT_FONT.title} unités, contre 7 avant la demande)`);
ok(RAMA_PLOT.size >= 320 && RAMA_PLOT.pad >= 40,
  `…et le carré a grandi AVEC eux (${RAMA_PLOT.size} × ${RAMA_PLOT.size}, marge ${RAMA_PLOT.pad}) : des caractères lisibles ne mangent pas le graphe`);
ok(RAMA_PLOT.pad >= RAMA_PLOT_FONT.tick + 8 && RAMA_PLOT.pad * 2 < RAMA_PLOT.size,
  '…la marge a la place de porter une graduation sans la coller au carré');
ok(RAMA_POINT.radius > 0 && RAMA_POINT.outlier > RAMA_POINT.radius && RAMA_POINT.hit > RAMA_POINT.outlier,
  'chaque point est DESSINÉ : plus gros s’il est outlier, et doublé d’un cercle de prise plus large que lui');
const axis = ramaPlotAxisLabels();
eq(axis.x.map((m) => m.text), ['−180', '−90', '0', '90', '180'],
  'les graduations d’abscisse sont ÉCRITES, avec le vrai moins (U+2212, celui du reste de l’app) et sans « + » inutile');
eq(axis.y.map((m) => m.text), ['−180', '−90', '0', '90', '180'],
  '…celles de l’ordonnée aussi, dans l’ordre des degrés — c’est leur PLACE qui descend avec ψ');
eq(axis.x.map((m) => m.x), grid.x.map((m) => m.at),
  '⚠ chaque graduation X tombe SOUS son trait (le même calcul que les points)');
eq(axis.y.map((m) => Math.round((m.y - RAMA_PLOT_FONT.tick * 0.36) * 100) / 100), grid.y.map((m) => Math.round(m.at * 100) / 100),
  '…chaque graduation Y est centrée sur le sien');
eq([...new Set(axis.x.map((m) => m.anchor))], ['middle'], 'les graduations d’abscisse sont centrées');
eq([...new Set(axis.y.map((m) => m.anchor))], ['end'], '…celles d’ordonnée alignées à droite, dans la marge');
ok(axis.x.every((m) => m.y > grid.size - grid.pad && m.y < grid.size),
  '…et posées DANS le viewBox (une graduation qui déborde ne se lirait pas)');
ok(axis.y.every((m) => m.x > 0 && m.x < grid.pad),
  '…de même à gauche : elles occupent la marge, pas le carré');
eq([axis.xTitle.text, axis.yTitle.text], ['φ (°)', 'ψ (°)'],
  'les DEUX axes portent leur nom : φ en abscisse, ψ en ordonnée');
near(axis.xTitle.x, RAMA_PLOT.pad + grid.inner / 2, 'le titre d’abscisse est centré sous le carré', 1e-9);
eq(axis.yTitle.rotate, -90, '…et celui d’ordonnée est couché (une ordonnée s’écrit couchée)');
near(axis.yTitle.y, RAMA_PLOT.pad + grid.inner / 2, '…au milieu de l’axe', 1e-9);
ok(axis.yTitle.x + RAMA_PLOT_FONT.title < axis.y[0].x,
  '…et son texte ne touche pas les graduations (les deux tiennent dans la marge)');
eq(ramaPlotAxisLabels({ font: { tick: 20 } }).font.tick, 20,
  'la taille des caractères est un RÉGLAGE (le panneau peut grossir encore)');

/* LE SURVOL D'UN POINT — ce qu'il DIT, et rien d'autre : le résidu, ses deux angles, ω
   s'il existe, la région. Aucun angle n'est recalculé ici : c'est ce que le module a lu. */
const hoverRow = {
  key: 'A|i2', chain: 'A', resname: 'ALA', resno: 23, residueIndex: 2,
  klass: 'general', phi: -63.24, psi: -41.87, omega: 179.98, region: 'alpha',
  point: ramaPlotPoint(-63.24, -41.87), label: 'A:ALA23', nearest: null,
};
eq(ramaHoverTextOf(hoverRow),
  'A:ALA23 · φ −63.2° ψ −41.9° · ω 180.0° · α right',
  '⚠ le survol nomme le résidu et donne SES DEUX angles (φ et ψ, ceux des deux axes), plus ω');
eq(ramaHoverTextOf({ ...hoverRow, omega: null }),
  'A:ALA23 · φ −63.2° ψ −41.9° · α right',
  '…et ne parle pas d’un ω qui n’existe pas (une extrémité de chaîne)');
eq(ramaHoverTextOf({ ...hoverRow, klass: 'gly' }),
  'A:ALA23 · φ −63.2° ψ −41.9° · ω 180.0° · α right · gly contours',
  '…en rappelant qu’une glycine est classée par SES contours quand ce n’est pas general');
eq(ramaHoverTextOf({
  ...hoverRow, phi: 60, psi: -60, region: 'outlier', nearest: { region: 'leftalpha', distance: 62.4 },
}),
  'A:ALA23 · φ 60.0° ψ −60.0° · ω 180.0° · outside · 62° from α left',
  '…et qu’un outlier est situé : de quel bassin il est le plus proche, et de combien');
eq(ramaHoverTextOf({ ...hoverRow, point: null }),
  null, '⚠ un résidu sans point n’a RIEN à survoler : pas de ligne inventée');
eq(ramaHoverTextOf(null), null, '…et sans résidu non plus');


/* ── 5 · LA LECTURE D'UNE CHAÎNE, EXÉCUTÉE ────────────────────────────────────
   Une chaîne est CONSTRUITE résidu par résidu, avec des longueurs et des angles de
   peptide réels (N–CA 1.46, CA–C 1.52, C–N 1.33 Å ; 111.2°, 121.7°, 116.2°) et des
   φ/ψ DEMANDÉS — puis relue par le module. Le constructeur corrige chaque atome
   posé en tournant autour de l'axe jusqu'à ce que le dièdre mesuré soit exactement
   celui de `dihedralDeg` : la sonde ne dépend donc d'AUCUNE convention devinée. */
const DEG = Math.PI / 180;
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit3 = (a) => {
  const n = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
};
const placeWith = ({ a, b, c, length, angleDeg, dihDeg }) => {
  const bc = unit3(sub3(c, b));
  const n = unit3(cross3(sub3(b, a), bc));
  const m = cross3(bc, n);
  const th = angleDeg * DEG;
  const ph = dihDeg * DEG;
  const v = [-length * Math.cos(th), length * Math.sin(th) * Math.cos(ph), length * Math.sin(th) * Math.sin(ph)];
  let p = [0, 1, 2].map((k) => c[k] + v[0] * bc[k] + v[1] * m[k] + v[2] * n[k]);
  let delta = dihDeg - dihedralDeg(a, b, c, p);
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  const r = delta * DEG;
  const cs = Math.cos(r); const sn = Math.sin(r);
  const w = sub3(p, c);
  const rot = [
    w[0] * cs + (bc[1] * w[2] - bc[2] * w[1]) * sn + bc[0] * dot3(bc, w) * (1 - cs),
    w[1] * cs + (bc[2] * w[0] - bc[0] * w[2]) * sn + bc[1] * dot3(bc, w) * (1 - cs),
    w[2] * cs + (bc[0] * w[1] - bc[1] * w[0]) * sn + bc[2] * dot3(bc, w) * (1 - cs),
  ];
  p = [0, 1, 2].map((k) => c[k] + rot[k]);
  return p;
};
const LEN = { NC: 1.33, CA: 1.46, C: 1.52 };
const ANGLE = { CNC: 116.2, NCA: 121.7, CAC: 111.2 };
const backboneOf = (n, { resname = 'ALA', phi = -57, psi = -47, chain = 'A', gap = 0 } = {}) => {
  const atoms = [];
  const push = (name, resno, index, p) => atoms.push({
    name, resname, resno, residueIndex: index, chain, x: p[0], y: p[1], z: p[2],
  });
  let prevN = [0, 0, 0];
  let prevCA = [LEN.NC, 0.9, 0.2];
  let prevC = [LEN.NC + 0.9, 1.7, -0.3];
  push('N', 1, 0, prevN); push('CA', 1, 0, prevCA); push('C', 1, 0, prevC);
  for (let k = 2; k <= n; k += 1) {
    const resno = k + (gap && k > gap ? 7 : 0);           // un TROU dans la numérotation
    const Nk = placeWith({ a: prevN, b: prevCA, c: prevC, length: LEN.NC, angleDeg: ANGLE.CNC, dihDeg: psi });
    const CAk = placeWith({ a: prevCA, b: prevC, c: Nk, length: LEN.CA, angleDeg: ANGLE.NCA, dihDeg: 180 });
    const Ck = placeWith({ a: prevC, b: Nk, c: CAk, length: LEN.C, angleDeg: ANGLE.CAC, dihDeg: phi });
    push('N', resno, k - 1, Nk); push('CA', resno, k - 1, CAk); push('C', resno, k - 1, Ck);
    prevN = Nk; prevCA = CAk; prevC = Ck;
  }
  return atoms;
};

const helix = backboneOf(6);
const helixRead = ramachandranOf({ atoms: helix });
eq(helixRead.count, 6, 'l’hélice a six résidus de squelette');
eq(helixRead.measured, 4, '…dont QUATRE ont φ ET ψ (les deux extrémités n’ont qu’un angle chacune)');
eq(helixRead.breaks, 2, '⚠ …et les deux extrémités sont comptées comme des trous, jamais dessinées');
for (const r of helixRead.residues.slice(1, 5)) {
  near(r.phi, -57, `${r.label} : le φ DEMANDÉ (−57°) est celui que le module relit`, 1e-9);
  near(r.psi, -47, `…et son ψ (−47°)`, 1e-9);
  eq(r.region, 'alpha', `…donc ${r.label} tombe dans le bassin α`);
}
eq(helixRead.residues[0].phi, null, 'le premier résidu n’a pas de φ (aucun résidu avant lui)');
eq(helixRead.residues[0].psi, -47, '…il n’a QUE son ψ');
eq(helixRead.residues[5].psi, null, '…et le dernier n’a que son φ');
eq(helixRead.regions, { alpha: 4, beta: 0, leftalpha: 0, outlier: 0 },
  'les quatre points mesurés sont tous dans le bassin α');
eq(helixRead.klass, { general: 6, gly: 0, pro: 0, prePro: 0 }, 'six résidus ordinaires');
eq(helixRead.outliers, [], '…et aucun outlier (rien à signaler sur une hélice idéale)');
near(helixRead.residues[1].omega, 180, '⚠ l’ω de la liaison peptidique est de 180° (un peptide trans)', 1e-9);
near(helixRead.residues[1].point.x, ramaPlotPoint(-57, -47).x,
  'le point du graphe vient du même calcul que les axes', 1e-12);
eq(helixRead.residues[1].label, 'A:ALA2', 'un résidu est nommé chaîne · nom · numéro');
eq(ramaLabelOf({ chain: '_', resname: 'GLY', resno: 7 }), 'GLY7', '…sans chaîne quand il n’y en a pas');
eq(ramaLabelOf(null), '?', '…et « ? » plutôt qu’une étiquette inventée');

/* le module LIT ses dièdres avec le lecteur du dossier : la sonde le vérifie sur place */
const r2 = helixRead.residues[1];
const r3 = helixRead.residues[2];
const fromAtoms = (res, name) => [res[name][0], res[name][1], res[name][2]];
near(r2.phi, dihedralDeg(fromAtoms(helixRead.residues[0], 'C'), fromAtoms(r2, 'N'),
  fromAtoms(r2, 'CA'), fromAtoms(r2, 'C')),
  '⚠ le φ rendu est EXACTEMENT le dièdre C(i−1)–N–CA–C du lecteur de utils/torsionDrive.js', 1e-12);
near(r2.psi, dihedralDeg(fromAtoms(r2, 'N'), fromAtoms(r2, 'CA'), fromAtoms(r2, 'C'),
  fromAtoms(r3, 'N')), '…et son ψ, N–CA–C–N(i+1)', 1e-12);

const sheetRead = ramachandranOf({ atoms: backboneOf(5, { phi: -120, psi: 130 }) });
eq(sheetRead.regions, { alpha: 0, beta: 3, leftalpha: 0, outlier: 0 },
  'un feuillet (φ −120, ψ +130) : trois points mesurés, tous en β');

const flippedRead = ramachandranOf({ atoms: backboneOf(4, { phi: 60, psi: -60 }) });
eq(flippedRead.measured, 2, 'une chaîne RETOURNÉE : deux résidus mesurés');
eq(flippedRead.regions.outlier, 2, '⚠ …et les deux sont des OUTLIERS');
eq(flippedRead.outliers.length, 2, '…nommés dans `outliers`');
eq(flippedRead.outliers[0].nearest.region, 'leftalpha',
  '⚠ …avec le bassin le plus proche (l’α gauche) et sa distance');
near(flippedRead.outliers[0].nearest.distance, 94.2,
  '…94.2° du centre de ce bassin (distance au CENTRE, et le module le dit)', 0.2);
eq(flippedRead.outliers[0].label, 'A:ALA2', '…et l’étiquette du résidu fautif');
eq(flippedRead.outliers[0].point.x, ramaPlotPoint(60, -60).x,
  '…son point est quand même placé (c’est ce qui le montre sur le graphe)', 1e-12);

const holeRead = ramachandranOf({ atoms: backboneOf(4, { gap: 2 }) });
eq(holeRead.measured, 0, '⚠ un TROU dans la numérotation casse les φ/ψ qui l’enjambent');
eq(holeRead.breaks, 4, '…aucun résidu n’a alors ses DEUX angles, et le module le compte au lieu d’inventer un point');
eq(holeRead.residues[2].phi, null, '…le premier résidu après le trou n’a pas de φ');
eq(holeRead.residues[1].psi, null, '…ni celui d’avant son ψ');
ok(holeRead.residues[2].psi != null,
  '…mais le résidu d’après GARDE son ψ : seul l’angle qui enjambe le trou est perdu');
ok(holeRead.residues[3].phi != null, '…et le suivant garde son φ');

const twoChains = ramachandranOf({
  atoms: [...backboneOf(3), ...backboneOf(3, { chain: 'B' }).map((a) => ({ ...a, x: a.x + 20 }))],
});
eq(twoChains.count, 6, '⚠ deux chaînes de MÊME numérotation ne se mélangent pas : six résidus');
eq(twoChains.measured, 2, '…chacune garde ses deux résidus mesurés (les deux autres sont des extrémités)');
eq(twoChains.residues[3].label, 'B:ALA1', '…et chacune garde son nom de chaîne');

/* le regroupement, lui-même */
eq(backboneResiduesOf(helix).length, 6, 'les atomes d’un même résidu forment UN résidu (pas trois)');
eq(backboneResiduesOf([
  { name: 'N', resname: 'ALA', resno: 1, x: 0, y: 0, z: 0 },
  { name: 'CA', resname: 'ALA', resno: 1, x: 1, y: 0, z: 0 },
]).length, 1, 'un résidu sans C est quand même un résidu (il n’aura simplement pas de point)');
eq(backboneResiduesOf([
  { name: 'N1', resname: 'DA', resno: 1, x: 0, y: 0, z: 0 },
  { name: "C1'", resname: 'DA', resno: 1, x: 1, y: 0, z: 0 },
]).length, 0, '⚠ un acide nucléique n’est PAS un squelette peptidique (ses atomes s’appellent N1, C1′)');
eq(backboneResiduesOf([{ name: 'N', resname: 'ALA', resno: 1, x: 'x', y: 0, z: 0 }]).length, 0,
  '…et un atome sans coordonnées lisibles est écarté');
eq(backboneResiduesOf(null), [], 'une liste absente ne casse rien');
eq(ramachandranOf({}).count, 0, '…et une molécule sans squelette donne un graphe VIDE (aucune exception)');
eq(ramachandranOf({ atoms: null }).measured, 0, '…sans un seul point mesuré');

/* ── 6 · LE BRANCHEMENT DU VIEWER — LE PANNEAU 🪢 ───────────────────────────── */
has(VIEW, "} from '../utils/ramachandran';", 'le viewer importe le module du graphe');
has(VIEW, 'RAMA_PLOT, RAMA_PLOT_REGIONS, RAMA_REGION_COLORS, RAMA_REGION_NAMES,',
  '…avec les tables du dessin (taille, polygones, couleurs, noms)');
has(VIEW, 'const ramachandranReadingOf = (structure) => (',
  'la lecture passe par UNE fonction (pas de géométrie refaite dans le panneau)');
has(VIEW, 'atoms: structureAtomRecords(structure)',
  '…sur les mêmes atomes que les schémas de couleurs (structureAtomRecords)');
has(VIEW, 'ramachandranOf({', '⚠ …donnés au module PUR : le panneau ne calcule aucun angle lui-même');
has(MODULE, 'export const ramachandranOf = ({ atoms = [] } = {}) => {', '…qui est bien celui du module');
has(VIEW, 'const readRamachandran = () => {', 'le panneau a SA lecture (un bouton la reprend)');
has(VIEW, "onClick={() => { if (calcSection !== 'rama') readRamachandran(); openCalcSection('rama'); }}",
  '⚠ …et elle est prise à l’ouverture de la section 🪢 du panneau unique, pas laissée au hasard');
has(VIEW, 'no N–CA–C backbone', '…et il dit POURQUOI rien n’est dessiné (un acide nucléique n’a pas de φ/ψ)');
has(VIEW, 'nothing was drawn rather than an empty graph', '…en refusant un graphe VIDE (qui tromperait plus qu’il n’informe)');
has(VIEW, '⟳ Read the backbone', 'le bouton de lecture est nommé');
has(VIEW, 'ramaPlotPath(RAMA_PLOT_REGIONS[region])',
  '⚠ le fond du graphe est dessiné PAR LE MODULE : la géométrie n’est pas refaite à la main dans le JSX');
has(VIEW, 'const grid = ramaPlotGrid();', '…les axes aussi (`ramaPlotGrid`)');
has(VIEW, 'cx={r.point.x} cy={r.point.y}', 'un point par résidu, à la place que le module a calculée');
has(VIEW, '<title>{`${r.label} · φ ${r.phi.toFixed(1)}° ψ ${r.psi.toFixed(1)}°',
  '…avec son étiquette et ses angles dans une infobulle');
has(VIEW, 'Outside every basin', 'les outliers ont leur liste, nommés');
has(VIEW, '${Math.round(o.nearest.distance)}° from the centre of ${RAMA_REGION_NAMES[o.nearest.region]}',
  '…avec le bassin le plus proche et la distance (la règle du module, dite telle)');
has(VIEW, 'classified by their OWN contours', '…et la note dit que glycine, proline et pré-proline ont leurs propres contours');
has(VIEW, 'the PEPTIDE BOND itself is twisted',
  '⚠ …et qu’un ω loin de 180° est un AUTRE problème (que le ⚒ ne corrige pas : il n’a pas de cible d’ω)');
has(VIEW, 'What this plot is NOT: not an energy',
  'la note du panneau dit ce que le graphe n’est PAS (ni énergie, ni potentiel, ni validation)');
has(VIEW, 'a point that was not measured would be a lie',
  '…et pourquoi un résidu sans ses deux angles n’est pas dessiné (compté, pas inventé)');
/* LE SURVOL DANS LE PANNEAU — chaque point est DESSINÉ, il s'attrape au survol (et au
   clavier) et la ligne qu'il affiche est celle du module : ni un angle ni une place
   n'est refait dans le JSX. */
has(VIEW, 'RAMA_POINT,',
  'le panneau importe la table des POINTS (taille, cern, cercle de prise) — et les tailles de caractères lui viennent du module');
ok(!VIEW.includes('fontSize="7"'),
  '⚠ …et le 7 en dur (le « characteria are too small » de la demande) a disparu : il ne reste que les tailles du module');
has(VIEW, 'const [ramaHover, setRamaHover] = useState(null);',
  '…et il garde la CLEF du point survolé — pas l’objet : une nouvelle lecture jette les anciens points');
has(VIEW, 'const axis = ramaPlotAxisLabels();',
  '⚠ les graduations et les deux titres d’axe sont placés PAR LE MODULE (le panneau ne chiffre aucun décalage)');
has(VIEW, 'fontSize={axis.font.tick}',
  '…avec la taille de caractères du module (7 → 13 : c’est « characteria are too small »)');
has(VIEW, 'fontSize={axis.font.title}', '…et les titres d’axe sont écrits plus grands encore');
has(VIEW, '{axis.xTitle.text}', '…les deux titres d’axe (φ en abscisse, ψ en ordonnée) sont bien écrits');
has(VIEW, 'strokeDasharray="3 3"',
  'un point survolé est porté à ses DEUX axes par des pointillés (on lit son φ et son ψ sans le lâcher)');
has(VIEW, 'r={RAMA_POINT.hit}',
  '…et chaque point porte un cercle de PRISE plus large que lui (le survol n’exige pas de viser le pixel)');
has(VIEW, 'onMouseEnter={() => setRamaHover(r.key)}', 'le survol d’un point le désigne');
has(VIEW, 'onFocus={() => setRamaHover(r.key)}',
  '…et le clavier aussi (Tab va de point en point : on ne dépend pas de la souris)');
has(VIEW, 'aria-label={ramaHoverTextOf(r) || r.label}',
  '…chaque point portant sa ligne nommée, la même que celle affichée');
has(VIEW, 'const hoverText = ramaHoverTextOf(hovered);',
  '⚠ la ligne sous le graphe EST la ligne du module (le panneau ne recompose aucun angle)');
has(VIEW, 'setRamaHover(null);',
  'une nouvelle lecture, ou Clear, LÈVE le survol : une clef morte ne nomme plus rien');
has(VIEW, 'max-w-[340px]', '…et le graphe s’affiche plus grand (les caractères des axes y tiennent)');


/* LE PANNEAU, DÉCOUPÉ DU VIEWER — de son commentaire d'ouverture (la DERNIÈRE
   occurrence du titre : la première est celle de l'import) jusqu'au bloc suivant
   (l'ESP). C'est CE morceau qui ne doit contenir aucun chemin d'écriture. */
const ramaPanel = VIEW.slice(
  VIEW.lastIndexOf('LE GRAPHE DE RAMACHANDRAN'),
  VIEW.indexOf('{/* ⚡ ESP'),
);
ok(ramaPanel.length > 3000, `le panneau 🪢 est bien dans le viewer (${ramaPanel.length} caractères)`);
ok(!/writeStructurePositions|positionFromArray/.test(ramaPanel),
  '⚠ …et il n’ÉCRIT rien : aucune coordonnée n’est touchée par ce panneau (lecture seule, pour de bon)');
has(ramaPanel, 'title="Open the 🪢 Ramachandran section of the 🧬 pane: the φ/ψ map of the peptide backbone on screen',
  'le bouton de la section s’explique (le geste, les régions, les limites)');
has(ramaPanel, 'there is no second dihedral reader in this app',
  '…en rappelant que le dièdre est celui du dossier (pas un second lecteur)');

console.log(`_ramachandran_test.mjs — ${passed} assertions OK (les tables, la classe des résidus, les régions et`
  + ' leurs polygones, la géométrie du dessin, les caractères des DEUX AXES et leurs titres, le survol qui nomme'
  + ' un point et ses deux angles, une hélice α et un feuillet CONSTRUITS et relus au chiffre près,'
  + ' les trous de chaîne, les outliers nommés, et le panneau 🪢 du viewer)');
