/* =========================================================================
   _torsion_drive_test.mjs — ✏️ RÉGLER UNE TORSION PAR LE CHIFFRE (angle ou distance).

   LA QUESTION DE CETTE SESSION : « I need to be able to set the dihedral / the A–D
   distance between four picked atoms by typing the value — no mouse, no dragging. »
   La réponse tient dans src/utils/torsionDrive.js (pur, sans NGL) et dans le panneau
   ✏️ du viewer. Ce que ce fichier mesure :

     §1 LA CONVENTION — le dihèdre signé A–B–C–D du module EST celui des lecteurs χ/δ
        de l'écran, vérifié sur un exemple qu'on écrit à la main PUIS sur 4000
        configurations contre le lecteur du viewer lui-même, extrait et exécuté ;
     §2 L'ANGLE QUI ATTEINT UNE DISTANCE — la forme fermée (φ ± β), ses deux solutions,
        et surtout : « l'angle rendu met VRAIMENT la distance sur la cible » ;
     §3 LE CÔTÉ QUI TOURNE — le parcours du graphe de liaisons ne traverse jamais B–C,
        et les trois refus (ring · reference-moves · axis-atom) ;
     §4 LE PLAN — tourner, RELIRE, rapporter : positions, Float32 prêt à écrire,
        priorité des demandes, refus qui n'écrivent rien ;
     §5 LE PANNEAU — le seul chemin d'écriture du viewer, le ↺, et chaque `reason` du
        module traduite en une phrase (aucun diagnostic inventé) ;
     §6 SUR UNE VRAIE STRUCTURE NGL — un butane parsé par NGL : les quatre atomes sont
        lus par AtomProxy, le plan écrit par le MÊME `writeStructurePositions` que le
        geste, et l'on relit les coordonnées ATOME PAR ATOME, le PDB exporté ET le ↺.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  TORSION_ANGLE_TOLERANCE_DEG, TORSION_DISTANCE_TOLERANCE,
  wrapDeg, dihedralDeg, distanceOf, axisFrame, solveDistance, movingSideOf, planTorsion,
} from './src/utils/torsionDrive.js';
import { quatFromAxisAngle, rotateVectorByQuat, isIdentityMove, partMoveIdentity, slidePartMove } from './src/utils/viewerMoleculeMoves.js';

let passed = 0;
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const eq = (a, b, what) => { assert.deepEqual(a, b, what); passed += 1; };
/* ⚠ 1e-6 par défaut : les atomes sortent en Float32 (la précision que NGL garde et
   dessine), donc « la distance est la bonne » se dit à la précision du dessin près.
   La forme fermée, elle, est en Float64 : les vérifications d'arithmétique pure
   passent explicitement 1e-9. */
const near = (a, b, what, eps = 1e-6) => {
  assert.ok(Math.abs(a - b) <= eps, `${what}\n  attendu ${b}, obtenu ${a}`);
  passed += 1;
};
const VIEW = readFileSync(new URL('./src/components/NMRMoleculeViewer.jsx', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n');
const MODULE = readFileSync(new URL('./src/utils/torsionDrive.js', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n');
const has = (needle, what) => {
  assert.ok(VIEW.includes(needle), `${what}\n  introuvable : ${needle}`);
  passed += 1;
};
const hasIn = (src, needle, what) => {
  assert.ok(src.includes(needle), `${what}\n  introuvable : ${needle}`);
  passed += 1;
};
/** Le code d'une fonction du viewer, accolades comprises — extrait tel quel pour être
 *  EXÉCUTÉ (jamais réécrit : c'est le lecteur de l'écran qui doit parler). */
const sliceFn = (marker) => {
  const at = VIEW.indexOf(marker);
  assert.ok(at >= 0, `introuvable dans le viewer : ${marker}`);
  let depth = 0;
  for (let i = at + marker.length - 1; i < VIEW.length; i++) {
    if (VIEW[i] === '{') depth += 1;
    else if (VIEW[i] === '}') { depth -= 1; if (!depth) return `${VIEW.slice(at, i + 1)};`; }
  }
  throw new Error(`accolades non fermées : ${marker}`);
};
/** Une ligne du viewer, telle quelle — pour les primitives écrites sur une seule ligne. */
const lineOf = (needle) => {
  const line = VIEW.split('\n').find((l) => l.includes(needle));
  assert.ok(line, `introuvable dans le viewer : ${needle}`);
  return line;
};
/* Deux primitives de vecteurs, pour écrire les gestes de cette sonde (tourner un atome
   autour d'un axe) en n'empruntant au viewer que la rotation elle-même. */
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];


/* ⚠ LE LECTEUR DE DIHÈDRE DE L'ÉCRAN, extrait et exécuté tel quel : c'est celui des
   classements χ/δ (lignes ~840-860 du viewer), donc la convention que le solveur DOIT
   parler — le module le dit lui-même (« le lecteur de l'écran et le solveur »). */
const viewerTorsionDeg = new Function(
  `${lineOf('const vecSub = (a, b) =>')}\n`
  + `${lineOf('const vecCross = (a, b) =>')}\n`
  + `${lineOf('const vecDot = (a, b) =>')}\n`
  + `${lineOf('const vecLen = (a) =>')}\n`
  + `${sliceFn('const torsionDeg = (p0, p1, p2, p3) => {')}\n`
  + 'return torsionDeg;',
)();

/* ── 1. LA CONVENTION ─────────────────────────────────────────────────────── */
{
  const A = [0, 1, 0]; const B = [0, 0, 0]; const C = [1, 0, 0]; const D = [1, 0, 1];
  /* ÉCRIT À LA MAIN : l'axe est x, A est en +y, D en +z — le dihèdre A–B–C–D vaut donc
     +90° : regardé depuis B vers C (le sens de l'axe), D est à +90° de A dans le sens
     trigonométrique direct autour de x (y → z). */
  near(dihedralDeg(A, B, C, D), 90, 'le dihèdre de A=(0,1,0) B=(0,0,0) C=(1,0,0) D=(1,0,1) est +90°, à la main', 1e-12);
  near(viewerTorsionDeg(A, B, C, D), 90, '…et le lecteur χ/δ du viewer dit EXACTEMENT la même chose', 1e-12);
  near(dihedralDeg(A, B, C, [1, 0, -1]), -90, 'l’image miroir en z donne −90° (le signe est bien celui d’un dihèdre signé)', 1e-12);
  near(viewerTorsionDeg(A, B, C, [1, 0, -1]), -90, '…et le viewer aussi', 1e-12);
  near(distanceOf(A, D), Math.sqrt(3), 'la distance A–D de cet exemple est √3 = 1.732 Å', 1e-12);
  near(dihedralDeg(A, B, C, [1, 0, 1.5]), 90, 'un D plus loin SUR LE MÊME demi-plan garde le même dihèdre (un angle, pas une distance)');

  eq(dihedralDeg(A, B, B, D), null, 'un axe de longueur nulle : pas de dihèdre (null, jamais un nombre inventé)');
  eq(dihedralDeg([2, 0, 0], B, C, D), null, 'A aligné sur l’axe : le dihèdre n’est pas défini (null)');
  eq(dihedralDeg(A, B, C, [2, 0, 0]), null, 'D aligné sur l’axe : pas de dihèdre non plus');
  eq(dihedralDeg(A, B, C), null, 'trois points au lieu de quatre : null');
  eq(dihedralDeg(A, B, C, [1, NaN, 1]), null, 'un NaN dans les coordonnées : null');
  eq(dihedralDeg(A, B, C, ['1', '0', 1]), 90, 'des coordonnées en texte sont lues (Number) et non refusées');

  eq(wrapDeg(180), 180, 'la fenêtre du dihèdre est (−180, 180] : +180 y est');
  eq(wrapDeg(-180), 180, '…et −180 y devient +180');
  eq(wrapDeg(370), 10, 'un tour complet est ramené dans la fenêtre');
  eq(wrapDeg(-370), -10, '…dans l’autre sens aussi');

  const frame = axisFrame(B, C);
  eq(frame.origin, B, 'le repère de l’axe a pour origine B (un point de l’axe)');
  near(frame.unit[0], 1, '…et pour direction le vecteur UNITAIRE B→C (ici x)', 1e-12);
  near(Math.hypot(frame.unit[0], frame.unit[1], frame.unit[2]), 1, '…bien unitaire');
  eq(axisFrame(B, B), null, 'deux atomes d’axe confondus : aucun repère (donc aucune torsion possible)');

  /* LA MÊME CONVENTION SUR 4000 CONFIGURATIONS : le module et le lecteur de l'écran
     doivent rendre le même nombre ET le même signe — deux formules différentes (repère
     de l'axe puis atan2 d'un côté, triples produits normés de l'autre) qui doivent dire
     pareil, sinon une torsion réglée à 60° se relirait −60° dans le panneau. */
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  let worst = 0; let flips = 0; let pairs = 0;
  for (let k = 0; k < 4000; k++) {
    const P = [];
    for (let i = 0; i < 4; i++) P.push([rnd() * 6 - 3, rnd() * 6 - 3, rnd() * 6 - 3]);
    const m = dihedralDeg(P[0], P[1], P[2], P[3]);
    const v = viewerTorsionDeg(P[0], P[1], P[2], P[3]);
    if (m === null || v === null) continue;
    pairs += 1;
    worst = Math.max(worst, Math.abs(wrapDeg(m - v)));
    if (Math.abs(wrapDeg(m + v)) < 1e-9) flips += 1;
  }
  ok(pairs > 3900, `le tirage a produit ${pairs} configurations lisibles (le reste : des points alignés ou confondus)`);
  ok(flips === 0, `aucun désaccord de SIGNE entre le solveur et le lecteur de l’écran (${flips} trouvés)`);
  near(worst, 0, '…et jamais plus d’un cheveu d’écart : le module lit le dihèdre comme l’écran', 1e-9);

  /* LE MODULE EST PUR — pas de NGL, pas de React, pas de DOM : c'est ce qui rend la
     forme fermée vérifiable ici, dans node. */
  hasIn(MODULE, "import { quatFromAxisAngle, rotateVectorByQuat } from './viewerMoleculeMoves.js';",
    'le module n’emprunte au viewer QUE la rotation d’une molécule (le même geste, la même précision)');
  ok(!/from 'ngl'/.test(MODULE) && !/\breact\b/i.test(MODULE),
    'le module ne dépend ni de NGL ni de React : une torsion se calcule sans navigateur');
}

/* ── 2. L'ANGLE QUI ATTEINT UNE DISTANCE ──────────────────────────────────────
   Même exemple, et la géométrie s'écrit à la main : l'axe est x, B est l'origine, D est
   à r = 1 de l'axe, A est à |δ|² = 2 du pied de D sur l'axe, donc Amp = 2 et φ = −90°.
   L'atome mobile décrit D(θ) = (1, −sinθ, cosθ) et |A − D(θ)|² = 3 + 2·sinθ — d'où, à la
   main encore : une cible de √2 (3 + 2 sinθ = 2) donne sinθ = −1/2, donc θ = −30° ou
   −150°. C'est ce que la forme fermée doit rendre, au chiffre près. */
{
  const RAD = Math.PI / 180;
  const A = [0, 1, 0]; const B = [0, 0, 0]; const C = [1, 0, 0]; const D = [1, 0, 1];
  const frame = axisFrame(B, C);
  const turn = (pt, deg) => add(frame.origin, rotateVectorByQuat(
    quatFromAxisAngle(frame.unit, deg * RAD), sub(pt, frame.origin),
  ));
  const adAfter = (pt, deg) => distanceOf(A, turn(pt, deg));

  const s = solveDistance({ a: A, moving: D, frame, target: Math.SQRT2 });
  eq(s.ok, true, 'une distance atteignable est atteinte (√2 sur ce cercle)');
  eq(s.reason, 'ok', '…et la raison le dit');
  near(s.radius, 1, 'le rayon du cercle est la distance de D à l’axe (1 Å ici)', 1e-12);
  near(s.amp, 2, 'Amp = 2r·|δ| vaut 2 sur cet exemple', 1e-12);
  near(s.phiDeg, -90, 'φ = atan2(Q, P) vaut −90° (le point le plus proche de A est sous l’axe)', 1e-12);
  near(s.deltaDeg, -30, 'l’angle rendu est −30° — celui qu’on trouve à la main (sinθ = −1/2)', 1e-12);
  near(s.alternativeDeg, -150, 'l’autre solution, à part : −150° (le second rotamère, pas une erreur)', 1e-12);
  near(adAfter(D, s.deltaDeg), Math.SQRT2, '⚠ L’ANGLE RENDU MET VRAIMENT LA DISTANCE SUR LA CIBLE (A–D = √2)', 1e-12);
  near(adAfter(D, s.alternativeDeg), Math.SQRT2, '…et le second rotamère aussi', 1e-12);
  near(dihedralDeg(A, B, C, turn(D, s.deltaDeg)), 60, 'la rotation de −30° amène le dihèdre de +90° à +60°', 1e-9);
  near(dihedralDeg(A, B, C, turn(D, s.alternativeDeg)), -60, '…et celle de −150° à −60°', 1e-9);
  ok(Math.abs(s.deltaDeg) <= Math.abs(s.alternativeDeg),
    'des deux solutions, c’est la PLUS PETITE rotation qui est rendue (le geste le plus court)');
  ok(Math.abs(adAfter(D, s.deltaDeg + 1) - Math.SQRT2) > TORSION_DISTANCE_TOLERANCE,
    '⚠ la solution n’est pas un plateau : à 1° près la distance n’est plus celle demandée');

  const lo = solveDistance({ a: A, moving: D, frame, target: 1 });            // minimum EXACT du cercle
  eq(lo.ok, true, 'la distance minimale du cercle (1 Å) est atteignable');
  near(lo.deltaDeg, -90, '…par θ = φ = −90°', 1e-12);
  near(adAfter(D, lo.deltaDeg), 1, '…et elle y est vraiment', 1e-12);
  const hi = solveDistance({ a: A, moving: D, frame, target: Math.sqrt(5) }); // maximum EXACT
  eq(hi.ok, true, 'la distance maximale (√5, à l’opposé) est atteignable elle aussi — la borne exacte n’est pas refusée pour un bit');
  near(hi.deltaDeg, 90, '…par θ = φ + 180 = +90°', 1e-12);
  near(adAfter(D, hi.deltaDeg), Math.sqrt(5), '…et elle y est vraiment', 1e-12);
  near(hi.alternativeDeg, hi.deltaDeg, 'les deux solutions se confondent à la borne (une seule position extrémale)');

  /* LA CIBLE EST VRAIMENT ATTEINTE POUR TOUTE UNE PLAGE — c'est la vérification qui tient
     le SIGNE de C, choisi une fois pour toutes dans le module : avec l'autre signe, ces
     cibles tombaient ailleurs (c'était le défaut corrigé). */
  for (const target of [1.05, 1.4, 1.75, 2.1]) {
    const r = solveDistance({ a: A, moving: D, frame, target });
    eq(r.ok, true, `la cible ${target} Å est atteignable sur ce cercle (entre 1 et √5)`);
    near(adAfter(D, r.deltaDeg), target,
      `…et l’angle ${r.deltaDeg.toFixed(3)}° l’atteint vraiment (${target} Å)`, 1e-12);
  }

  /* LES DEUX REFUS, ET LE CHIFFRE QU'ILS APPORTENT. « Trop près » (la sphère est plus
     petite que le cercle) et « trop loin » (plus grande) ne disent pas la même chose :
     `tooFar` les distingue, `closestDistance` dit jusqu'où le cercle va et
     `closestDeltaDeg` la rotation qui y mène — vérifiée ici par un BALAYAGE EXHAUSTIF du
     cercle, et non par la formule qui l'a produite. */
  const tooShort = solveDistance({ a: A, moving: D, frame, target: 0.5 });
  eq(tooShort.ok, false, 'une distance plus COURTE que le minimum du cercle est refusée');
  eq(tooShort.reason, 'unreachable', '…comme hors d’atteinte');
  eq(tooShort.tooFar, false, '…et le rapport dit que le cercle ne se rapproche pas assez (tooFar = false)');
  near(tooShort.closestDistance, 1, 'la distance la plus proche du cercle est 1 Å', 1e-12);
  near(tooShort.closestDeltaDeg, -90, '…atteinte par une rotation de −90°', 1e-12);
  const tooLong = solveDistance({ a: A, moving: D, frame, target: 3 });
  eq(tooLong.ok, false, 'une distance plus LONGUE que le maximum du cercle est refusée');
  eq(tooLong.tooFar, true, '…avec tooFar = true : on ne peut pas les écarter davantage');
  near(tooLong.closestDistance, Math.sqrt(5), 'la distance la plus grande du cercle est √5', 1e-12);
  near(tooLong.closestDeltaDeg, 90, '…atteinte par une rotation de +90°', 1e-12);
  for (const [sol, target] of [[tooShort, 0.5], [tooLong, 3]]) {
    let bestGap = Infinity; let bestTheta = 0;
    for (let i = 0; i <= 7200; i++) {                        // −180° → +180°, pas de 0,05°
      const theta = -180 + i * 0.05;
      const gap = Math.abs(adAfter(D, theta) - target);
      if (gap < bestGap) { bestGap = gap; bestTheta = theta; }
    }
    near(bestGap, Math.abs(sol.closestDistance - target),
      `⚠ un balayage exhaustif du cercle (7201 angles) trouve le MÊME écart que closestDistance (cible ${target} Å)`, 1e-4);
    near(Math.abs(wrapDeg(bestTheta - sol.closestDeltaDeg)), 0,
      '…et la rotation qui mène au plus près est celle que le rapport annonce', 0.05);
  }

  /* LA DISTANCE QUI NE DÉPEND PAS DE L'ANGLE — deux cas, et le module les NOMME au lieu
     de rendre un angle qui ne ferait rien. */
  const dOnAxis = solveDistance({ a: A, moving: [2, 0, 0], frame, target: 1.5 });
  eq(dOnAxis.reason, 'distance-fixed', 'D SUR l’axe : tourner ne déplace pas D, aucune rotation ne peut viser une distance');
  near(dOnAxis.radius, 0, '…le cercle est de rayon nul');
  const aOnAxis = solveDistance({ a: [3, 0, 0], moving: D, frame, target: 1.5 });
  eq(aOnAxis.reason, 'distance-fixed', 'A SUR l’axe : la distance A–D est constante elle aussi');
  near(aOnAxis.amp, 0, '…Amp est nul (la part de A perpendiculaire à l’axe est nulle)');

  eq(solveDistance({ a: A, moving: D, frame, target: -1 }).reason, 'bad-target',
    'une distance NÉGATIVE est refusée comme telle (jamais « hors d’atteinte »)');
  eq(solveDistance({ a: A, moving: D, frame, target: 'x' }).reason, 'bad-target',
    'un texte qui n’est pas un nombre aussi');
  eq(solveDistance({ a: A, moving: D, frame, target: undefined }).reason, 'bad-target', 'une cible absente aussi');
  eq(solveDistance({ a: A, moving: D, frame, target: '1.5' }).reason, 'ok', '…mais un nombre EN TEXTE est lu (le champ du panneau rend du texte)');
  eq(solveDistance({ a: A, moving: D, frame: null, target: 1 }).reason, 'bad-points',
    'sans repère d’axe, il n’y a rien à résoudre');
  eq(solveDistance({ a: A, moving: D, frame: { origin: B }, target: 1 }).reason, 'bad-points',
    '…et un repère sans direction n’en est pas un');
  eq(solveDistance({ a: null, moving: D, frame, target: 1 }).reason, 'bad-points', 'sans A non plus');
  eq(solveDistance({ a: A, moving: [1, 2], frame, target: 1 }).reason, 'bad-points',
    'deux nombres ne font pas une coordonnée');
}

/* ── 3. LE CÔTÉ QUI TOURNE ────────────────────────────────────────────────────
   Une liaison est un AXE, pas une paire de ciseaux : le parcours du graphe de liaisons
   ne traverse JAMAIS l'arête B–C, donc tout ce qui pend du côté de D tourne d'un bloc
   (tourner D seul arracherait ses liaisons) et le côté de A ne bouge pas d'un atome. */
{
  /* Une chaîne 0–1–2–3–4–5 : la charnière est 2–3, D est 4, la référence A est 0. */
  const chain = { 0: [1], 1: [0, 2], 2: [1, 3], 3: [2, 4], 4: [3, 5], 5: [4] };
  const nb = (i) => chain[i] || [];
  const side = movingSideOf({ neighbours: nb, atomCount: 6, axis: [2, 3], moving: 4, stay: 0 });
  eq(side.ok, true, 'sur une chaîne, couper la liaison 2–3 donne bien un côté qui tourne');
  eq(side.moved, [4, 5], '⚠ les atomes qui tournent sont D ET TOUT CE QUI PEND DERRIÈRE LUI (4 et 5, triés)');
  eq(side.moved.includes(3), false, '…l’atome C de l’axe (3) n’y est PAS : il est invariant par rotation');
  eq(side.moved.includes(2), false, '…et B (2) non plus');
  eq(side.moved.includes(0) || side.moved.includes(1), false, '…ni aucun atome du côté de la référence A : rien ne bouge de son côté');
  eq(side.sideSize, 3, 'la moitié côté D compte 3 atomes (3, 4 et 5 : le côté atteint sans traverser l’axe)');
  eq(side.reason, 'ok', '…et la raison dit que tout va bien');

  /* LE MÊME COUP, DANS L'AUTRE SENS : couper la même liaison en partant de 0 donne
     l'autre moitié — la coupe est bien une partition, pas un choix arbitraire. */
  const mirror = movingSideOf({ neighbours: nb, atomCount: 6, axis: [2, 3], moving: 0, stay: 4 });
  eq(mirror.moved, [0, 1], 'en partant de l’autre bout, ce sont les atomes 0 et 1 qui tournent');
  eq(mirror.sideSize, 3, '…et l’autre moitié compte 3 atomes (0, 1 et 2)');
  eq([...side.moved, ...mirror.moved].sort((a, b) => a - b), [0, 1, 4, 5],
    'les deux moitiés sont disjointes et couvrent tout ce qui n’est pas l’axe');
  eq(movingSideOf({ neighbours: nb, atomCount: 6, axis: [1, 2], moving: 5, stay: 0 }).moved, [3, 4, 5],
    'couper 1–2 laisse à D le côté {2, 3, 4, 5} ; l’atome C (2) le porte mais ne tourne pas');

  /* LES TROIS REFUS — chacun nommé, parce que le panneau doit dire POURQUOI au lieu de
     ne rien faire. */
  eq(movingSideOf({ neighbours: nb, atomCount: 6, axis: [2, 3], moving: 4, stay: 4 }).reason, 'reference-moves',
    '⚠ si la RÉFÉRENCE A tombait dans le côté qui tourne, le dihèdre serait indéfini dès le premier réglage : refusé');
  eq(movingSideOf({ neighbours: nb, atomCount: 6, axis: [2, 3], moving: 4, stay: 5 }).reason, 'reference-moves',
    '…même chose pour une référence qui pend derrière D');
  eq(movingSideOf({ neighbours: nb, atomCount: 6, axis: [2, 3], moving: 2 }).reason, 'axis-atom',
    'l’atome « qui tourne » est un atome de l’axe : rien ne tournerait');
  eq(movingSideOf({ neighbours: nb, atomCount: 6, axis: [2, 3], moving: 3 }).reason, 'axis-atom', '…idem pour C');

  /* UN CYCLE : la chaîne se referme, donc B et C sont atteints tous les deux SANS traverser
     l'arête — il n'y a plus de « côté de D », et couper cette liaison DÉFORMERAIT le
     cycle. Le refus est la seule réponse honnête. */
  const ringNb = (i) => ({ 0: [1, 5], 1: [0, 2], 2: [1, 3], 3: [2, 4], 4: [3, 5], 5: [4, 0] }[i] || []);
  const ring = movingSideOf({ neighbours: ringNb, atomCount: 6, axis: [2, 3], moving: 4, stay: 0 });
  eq(ring.ok, false, 'une liaison d’un CYCLE n’est pas une charnière : refusée');
  eq(ring.reason, 'ring', '…et la raison est « ring » (le graphe est cyclique à cet endroit)');
  eq(ring.moved, [], '…aucun atome n’est annoncé comme tournant : un refus n’écrit rien');
  eq(movingSideOf({ neighbours: ringNb, atomCount: 6, axis: [0, 1], moving: 3 }).reason, 'ring',
    '…et une autre arête du même cycle est refusée pareil');
}

/* ── 3 bis. CE QUI MANQUE AU GRAPHE, ET L'INVARIANT ─────────────────────────── */
{
  const chain = { 0: [1], 1: [0, 2], 2: [1, 3], 3: [2, 4], 4: [3, 5], 5: [4] };
  const nb = (i) => chain[i] || [];

  /* AUCUNE LIAISON CONNUE (un PDB sans CONECT) : le parcours part de D et n'a personne à
     atteindre — il rend D seul, et surtout ne prétend jamais avoir vu un cycle. */
  const lone = movingSideOf({ atomCount: 6, axis: [2, 3], moving: 4, stay: 0 });
  eq(lone.ok, true, 'sans graphe de liaisons, la torsion reste possible');
  eq(lone.moved, [4], '…mais seul D tourne (c’est tout ce qu’on sait être du même côté)');
  eq(lone.sideSize, 1, '…et la moitié est de taille 1');
  const throws = movingSideOf({
    neighbours: () => { throw new Error('CONECT illisible'); }, atomCount: 6, axis: [2, 3], moving: 4,
  });
  eq(throws.moved, [4], 'un voisinage qui lève est traité comme un voisinage vide, jamais comme une erreur fatale');

  /* UN GRAPHE SALE (indices flottants, chaînes, hors bornes, répétés) ne doit ni lever,
     ni faire entrer n’importe qui dans le côté qui tourne. */
  const junk = movingSideOf({
    neighbours: () => [1, 2, 3, 3, 99, -1, 2.5, 'x'],
    atomCount: 6,
    axis: [0, 5],
    moving: 3,
  });
  eq(junk.ok, true, 'les voisins invalides sont ignorés sans que rien ne lève');
  eq(junk.moved, [1, 2, 3], '…et seuls les indices entiers et dans les bornes entrent dans le côté qui tourne');
  eq(junk.moved.includes(0) || junk.moved.includes(5), false, '…jamais un atome de l’axe');
  for (const bad of [
    { atomCount: 6, axis: [2, 2], moving: 4 },            // B et C confondus
    { atomCount: 6, axis: [2.5, 3], moving: 4 },          // un indice qui n’est pas entier
    { atomCount: 6, axis: null, moving: 4 },              // pas d’axe du tout
    { atomCount: 0, axis: [2, 3], moving: 4 },            // structure sans atomes
    { atomCount: 6, axis: [2, 3], moving: 6 },            // D hors de la molécule
    { atomCount: 6, axis: [2, 3], moving: -1 },           // …de l’autre côté
    { atomCount: 6, axis: [2, 3], moving: 2.5 },          // D qui n’est pas un atome
  ]) {
    const r = movingSideOf(bad);
    eq(r.ok, false, `refus attendu pour ${JSON.stringify(bad)}`);
    ok(r.reason === 'bad-axis' || r.reason === 'bad-atom', `…avec une raison de forme (${r.reason})`);
    eq(r.moved, [], '…et rien à écrire');
  }

  /* L'INVARIANT, sur TOUTES les coupes possibles de la chaîne : `moved` ne contient
     jamais un atome de l'axe, il contient toujours D, il est trié (le viewer écrit
     positions[k] sur moved[k] : cet ordre est un contrat), et la moitié est cohérente. */
  let cuts = 0; let byRef = 0; let byHinge = 0;
  for (let b = 0; b < 6; b++) {
    for (let c = 0; c < 6; c++) {
      for (let m = 0; m < 6; m++) {
        if (b === c || m === b || m === c) continue;
        const r = movingSideOf({ neighbours: nb, atomCount: 6, axis: [b, c], moving: m, stay: 0 });
        if (!r.ok) {
          if (Math.abs(b - c) === 1) {
            byRef += 1;
            eq(r.reason, 'reference-moves',
              `coupe sur une VRAIE liaison ${b}–${c} : si elle est refusée, c’est que A (l’atome 0) se trouve du côté de D (${m})`);
          } else {
            byHinge += 1;
            eq(r.reason, 'ring',
              `coupe ${b}–${c} qui n’est PAS une liaison : le parcours atteint B ET C, donc il n’y a pas de charnière`);
          }
          continue;
        }
        cuts += 1;
        eq(Math.abs(b - c), 1, `la seule coupe acceptée est une VRAIE liaison (${b}–${c})`);
        ok(r.moved.includes(m), `D=${m} tourne toujours avec son côté (coupe ${b}–${c})`);
        ok(!r.moved.includes(b) && !r.moved.includes(c), `aucun atome de l’axe ${b}–${c} ne tourne`);
        ok(r.moved.length <= r.sideSize && r.sideSize <= r.moved.length + 2,
          `la moitié ${b}–${c} est de taille cohérente (${r.moved.length} / ${r.sideSize})`);
        eq(r.moved.slice().sort((x, y) => x - y), r.moved,
          `les atomes qui tournent sont TRIÉS (coupe ${b}–${c}) — le viewer écrit position par position`);
      }
    }
  }
  eq(cuts, 20, 'sur cette chaîne de six atomes, exactement vingt coupes (chaque liaison, dans les deux sens) sont des torsions possibles');
  ok(byRef >= 18, `…et ${byRef} coupes refusées parce que la référence A tournerait avec D`);
  ok(byHinge >= 60, `…et ${byHinge} parce que B et C restent liés autrement : pas de charnière du tout`);
}

/* ── 4. LE PLAN : TOURNER, RELIRE, RAPPORTER ──────────────────────────────────
   `planTorsion` ne suppose rien : il tourne les coordonnées qu'on lui donne, RELIT la
   géométrie sur les coordonnées TOURNÉES, et rend le rapport que le panneau affiche.
   Ce qui suit vérifie que le rapport dit la vérité des coordonnées — et que les
   coordonnées sont bien celles d'une rotation du seul côté qui tourne. */
{
  const RAD = Math.PI / 180;
  const A = [0, 1, 0]; const B = [0, 0, 0]; const C = [1, 0, 0]; const D = [1, 0, 1];
  const points = [A, B, C, D];
  const frame = axisFrame(B, C);
  const drag = (deltaDeg, pt) => add(frame.origin, rotateVectorByQuat(
    quatFromAxisAngle(frame.unit, deltaDeg * RAD), sub(pt, frame.origin),
  ));

  const p = planTorsion({ points, moved: [D], request: { angleDeg: 0 } });
  eq(p.ok, true, 'viser un dihèdre de 0° avec quatre atomes et un atome mobile : le plan passe');
  eq(p.reason, 'ok', '…et se nomme');
  near(p.beforeDeg, 90, 'le rapport dit D’OÙ L’ON PART (+90° lus sur les coordonnées reçues)', 1e-12);
  near(p.beforeDistance, Math.sqrt(3), '…et à quelle distance sont A et D (√3)', 1e-12);
  near(p.targetAngleDeg, 0, 'la cible visée est rapportée telle quelle');
  eq(p.targetDistance, null, '…et aucune distance n’est annoncée puisqu’on a visé un angle');
  near(p.deltaDeg, -90, 'la rotation à appliquer est +90° → 0°, soit −90°', 1e-12);
  near(p.afterDeg, 0, '⚠ LE RAPPORT EST RELU SUR LES COORDONNÉES TOURNÉES : après, le dihèdre vaut 0°', 1e-9);
  near(p.afterDistance, 1, '…et A–D vaut maintenant 1 Å', 1e-9);
  eq(p.movedCount, 1, 'un seul atome a bougé');
  ok(Array.isArray(p.positions) && p.positions.length === 1, 'une position rendue par atome de `moved`');
  near(p.rotatedD[1], 1, 'D est passé de (1, 0, 1) à (1, 1, 0) : sa coordonnée y vaut 1', 1e-9);
  near(p.rotatedD[2], 0, '…et sa coordonnée z est retombée à 0', 1e-9);

  /* ⚠ LES COORDONNÉES SONT CELLES D'UN VRAI GLISSER : le plan et un appel indépendant à
     rotateVectorByQuat (les primitives du glisser de molécule) doivent tomber sur les
     mêmes nombres — c'est ce qui garantit que ce que NGL dessinera est bien la rotation
     annoncée, pas une autre. */
  const byDrag = drag(p.deltaDeg, D);
  eq(p.rotatedD.length, 3, 'l’atome mobile tourné est bien une coordonnée');
  near(p.rotatedD[0], byDrag[0], '⚠ le plan et le glisser de molécule donnent le MÊME x', 1e-12);
  near(p.rotatedD[1], byDrag[1], '…le même y', 1e-12);
  near(p.rotatedD[2], byDrag[2], '…le même z', 1e-12);
  ok(p.flatPositions instanceof Float32Array, '⚠ `flatPositions` est un Float32Array : EXACTEMENT ce que positionFromArray écrit');
  eq(p.flatPositions.length, 3, '…de trois nombres par atome déplacé');
  near(p.flatPositions[0], byDrag[0], '…et il porte la même rotation (au Float32 près, la mémoire de NGL)', 1e-6);
  near(p.flatPositions[1], byDrag[1], '…coordonnée par coordonnée', 1e-6);
  near(p.flatPositions[2], byDrag[2], '…jusqu’au bout');
  eq(p.alternativeDeg, null, 'viser un ANGLE ne donne qu’une rotation : pas de second rotamère');
  eq(p.solved, null, '…et aucun solveur de distance n’a été appelé');

  const byAng = planTorsion({ points, moved: [D], request: { angleDeg: 60 } });
  near(byAng.deltaDeg, -30, 'viser +60° depuis +90° demande −30°', 1e-12);
  near(byAng.afterDeg, 60, '…et c’est bien +60° qu’on relit', 1e-9);
  near(byAng.afterDistance, Math.SQRT2, '…la distance A–D vaut alors √2', 1e-9);

  const byDist = planTorsion({ points, moved: [D], request: { distance: Math.SQRT2 } });
  eq(byDist.ok, true, 'viser une DISTANCE passe par le solveur et aboutit');
  eq(byDist.targetDistance, Math.SQRT2, 'la distance visée est rapportée');
  eq(byDist.targetAngleDeg, null, '…et aucun angle n’est annoncé comme visé');
  near(byDist.deltaDeg, -30, 'la rotation résolue est celle de la forme fermée (−30°)', 1e-9);
  near(byDist.afterDistance, Math.SQRT2, '⚠ ET LA DISTANCE RELUE EST LA CIBLE (√2), au chiffre près', 1e-9);
  near(byDist.afterDeg, 60, '…le dihèdre qui va avec (+60°)', 1e-9);
  ok(byDist.solved && byDist.solved.ok, 'le rapport du solveur voyage AVEC le plan');
  near(byDist.alternativeDeg, -150, '…l’autre rotamère aussi (pour un bouton « l’autre solution »)', 1e-12);

  /* LA PRIMITIVE, ENFIN : `rotateByDeg` est ce que le panneau envoie pour un pas de
     rotation ou pour « appliquer la plus proche » — et il l'emporte sur le reste. */
  const byRot = planTorsion({ points, moved: [D], request: { rotateByDeg: 30, angleDeg: 0 } });
  near(byRot.deltaDeg, 30, '`rotateByDeg` l’emporte sur `angleDeg` : c’est la primitive', 1e-12);
  near(byRot.afterDeg, 120, '…+30° depuis +90° font +120°', 1e-9);
  const byRotOnly = planTorsion({ points, moved: [D], request: { rotateByDeg: 30, distance: 0.5 } });
  eq(byRotOnly.ok, true, 'une distance hors d’atteinte ne bloque PAS une rotation demandée directement');
  eq(byRotOnly.targetDistance, null, '…rien n’est annoncé comme visé à part la rotation');
  near(byRotOnly.deltaDeg, 30, '…et la rotation est celle demandée', 1e-12);

  const byBoth = planTorsion({ points, moved: [D], request: { angleDeg: 0, distance: 0.5 } });
  near(byBoth.deltaDeg, -90, '⚠ quand les deux sont demandés, c’est L’ANGLE qui gagne (documenté)', 1e-12);
  eq(byBoth.targetDistance, null, '…et la distance ignorée n’est pas rapportée comme visée');
  near(byBoth.afterDeg, 0, '…l’angle visé est bel et bien atteint', 1e-9);
  near(planTorsion({ points, moved: [D], request: { angleDeg: '0' } }).afterDeg, 0,
    'un nombre EN TEXTE est lu (le champ du panneau rend du texte)', 1e-9);
}

/* ── 4 bis. LE CÔTÉ ENTIER TOURNE, ET LES REFUS NE TOUCHENT À RIEN ──────────── */
{
  const RAD = Math.PI / 180;
  const A = [0, 1, 0]; const B = [0, 0, 0]; const C = [1, 0, 0]; const D = [1, 0, 1];
  const E = [2, 0, 0.5];                       // un atome qui pend du même côté que D
  const points = [A, B, C, D];
  const frame = axisFrame(B, C);
  const drag = (deltaDeg, pt) => add(frame.origin, rotateVectorByQuat(
    quatFromAxisAngle(frame.unit, deltaDeg * RAD), sub(pt, frame.origin),
  ));
  const len = (u, v) => Math.hypot(u[0] - v[0], u[1] - v[1], u[2] - v[2]);

  const two = planTorsion({ points, moved: [D, E], request: { angleDeg: 60 } });
  eq(two.movedCount, 2, 'deux atomes à tourner : deux atomes rapportés comme déplacés');
  eq(two.positions.length, 2, '…et deux positions rendues');
  near(two.positions[1][0], drag(-30, E)[0],
    '⚠ positions[k] correspond à moved[k] : c’est le contrat d’écriture du viewer', 1e-9);
  near(two.positions[1][2], drag(-30, E)[2], '…coordonnée par coordonnée', 1e-9);
  near(len(two.positions[0], two.positions[1]), len(D, E),
    'la rotation est RIGIDE : la distance D–E est conservée à l’atome près', 1e-12);
  near(len(two.positions[0], B), len(D, B), '…et la distance de chaque atome à l’axe ne bouge pas', 1e-12);
  eq(two.flatPositions.length, 6, 'le tableau à plat porte trois nombres par atome déplacé');

  /* UNE COORDONNÉE MANQUANTE dans `moved` : le plan reste valable (D est bien dedans),
     mais le tableau à plat devient null — l'écriture est alors REFUSÉE plutôt que
     d'écrire un trou. */
  const holey = planTorsion({ points, moved: [D, null], request: { angleDeg: 60 } });
  eq(holey.ok, true, 'un atome sans coordonnées dans `moved` ne fait pas échouer le plan entier');
  eq(holey.movedCount, 1, '…seul l’atome réellement connu est compté comme déplacé');
  eq(holey.positions[1], null, '…et sa position est null (rien à écrire)');
  eq(holey.flatPositions, null, '⚠ le tableau à plat est null : le viewer ne peut PAS écrire un trou');

  /* HORS D'ATTEINTE : le plan est refusé, ET IL N'Y A RIEN À ÉCRIRE — c'est la différence
     entre « non » et « voici le plus près possible ». */
  const far = planTorsion({ points, moved: [D], request: { distance: 0.05 } });
  eq(far.ok, false, 'une distance impossible est refusée par le plan');
  eq(far.reason, 'unreachable', '…avec la raison du solveur');
  eq(far.movedCount, 0, '…rien n’a bougé');
  eq(far.positions, undefined, '…aucune position n’est proposée');
  eq(far.flatPositions, undefined, '…donc rien à écrire dans la structure');
  eq(far.targetDistance, 0.05, '…mais la cible refusée est rapportée');
  near(far.beforeDeg, 90, '…et le point de départ aussi (le panneau peut expliquer)', 1e-12);
  ok(far.solved && far.solved.tooFar === false, 'le rapport du solveur dit que le cercle reste trop loin');
  near(far.solved.closestDistance, 1, '…avec la distance du plus près possible (1 Å)', 1e-12);

  /* « APPLIQUER LA PLUS PROCHE » — c'est exactement ce que le panneau propose après un
     refus, et ça doit aboutir cette fois. */
  const closest = planTorsion({ points, moved: [D], request: { rotateByDeg: far.solved.closestDeltaDeg } });
  eq(closest.ok, true, 'la rotation du plus près s’applique, elle');
  near(closest.afterDistance, far.solved.closestDistance,
    '⚠ et la distance relue EST celle que le refus annonçait', 1e-9);
  near(closest.afterDeg, 0, '…le dihèdre correspondant vaut 0° ici', 1e-9);

  const tooFar = planTorsion({ points, moved: [D], request: { distance: 4 } });
  eq(tooFar.reason, 'unreachable', 'viser trop loin est refusé aussi');
  ok(tooFar.solved.tooFar === true, '…et le rapport distingue « trop loin » de « trop court »');
  near(tooFar.solved.closestDistance, Math.sqrt(5), '…avec la plus grande distance possible (√5)', 1e-12);
  const stretched = planTorsion({ points, moved: [D], request: { rotateByDeg: tooFar.solved.closestDeltaDeg } });
  near(stretched.afterDistance, Math.sqrt(5), '…que la rotation proposée atteint vraiment', 1e-9);
  near(stretched.afterDeg, 180, '…le dihèdre valant alors 180° (A et D à l’opposé)', 1e-9);

  /* LES REFUS DE FORME — chacun dit ce qui manque, et AUCUN ne rend de coordonnées. */
  const badPoints = planTorsion({ points: [A, B, C], moved: [D], request: { angleDeg: 0 } });
  eq(badPoints.reason, 'bad-points', 'trois atomes au lieu de quatre : refusé d’emblée');
  eq(badPoints.movedCount, 0, '…et rien n’a bougé');
  eq(badPoints.afterDeg, undefined, '…aucun état d’arrivée n’est annoncé');
  eq(planTorsion({ points: [A, B, C, [1, NaN, 1]], moved: [D], request: { angleDeg: 0 } }).reason, 'bad-points',
    'un atome aux coordonnées non finies est refusé pareil');

  const noAxis = planTorsion({ points: [A, B, B, D], moved: [D], request: { angleDeg: 0 } });
  eq(noAxis.reason, 'no-axis', 'deux atomes d’axe confondus : aucune torsion possible');
  eq(noAxis.beforeDeg, null, '…et le rapport l’avoue au lieu d’inventer un dihèdre');
  near(noAxis.beforeDistance, Math.sqrt(3), '…tout en disant à quelle distance sont A et D', 1e-12);
  const noDih = planTorsion({ points: [[2, 0, 0], B, C, D], moved: [D], request: { angleDeg: 0 } });
  eq(noDih.reason, 'no-dihedral', 'A aligné sur l’axe : le dihèdre de départ n’existe pas, donc rien à viser');
  eq(noDih.beforeDeg, null, '…et le rapport le dit');
  eq(noDih.afterDeg, undefined, '…sans prétendre à un état d’arrivée');

  for (const request of [undefined, {}, { angleDeg: null }, { angleDeg: 'x' }, { rotateByDeg: NaN }, { distance: NaN }]) {
    const r = planTorsion({ points, moved: [D], request });
    eq(r.reason, 'no-request', `aucune demande exploitable dans ${JSON.stringify(request)} : refusé`);
    eq(r.afterDeg, undefined, '…et rien n’est annoncé comme fait');
  }

  for (const moved of [undefined, [], [[9, 9, 9]], [A, B, C]]) {
    const r = planTorsion({ points, moved, request: { angleDeg: 60 } });
    eq(r.reason, 'moving-not-covered',
      `⚠ D doit être DANS les atomes à tourner, sinon le rapport décrirait un geste absent : ${JSON.stringify(moved)}`);
    eq(r.positions, undefined, '…et aucune coordonnée n’est proposée');
    eq(r.movedCount, 0, '…rien ne serait écrit');
  }
}
/* ── 5. LE PANNEAU — LE SEUL CHEMIN D'ÉCRITURE, LE ↺, ET CHAQUE RAISON TRADUITE ──────
   Les fonctions du panneau sont EXTRAITES DU VIEWER TELLES QUELLES (jamais réécrites :
   c'est le code de l'écran qui doit parler) puis EXÉCUTÉES ici, sur une structure
   minimale qui lit et écrit trois nombres par atome — la même surface que NGL (§6
   emploie la vraie). Ce qui est mesuré : un plan refusé n'écrit RIEN, un plan accepté
   écrit EXACTEMENT les atomes du côté de D par le même `positionFromArray` +
   `updateRepresentations({ position: true })` qu'un glisser, le ↺ remet la structure
   entière sur les coordonnées d'AVANT, et chaque `reason` du module a sa phrase —
   aucune n'est inventée par le panneau. */
const outFrom = (src, names) => new Function(`${src}\nreturn { ${names.join(', ')} };`)();
/** La phrase d'un refus s'écrit `(reason) => ({ … }[reason] || '…')` : ses accolades sont
 *  celles d'un OBJET, pas d'un corps — `sliceFn` s'y arrêterait trop tôt. Ici l'instruction
 *  est prise entière, parenthèses ET accolades comptées jusqu'au `;` final. */
const sliceExpr = (marker) => {
  const at = VIEW.indexOf(marker);
  assert.ok(at >= 0, `introuvable dans le viewer : ${marker}`);
  let par = 0; let bra = 0;
  for (let i = at + marker.length; i < VIEW.length; i++) {
    const ch = VIEW[i];
    if (ch === '(') par += 1;
    else if (ch === ')') par -= 1;
    else if (ch === '{') bra += 1;
    else if (ch === '}') bra -= 1;
    else if (ch === ';' && par <= 0 && bra <= 0) return VIEW.slice(at, i + 1);
  }
  throw new Error(`instruction non terminée dans le viewer : ${marker}`);
};
const PanelFns = outFrom(
  `${lineOf('const torsionQuadName = (slots) =>')}\n`
  + `${lineOf('const torsionDeg = (v) =>')}\n`
  + `${lineOf('const torsionAng = (v) =>')}\n`
  + `${sliceExpr('const torsionWhy = (reason) => (')}\n`
  + `${sliceFn('const torsionReportOf = (slots, plan) => {')}\n`
  + `${sliceFn('const torsionPointsOf = (structure, idxs) => {')}\n`
  + `${sliceFn('const torsionSnapshotOf = (structure) => {')}\n`,
  ['torsionQuadName', 'torsionDeg', 'torsionAng', 'torsionWhy', 'torsionReportOf',
    'torsionPointsOf', 'torsionSnapshotOf'],
);

/** LA STRUCTURE MINIMALE que ces fonctions savent lire et écrire : un AtomProxy qui
 *  rend trois nombres par atome et les reçoit au même endroit — et qui NOTE chaque
 *  écriture (quel atome, à quel décalage du tableau à plat), pour vérifier que le
 *  plan tombe sur les bons atomes. */
const fakeStructure = (coords) => {
  const store = Float32Array.from(coords);
  const writes = [];
  const ap = {
    index: 0,
    get x() { return store[this.index * 3]; },
    get y() { return store[this.index * 3 + 1]; },
    get z() { return store[this.index * 3 + 2]; },
    positionFromArray(flat, off) {
      writes.push({ index: this.index, off });
      store[this.index * 3] = flat[off];
      store[this.index * 3 + 1] = flat[off + 1];
      store[this.index * 3 + 2] = flat[off + 2];
    },
  };
  return { store, writes, atomStore: { count: store.length / 3 }, getAtomProxy: () => ap };
};

/* LES DIX FONCTIONS DU PANNEAU, avec leurs vraies dépendances injectées : les
   compteurs de redessin sont des stubs (ce qui est mesuré, c'est COMBIEN de fois et
   POUR QUOI elles sont appelées), l'état du panneau est un objet à la forme d'une
   référence React (mêmes lectures/écritures que dans le composant). */
const Panel = (() => {
  const msgs = [];
  const closest = [];
  const updates = [];
  const scene = { plates: 0, repaints: 0 };
  const partMoveRef = { current: new Map() };
  const componentRef = { current: null };
  const torsionUndoRef = { current: null };
  /* L'ANIMATION DU ⚒ — un stub qui COMPTE : ce que la sonde mesure, c'est qu'une
     torsion appliquée termine d'abord le geste en cours (deux écritures de
     coordonnées en même temps se recouvriraient). */
  const playbackFinishes = [];
  const finishRelaxPlayback = () => { playbackFinishes.push(1); return true; };
  const setTorsionMsg = (m) => { msgs.push(m); };
  const setTorsionClosest = (c) => { closest.push(c); };
  const writeStructurePositions = new Function(
    'refreshScenePlates', 'requestSceneRepaint',
    `${sliceFn('const writeStructurePositions = (comp, idxs, flat) => {')}\nreturn writeStructurePositions;`,
  )(() => { scene.plates += 1; }, () => { scene.repaints += 1; });
  const structureWasDragged = new Function(
    'partMoveRef', 'isIdentityMove',
    `${sliceFn('const structureWasDragged = (structure) => {')}\nreturn structureWasDragged;`,
  )(partMoveRef, isIdentityMove);
  const commitTorsion = new Function(
    'torsionSnapshotOf', 'writeStructurePositions', 'torsionWhy', 'torsionReportOf',
    'torsionDeg', 'torsionAng', 'structureWasDragged', 'setTorsionMsg', 'setTorsionClosest',
    'torsionUndoRef', 'finishRelaxPlayback',
    `${sliceFn('const commitTorsion = (r, plan, label) => {')}\nreturn commitTorsion;`,
  )(PanelFns.torsionSnapshotOf, writeStructurePositions, PanelFns.torsionWhy,
    PanelFns.torsionReportOf, PanelFns.torsionDeg, PanelFns.torsionAng, structureWasDragged,
    setTorsionMsg, setTorsionClosest, torsionUndoRef, finishRelaxPlayback);
  const undoLastTorsion = new Function(
    'componentRef', 'torsionUndoRef', 'setTorsionMsg', 'setTorsionClosest',
    'writeStructurePositions', 'finishRelaxPlayback',
    `${sliceFn('const undoLastTorsion = () => {')}\nreturn undoLastTorsion;`,
  )(componentRef, torsionUndoRef, setTorsionMsg, setTorsionClosest, writeStructurePositions,
    finishRelaxPlayback);
  const compFor = (structure) => ({
    structure,
    updateRepresentations(opts) { updates.push(opts); },
  });
  return {
    msgs, closest, updates, scene, partMoveRef, componentRef, torsionUndoRef,
    writeStructurePositions, structureWasDragged, commitTorsion, undoLastTorsion, compFor,
    playbackFinishes,
  };
})();



{
  /* ── a) CHAQUE REFUS DU MODULE A SA PHRASE — ET LE PANNEAU N'EN INVENTE AUCUNE ──── */
  const whySrc = sliceExpr('const torsionWhy = (reason) => (');
  const said = [...whySrc.matchAll(/'([a-z]+(?:-[a-z]+)*)':/g)].map((m) => m[1]);
  /* Les raisons que le module rend VRAIMENT : celles qu'il écrit (`reason: '…'`) et
     celles de ses deux refus nommés (`no('ring')`, …). « ok » n'est pas un refus. */
  const moduleReasons = [...new Set([
    ...[...MODULE.matchAll(/reason:\s*'([a-z-]+)'/g)].map((m) => m[1]),
    ...[...MODULE.matchAll(/\bno\('([a-z-]+)'\)/g)].map((m) => m[1]),
  ])].filter((r) => r !== 'ok');
  ok(moduleReasons.length >= 12, `le module refuse pour ${moduleReasons.length} raisons différentes`);
  eq(moduleReasons.filter((r) => !said.includes(r)), [],
    '⚠ chaque refus du module est traduit : aucune raison ne tombe dans la phrase générique');
  eq(said.filter((k) => !moduleReasons.includes(k)), [],
    '⚠ et le panneau n’invente aucun diagnostic que le module ne rend jamais');
  const generic = PanelFns.torsionWhy('___jamais___');
  eq(generic, 'the torsion could not be applied', 'la phrase de repli reste générique (elle n’accuse personne)');
  for (const r of said) {
    const phrase = PanelFns.torsionWhy(r);
    ok(typeof phrase === 'string' && phrase.length > 20 && phrase !== generic,
      `« ${r} » a sa propre phrase : ${phrase.slice(0, 46)}…`);
  }
  ok(said.includes('unreachable') && said.includes('ring') && said.includes('distance-fixed'),
    'les refus que le panneau met en avant (hors d’atteinte, cycle, distance insensible) sont bien là');
  hasIn(PanelFns.torsionWhy('ring'), 'STILL LINKED another way round',
    'la phrase du refus « ring » dit le fait mesurable — B et C restent liés autrement — et pas seulement « un cycle »');
  hasIn(PanelFns.torsionWhy('ring'), 'not bonded are not an axle',
    '…car le module rend cette raison AUSSI quand l’axe n’est pas une liaison du tout');
  hasIn(PanelFns.torsionWhy('reference-moves'), 'pick a reference atom on the other side of the axle',
    '…et le refus « la référence tourne » dit quoi faire : choisir A de l’autre côté');
  ok(!/torsionWhy\('/.test(VIEW),
    'aucun appel de torsionWhy avec un littéral : les raisons viennent du module, jamais d’une devinette locale');

  /* ── b) UN SEUL CHEMIN D'ÉCRITURE — celui d'un glisser de molécule ──────────────── */
  const times = (src, needle) => src.split(needle).length - 1;
  const writeSrc = sliceFn('const writeStructurePositions = (comp, idxs, flat) => {');
  eq(times(writeSrc, 'positionFromArray'), 1, 'un atome écrit sa position par UN appel, atome par atome');
  eq(times(writeSrc, 'updateRepresentations({ position: true })'), 1,
    '…et la structure est prévenue UNE fois, exactement comme un glisser');
  eq(times(writeSrc, 'refreshScenePlates()'), 1, '…les plaques suivent les coordonnées');
  eq(times(writeSrc, 'requestSceneRepaint()'), 1, '…et la scène se repeint une fois');
  hasIn(writeSrc, 'if (!structure || !idxs || !idxs.length || !flat) return false;',
    'une écriture sans structure, sans atome ou sans coordonnées est refusée d’emblée');
  hasIn(writeSrc, 'catch { return false; }',
    'et si NGL refuse les coordonnées, l’appelant l’apprend (false) au lieu de croire au geste');
  const commitSrc = sliceFn('const commitTorsion = (r, plan, label) => {');
  eq(times(commitSrc, 'writeStructurePositions('), 1, 'commitTorsion n’écrit que par ce chemin');
  ok(times(commitSrc, 'finishRelaxPlayback();') === 1,
    '⚠ …et il TERMINE d’abord l’animation du ⚒ : deux gestes n’écrivent jamais les mêmes coordonnées en même temps');
  ok(commitSrc.indexOf('torsionSnapshotOf(r.structure)') < commitSrc.indexOf('writeStructurePositions('),
    '⚠ l’AVANT est photographié AVANT d’écrire : c’est ce que le ↺ remettra');
  ok(commitSrc.indexOf('if (!plan.ok)') < commitSrc.indexOf('writeStructurePositions(')
    && commitSrc.indexOf('if (!plan.flatPositions)') < commitSrc.indexOf('writeStructurePositions('),
    'un plan refusé — ou sans coordonnées — sort AVANT toute écriture : rien n’est touché');
  const undoSrc = sliceFn('const undoLastTorsion = () => {');
  hasIn(undoSrc, 'writeStructurePositions(comp, idxs, rec.flat)', 'le ↺ écrit par le MÊME chemin que le geste');
  ok(times(undoSrc, 'finishRelaxPlayback();') === 1,
    '⚠ …et il TERMINE d’abord l’animation du ⚒ : le ↺ pendant qu’un construit se joue vaut annulation');
  hasIn(undoSrc, 'for (let i = 0; i < rec.count; i++) idxs.push(i);',
    '…atome par atome : TOUTE la structure d’avant, pas seulement le côté de D');
  hasIn(undoSrc, 'torsionUndoRef.current = null;', '…puis il oublie la torsion défaite (un seul ↺ possible)');
  for (const fn of ['const applyTorsionAngle = () => {', 'const applyTorsionDistance = () => {',
    'const applyClosestTorsion = () => {']) {
    const src = sliceFn(fn);
    ok(src.includes('commitTorsion('), `${fn} applique par commitTorsion`);
    ok(!src.includes('positionFromArray') && !src.includes('updateRepresentations'),
      `${fn} n’écrit jamais de coordonnées lui-même — un seul chemin d’écriture dans tout le panneau`);
  }
}

{
  /* ── c) LE PANNEAU EST BRANCHÉ — les champs, les boutons, le ↳, le ↺, le 🎯 ─────── */
  const panelSrc = VIEW.slice(
    VIEW.indexOf('✏️ Torsion — METTRE UN DIHÈDRE'),
    VIEW.indexOf('⚡ ESP — the electrostatic-potential surface'),
  );
  ok(panelSrc.length > 2000, `le panneau ✏️ Torsion est bien dans le viewer (${panelSrc.length} caractères)`);
  hasIn(panelSrc, 'onClick={() => setShowTorsionPanel((v) => !v)}', 'le panneau s’ouvre et se ferme par son bouton');
  hasIn(panelSrc, 'value={torsionAngleDraft}', 'le champ « dihedral » lit le brouillon de l’angle');
  hasIn(panelSrc, 'onChange={(e) => setTorsionAngleText(e.target.value)}',
    '⚠ une frappe passe par le writer du brouillon (référence + state) : l’écoute du clic 3D, posée une fois, lit la valeur COURANTE');
  eq(VIEW.split('setTorsionAngleDraft(').length - 1, 1,
    '…et ce writer est le SEUL à écrire le brouillon de l’angle');
  hasIn(VIEW, 'if (!torsionAngleDraftRef.current && Number.isFinite(deg)) setTorsionAngleText(String(Math.round(deg * 10) / 10));',
    'la 4ᵉ sélection propose le dihèdre ACTUEL dans le champ, s’il est vide (sinon elle respecte ce qui est tapé)');
  hasIn(panelSrc, "onKeyDown={(e) => { if (e.key === 'Enter') applyTorsionAngle(); }}",
    '↵ sur le champ de l’angle applique la torsion');
  hasIn(panelSrc, "onKeyDown={(e) => { if (e.key === 'Enter') applyTorsionDistance(); }}",
    '↵ sur le champ de la distance aussi');
  hasIn(panelSrc, 'onClick={applyTorsionAngle}', '…et le bouton Set passe par le même chemin');
  hasIn(panelSrc, 'onClick={applyTorsionDistance}', '…et Reach de même');
  hasIn(panelSrc, 'aria-label="Target dihedral A–B–C–D, in degrees"', 'le champ de l’angle dit ce qu’il attend');
  hasIn(panelSrc, 'aria-label="Target distance A–D, in ångströms"', '…et celui de la distance');
  hasIn(panelSrc, 'min="-180" max="180"', 'l’angle est borné à la fenêtre d’un dihèdre');
  hasIn(panelSrc, 'min="0.01"', '…et la distance ne descend pas sous zéro');
  hasIn(panelSrc, '{torsionClosest && (', 'le bouton ↳ n’apparaît QUE quand le module a proposé un plus-près-possible');
  hasIn(panelSrc, 'onClick={applyClosestTorsion}', '…et il applique la rotation que le refus a annoncée');
  hasIn(panelSrc, '↳ Apply closest ({torsionAng(torsionClosest.closest)})', '…en montrant la distance qu’il atteindra');
  hasIn(panelSrc, 'onClick={undoLastTorsion}', 'le ↺ est branché sur le défaiseur du geste');
  hasIn(panelSrc, '/^[✓↳↺]/.test(torsionMsg)',
    'la couleur du message suit son préfixe : ✓ / ↳ / ↺ verts, ✕ rouge — jamais l’inverse');
  hasIn(panelSrc, 'if (measureModeRef.current) toggleMeasureMode();',
    'piquer une torsion DÉSARME 📏 Measure : les deux gestes ne peuvent pas prendre les clics ensemble');
  hasIn(panelSrc, '✏️ Torsion{torsionAtoms.length ?', 'le bouton du groupe ✏️ Modify compte les atomes piqués');
  hasIn(panelSrc, '` (${torsionAtoms.length}/4)`', '…en montrant « (2/4) » dès que deux sont piqués');
  hasIn(panelSrc, 'const dragged = part.ok ? structureWasDragged(part.structure) : false;',
    'le panneau regarde, à chaque rendu, si ce molécules a aussi été GLISSÉE à la main');
  hasIn(panelSrc, '⚠ This molecule has also been DRAGGED by hand',
    '…et il le dit AVANT le geste, pas après (le ⏮ rejouerait ce glissement)');
  hasIn(panelSrc, '⚠ A torsion is not stored anywhere',
    '…et il dit aussi qu’une torsion ne vit que dans les coordonnées de l’image affichée');
}

{
  /* ── d) LE GESTE, EXÉCUTÉ : ce qui est écrit, et ce qui ne l'est JAMAIS ────────── */
  const A = [0, 1, 0]; const B = [0, 0, 0]; const C = [1, 0, 0]; const D = [1, 0, 1]; const E = [1, 0, 2];
  const coords = [...A, ...B, ...C, ...D, ...E];       // A · B · C · D + un atome E du côté de D
  const structure = fakeStructure(coords);
  const comp = Panel.compFor(structure);
  const at = (i) => [structure.store[i * 3], structure.store[i * 3 + 1], structure.store[i * 3 + 2]];
  const r = {
    ok: true, comp, structure, points: [A, B, C, D], idx: [0, 1, 2, 3], moved: [3, 4],
    slots: [{ label: 'C1' }, { label: 'C2' }, { label: 'C3' }, { label: 'C4' }],
  };
  const plan = planTorsion({ points: [A, B, C, D], moved: [D, E], request: { angleDeg: 0 } });
  eq(plan.ok, true, 'le plan d’une torsion à 0° est accepté');
  near(plan.beforeDeg, 90, '…le dihèdre de départ est celui de la convention (90°)', 1e-9);
  near(plan.afterDeg, 0, '…et il vise exactement 0°', 1e-9);
  eq(plan.movedCount, 2, '…avec DEUX atomes dans le côté de D');

  const reset = () => {
    Panel.msgs.length = 0; Panel.updates.length = 0; Panel.closest.length = 0;
    Panel.scene.plates = 0; Panel.scene.repaints = 0; structure.writes.length = 0;
    Panel.playbackFinishes.length = 0;
  };
  reset();
  eq(Panel.commitTorsion(r, plan, 'dihedral 0.0°'), true, 'commitTorsion applique le plan');
  eq(Panel.playbackFinishes.length, 1,
    '…après avoir TERMINÉ l’animation du ⚒ (un seul chemin d’écriture à la fois)');
  eq(structure.writes.map((w) => w.index), [3, 4],
    '⚠ il écrit EXACTEMENT les atomes du côté de D, dans l’ordre du plan — rien d’autre');
  eq(structure.writes.map((w) => w.off), [0, 3],
    '…chaque atome prenant ses trois nombres à sa place dans le tableau à plat');
  eq(Panel.updates, [{ position: true }], '…et la structure reçoit UNE demande de redessin, pour la position');
  eq(Panel.scene.plates, 1, '…les plaques ont suivi une fois');
  eq(Panel.scene.repaints, 1, '…la scène s’est repeinte une fois');
  eq(Array.from(structure.store.slice(0, 9)), coords.slice(0, 9), 'A, B et C n’ont pas bougé d’un chiffre');
  eq(Array.from(structure.store.slice(9)), Array.from(plan.flatPositions),
    '…et D et E portent EXACTEMENT les positions du plan');
  near(dihedralDeg(at(0), at(1), at(2), at(3)), 0,
    '⚠ la structure RELUE porte bien le dihèdre demandé (c’est un lecteur, pas le plan, qui le dit)', 1e-9);
  const msg = Panel.msgs[0];
  ok(/^[✓↳↺]/.test(msg), 'le rapport commence par ✓ : le panneau le colore en vert');
  hasIn(msg, '✓ C1 — C2 — C3 — C4 :', '…il nomme les quatre atomes piqués');
  hasIn(msg, `${PanelFns.torsionDeg(plan.beforeDeg)} → ${PanelFns.torsionDeg(plan.afterDeg)}`,
    '…et donne dihèdre avant → après');
  hasIn(msg, PanelFns.torsionAng(plan.afterDistance),
    '⚠ les nombres du rapport viennent du module (relus après rotation), pas du champ tapé');
  hasIn(msg, '2 atoms turned', '…et il dit combien d’atomes ont tourné');
  eq(Panel.closest[0], null, 'aucun « plus près possible » à proposer sur un succès');
  eq(Panel.torsionUndoRef.current.count, 5,
    '⚠ le ↺ a gardé les CINQ atomes de la structure, pas seulement ceux qui ont tourné');
  eq(Array.from(Panel.torsionUndoRef.current.flat), coords, '…sur les coordonnées d’AVANT, au chiffre près');
  eq(Panel.torsionUndoRef.current.label, 'dihedral 0.0°', '…avec le libellé du geste, pour le message du ↺');
  eq(Panel.torsionUndoRef.current.comp, comp, '…et la molécule concernée');
  const afterFirst = Array.from(structure.store);

  /* ── LES REFUS N'ÉCRIVENT RIEN — chacun avec SA phrase du module ────────────────── */
  const points2 = [at(0), at(1), at(2), at(3)];
  const moved2 = [at(3), at(4)];
  const far = planTorsion({ points: points2, moved: moved2, request: { distance: 0.2 } });
  eq(far.ok, false, 'viser 0.2 Å est refusé sur cette géométrie (le cercle de D n’y descend pas)');
  eq(far.reason, 'unreachable', '…pour cercle hors d’atteinte');
  reset();
  eq(Panel.commitTorsion({ ...r, points: points2 }, far, 'A–D 0.20 Å'), false, '…et le panneau refuse le geste');
  eq(structure.writes.length, 0, '⚠ AUCUNE coordonnée n’a été écrite');
  eq(Panel.updates.length, 0, '…ni aucune demande de redessin');
  eq(Panel.scene.plates + Panel.scene.repaints, 0, '…ni plaque ni repeint : un refus ne touche pas l’écran');
  eq(Array.from(structure.store), afterFirst, '…les coordonnées sont celles d’avant, au chiffre près');
  const refusal = Panel.msgs[0];
  ok(/^✕/.test(refusal), 'le refus commence par ✕ : le panneau le colore en rouge');
  hasIn(refusal, PanelFns.torsionWhy('unreachable'), '…avec la phrase du module — pas un diagnostic inventé');
  hasIn(refusal, 'Turning the bond brings the two atoms within', '…le plus-près-possible est chiffré');
  hasIn(refusal, 'they cannot be brought closer', '…en disant de quel côté le cercle bloque');
  hasIn(refusal, PanelFns.torsionDeg(far.solved.closestDeltaDeg), '…avec la rotation qui approcherait le plus');
  const proposal = Panel.closest[0];
  eq(proposal.deltaDeg, far.solved.closestDeltaDeg, 'le bouton ↳ reçoit EXACTEMENT la rotation du rapport');
  eq(proposal.closest, far.solved.closestDistance, '…et la distance qu’elle atteindra');
  eq(proposal.target, far.targetDistance, '…et la cible refusée, pour le libellé du bouton');
  eq(Panel.torsionUndoRef.current.label, 'dihedral 0.0°', '…et l’AVANT du dernier geste réussi reste intact');

  /* Les autres refus qui ne doivent RIEN écrire non plus. */
  const holey = {
    ok: true, flatPositions: null, movedCount: 1, beforeDeg: 0, afterDeg: 0, deltaDeg: 0,
    beforeDistance: 1, afterDistance: 1, targetDistance: null, solved: null,
  };
  reset();
  eq(Panel.commitTorsion(r, holey, 'x'), false, 'un plan accepté mais SANS tableau à plat est refusé');
  hasIn(Panel.msgs[0], 'could not be built', '…en disant que les coordonnées n’ont pas pu être construites');
  const noReq = planTorsion({ points: points2, moved: moved2, request: {} });
  eq(noReq.reason, 'no-request', 'sans angle ni distance, le module refuse pour « aucune demande »');
  reset();
  eq(Panel.commitTorsion(r, noReq, 'x'), false, '…et rien n’est écrit');
  eq(structure.writes.length, 0, '…aucune coordonnée');
  hasIn(Panel.msgs[0], PanelFns.torsionWhy('no-request'), '…avec la phrase du module');
  reset();
  eq(Panel.commitTorsion(r, null, 'x'), false, 'un plan absent est refusé');
  eq(Panel.msgs[0], '✕ The torsion could not be planned — nothing was changed.', '…avec sa propre phrase');
  reset();
  eq(Panel.commitTorsion({ ok: false, say: 'Pick the four atoms first — 2 still to go (A · B · C · D).' }, plan, 'x'),
    false, 'des choix incomplets : la phrase de torsionPicks est reprise TELLE QUELLE');
  hasIn(Panel.msgs[0], 'Pick the four atoms first', '…sans être reformulée (une seule source de vérité)');
  reset();
  const broken = { structure: { atomStore: { count: 5 }, updateRepresentations() {} } };
  eq(Panel.commitTorsion({ ...r, comp: broken }, plan, 'x'), false,
    'une structure qui ne sait plus écrire ses atomes est refusée');
  hasIn(Panel.msgs[0], 'refused the new coordinates', '…et l’appelant le dit, au lieu de croire au geste');
  eq(Panel.closest[0], null, 'aucun « plus près possible » n’est proposé quand le refus n’est pas chiffré');
  eq(structure.writes.length, 0, '⚠ après tous ces refus, toujours AUCUNE écriture');
  eq(Array.from(structure.store), afterFirst, '…et la molécule est intacte');
  eq(Panel.torsionUndoRef.current.label, 'dihedral 0.0°', '…tandis que l’AVANT du geste réussi attend toujours son ↺');

  /* ── LE GLISSER DÉJÀ FAIT EST ANNONCÉ — jamais découvert après un ⏮ ─────────────── */
  const KEY = 'A|0|1-1|BUT|5';
  const still = partMoveIdentity(KEY, [0, 0, 0]);
  Panel.partMoveRef.current = new Map([[KEY, { ...still, structure }]]);
  eq(Panel.structureWasDragged(structure), false, 'un mouvement À L’ARRÊT ne compte pas comme un glisser à la main');
  const slid = slidePartMove(still, [0.4, 0, 0]);
  Panel.partMoveRef.current = new Map([[KEY, { ...slid, structure }]]);
  eq(Panel.structureWasDragged(structure), true, '…mais un vrai glissement, oui');
  Panel.partMoveRef.current = new Map([[KEY, { ...slid, structure: fakeStructure(coords) }]]);
  eq(Panel.structureWasDragged(structure), false, '…et le glissement d’une AUTRE molécule n’est pas le sien');
  const plan2 = planTorsion({ points: points2, moved: moved2, request: { angleDeg: 120 } });
  eq(plan2.ok, true, 'un second plan (120°) est accepté sur la géométrie courante');
  Panel.partMoveRef.current = new Map([[KEY, { ...slid, structure }]]);
  reset();
  eq(Panel.commitTorsion({ ...r, points: points2 }, plan2, 'dihedral 120.0°'), true, '…et il s’applique');
  hasIn(Panel.msgs[0], '⚠ this molecule had also been DRAGGED by hand',
    '⚠ le rapport DIT que cette molécule a aussi été glissée : rejouer le film remettrait son placement');
  hasIn(Panel.msgs[0], 'the same ✏️ Torsion gesture is always there to redo this.',
    '…et il dit comment refaire la torsion, au lieu de laisser croire qu’elle est perdue');
  const afterSecond = Array.from(structure.store);

  /* ── e) LE ↺ REND LA STRUCTURE ENTIÈRE — et ne se trompe jamais de molécule ─────── */
  Panel.partMoveRef.current = new Map();
  Panel.componentRef.current = comp;
  reset();
  Panel.undoLastTorsion();
  eq(structure.writes.map((w) => w.index), [0, 1, 2, 3, 4], '…en réécrivant TOUS les atomes, dans l’ordre');
  eq(structure.writes.map((w) => w.off), [0, 3, 6, 9, 12], '…chacun à sa place dans le tableau à plat');
  eq(Array.from(structure.store), afterFirst,
    '⚠ la molécule est revenue EXACTEMENT sur les coordonnées d’avant le geste (pas à ±float)');
  eq(Panel.updates, [{ position: true }], '…avec une seule demande de redessin');
  eq(Panel.scene.plates, 1, '…et les plaques ont suivi');
  hasIn(Panel.msgs[0], '↺ dihedral 120.0°', 'le message nomme le geste défait');
  hasIn(Panel.msgs[0], 'every atom is back exactly where it was before it',
    '…et dit que la structure est entièrement revenue');
  ok(/^↺/.test(Panel.msgs[0]), '…avec le préfixe ↺ que le panneau colore en vert');
  eq(Panel.torsionUndoRef.current, null, '…et le ↺ est consommé : on ne défait pas deux fois le même geste');
  eq(Panel.closest[0], null, '…et le « plus près possible » du geste défait n’est plus proposé');
  reset();
  Panel.undoLastTorsion();
  eq(structure.writes.length, 0, '…et n’écrit rien du tout');
  eq(Panel.msgs[0], '↺ Nothing to undo — no torsion has been applied from this panel yet.', '…il le dit simplement');
  /* LE ↺ NE DÉFAIT PAS CE QUI EST À L'ÉCRAN SI L'ÉCRAN A CHANGÉ DE MOLÉCULE */
  reset();
  eq(Panel.commitTorsion({ ...r, points: points2 }, plan2, 'dihedral 120.0°'), true, 'une torsion de plus est appliquée');
  Panel.componentRef.current = Panel.compFor(fakeStructure(coords));
  reset();
  Panel.undoLastTorsion();
  eq(structure.writes.length, 0, '⚠ aucune coordonnée n’a été écrite dans la mauvaise molécule');
  hasIn(Panel.msgs[0], 'no longer the one on screen',
    '…et il explique pourquoi, au lieu de remettre les coordonnées au hasard');
  eq(Panel.torsionUndoRef.current.label, 'dihedral 120.0°', '…la torsion recordée attend un ↺ possible sur la bonne molécule');
  Panel.componentRef.current = comp;
  reset();
  Panel.undoLastTorsion();
  /* ⚠ Ce geste-là a été appliqué SUR l'état que le ↺ de (e) venait de rendre : le ↺ doit
     donc rendre EXACTEMENT ce point de départ (les coordonnées d'après le geste à 0°), et
     non un état intermédiaire deviné. */
  eq(Array.from(structure.store), afterFirst,
    '…en restaurant les coordonnées d’avant ce dernier geste — l’état exact d’où il est parti');
  ok(Array.from(structure.store).some((v, k) => v !== afterSecond[k]),
    '⚠ …et ces coordonnées ne sont PAS celles du geste défait : le ↺ a donc bien défait quelque chose');
  ok(Panel.msgs[0].startsWith('↺'), 'avec son message ↺');
  eq(Panel.torsionUndoRef.current, null, 'et le journal est vide de nouveau');
  Panel.componentRef.current = null;
}

/* ── 6. SUR UNE VRAIE STRUCTURE NGL ──────────────────────────────────────────────
   Tout ce qui précède tourne sur des structures minimales écrites à la main. Ici, la
   chaîne ENTIÈRE : un pentane PDB parsé par NGL (ses liaisons viennent du fichier lui-
   même), les quatre atomes lus par AtomProxy, le plan écrit par le MÊME
   `writeStructurePositions` que le geste du panneau, puis RELU atome par atome, exporté
   en PDB et défait par le ↺. C'est ce que fait l'écran, sans souris. */
{
  const require = createRequire(import.meta.url);
  const NGL = require('ngl');
  /* NGL lit les fichiers par un Blob : dans un navigateur FileReader existe, en Node non. */
  if (typeof globalThis.FileReader !== 'function') {
    globalThis.FileReader = class {
      readAsText(blob) {
        Promise.resolve(blob.text()).then((text) => {
          this.result = text;
          if (typeof this.onload === 'function') this.onload({ target: this });
        });
      }
    };
  }
  ok(typeof NGL.autoLoad === 'function' && typeof NGL.PdbWriter === 'function',
    'NGL sait parser un PDB et en réécrire un : la sonde peut comparer l’écran et le fichier');

  /** Une ligne PDB aux colonnes que NGL lit (gabarit des sondes du dossier). */
  const pdbAtom = (serial, name, [x, y, z]) => `HETATM${String(serial).padStart(5)}  ${name.padEnd(4)}PEN A   1`
    + `${x.toFixed(3).padStart(12)}${y.toFixed(3).padStart(8)}${z.toFixed(3).padStart(8)}  1.00  0.00           C`;
  /* UN PENTANE : la chaîne porte un atome de PLUS que les quatre piqués (C5). Sans lui,
     « le côté de D » et « D tout seul » seraient indiscernables. */
  const FILE = [
    pdbAtom(1, 'C1', [-0.510, 1.200, 0.800]),
    pdbAtom(2, 'C2', [0.000, 0.000, 0.000]),
    pdbAtom(3, 'C3', [1.530, 0.000, 0.000]),
    pdbAtom(4, 'C4', [2.040, -1.445, 0.000]),
    pdbAtom(5, 'C5', [1.600, -2.300, 1.200]),
    'CONECT    1    2', 'CONECT    2    1    3', 'CONECT    3    2    4',
    'CONECT    4    3    5', 'CONECT    5    4', 'END',
  ].join('\n');
  const structure = await NGL.autoLoad(new Blob([FILE], { type: 'text/plain' }), { ext: 'pdb' });
  eq(structure.atomCount, 5, 'les cinq atomes du fichier sont là');
  eq(structure.bondStore.count, 4,
    '⚠ ses QUATRE liaisons viennent du fichier (CONECT) — jamais d’une distance devinée ici');

  /* LE GRAPHE LU PAR LE PANNEAU — la fonction du viewer elle-même, extraite et exécutée. */
  const neighboursOf = new Function(
    `${sliceFn('const torsionNeighboursOf = (structure) => {')}\nreturn torsionNeighboursOf;`,
  )();
  const nb = neighboursOf(structure);
  eq([...nb(0)].sort((a, b) => a - b), [1], 'le graphe donne à C1 son seul voisin, C2');
  eq([...nb(2)].sort((a, b) => a - b), [1, 3], '…et à C3 ses deux voisins — les deux atomes de l’axe');
  eq([...nb(4)].sort((a, b) => a - b), [3], '…et à C5 son seul voisin, C4');

  const ap = structure.getAtomProxy();
  const at = (i) => { ap.index = i; return [ap.x, ap.y, ap.z]; };
  const nameOf = (i) => { ap.index = i; return ap.atomname; };
  const readAll = () => [0, 1, 2, 3, 4].map((i) => at(i));
  const idx = [0, 1, 2, 3];                                   // A · B · C · D = C1 · C2 · C3 · C4
  const origins = idx.map((i) => at(i));
  const filePositions = readAll();
  eq(nameOf(0), 'C1', 'un atome se nomme comme le fichier le nomme (le rapport le redira)');
  near(distanceOf(filePositions[0], filePositions[1]), Math.hypot(-0.51, 1.2, 0.8),
    'la liaison C1–C2 relue par AtomProxy est bien celle du fichier', 1e-3);
  const beforeDeg = dihedralDeg(origins[0], origins[1], origins[2], origins[3]);
  ok(Number.isFinite(beforeDeg) && Math.abs(beforeDeg) > 5 && Math.abs(beforeDeg) < 175,
    `le fichier porte un VRAI dihèdre (${beforeDeg.toFixed(2)}°) : ni plat, ni dans un cas limite`);

  /* ── LE CÔTÉ QUI TOURNE, RÉSOLU PAR LE MODULE SUR LE GRAPHE DU FICHIER ─────────── */
  const side = movingSideOf({
    neighbours: nb, atomCount: structure.atomCount, axis: [idx[1], idx[2]], moving: idx[3], stay: idx[0],
  });
  eq(side.ok, true, 'l’axe C2–C3 est une vraie charnière : le côté de D existe');
  eq(side.moved, [3, 4], '⚠ le côté de D, c’est C4 ET C5 — c’est la structure qui le dit, pas une distance');
  const blind = movingSideOf({
    neighbours: () => [], atomCount: structure.atomCount, axis: [idx[1], idx[2]], moving: idx[3], stay: idx[0],
  });
  eq(blind.moved, [3], '…alors qu’un graphe VIDE (aucun voisin annoncé) n’aurait laissé tourner que C4 tout seul');

  /* ── LE GESTE PAR LE CHIFFRE, ÉCRIT PAR LE CHEMIN DU PANNEAU ───────────────────── */
  const comp = Panel.compFor(structure);
  const movedPoints = () => side.moved.map((i) => at(i));
  Panel.partMoveRef.current = new Map();
  const picks = {
    ok: true, comp, structure, idx, points: origins,
    slots: idx.map((i) => ({ comp, structure, atomIndex: i, label: nameOf(i) })),
  };
  const labelAngle = `dihedral ${PanelFns.torsionDeg(-60)}`;
  const plan = planTorsion({ points: origins, moved: movedPoints(), request: { angleDeg: -60 } });
  eq(plan.ok, true, 'viser −60° sur cette molécule est possible');
  eq(plan.movedCount, 2, '…le plan annonce les DEUX atomes qui tournent (C4 et C5)');
  const plates = Panel.scene.plates;
  Panel.msgs.length = 0;
  const updates0 = Panel.updates.length;
  eq(Panel.commitTorsion({ ...picks, moved: side.moved }, plan, labelAngle), true,
    'le panneau applique le plan — par commitTorsion, le chemin du bouton Set');
  eq(Panel.updates.slice(updates0), [{ position: true }],
    '…NGL reçoit UNE seule demande de redessin, pour la position');
  eq(Panel.scene.plates - plates, 1, '…et les plaques de la scène suivent les coordonnées');
  const afterAngle = readAll();
  eq(afterAngle.slice(0, 3), filePositions.slice(0, 3),
    'A, B et C n’ont pas bougé d’un chiffre : l’ancre et les deux atomes de l’axe');
  near(dihedralDeg(afterAngle[0], afterAngle[1], afterAngle[2], afterAngle[3]), -60,
    '⚠ LA MOLÉCULE RELUE porte le dihèdre demandé (TORSION_ANGLE_TOLERANCE_DEG)',
    TORSION_ANGLE_TOLERANCE_DEG);
  near(dihedralDeg(afterAngle[0], afterAngle[1], afterAngle[2], afterAngle[3]), plan.afterDeg,
    '…le dihèdre exact que le module a résolu', 1e-4);
  near(distanceOf(afterAngle[0], afterAngle[3]), plan.afterDistance,
    '…et la distance A–D que le module annonçait', TORSION_DISTANCE_TOLERANCE);
  for (const [i, tag] of [[3, 'C4'], [4, 'C5']]) {
    near(distanceOf(afterAngle[i], afterAngle[1]), distanceOf(filePositions[i], filePositions[1]),
      `la distance ${tag}–C2 (vers l’axe) est conservée`, 1e-3);
    near(distanceOf(afterAngle[i], afterAngle[2]), distanceOf(filePositions[i], filePositions[2]),
      `…et ${tag}–C3 aussi : rien n’a été étiré`, 1e-3);
  }
  near(distanceOf(afterAngle[3], afterAngle[4]), distanceOf(filePositions[3], filePositions[4]),
    'la liaison C4–C5 est intacte : C5 a suivi C4 (le côté a tourné d’un bloc)', 1e-3);
  const msgAngle = Panel.msgs[0];
  hasIn(msgAngle, `✓ ${idx.map((i) => nameOf(i)).join(' — ')} :`,
    'le rapport nomme les atomes comme le FICHIER les nomme — pas comme un exemple');
  hasIn(msgAngle, `dihedral ${PanelFns.torsionDeg(plan.beforeDeg)} → ${PanelFns.torsionDeg(plan.afterDeg)}`,
    '…et annonce le dihèdre d’avant → celui d’après');
  hasIn(msgAngle, '2 atoms turned', '…ainsi que le nombre d’atomes réellement tournés');
  ok(!msgAngle.includes('⚠'),
    'aucun avertissement de glisser : cette molécule n’a pas été déplacée à la main');

  /* ── LE ↺ REND LA MOLÉCULE AU FICHIER — un geste, un ↺, les cinq atomes ─────────── */
  Panel.componentRef.current = comp;
  Panel.msgs.length = 0;
  Panel.undoLastTorsion();
  eq(readAll(), filePositions,
    '⚠ LE ↺ REMET LES CHIFFRES DU FICHIER SUR L’ÉCRAN : les cinq atomes, C5 compris — ce que le geste avait emmené, le ↺ le ramène');
  hasIn(Panel.msgs[0], `↺ ${labelAngle}`, '…en nommant le geste défait (le dihèdre tapé)');
  hasIn(Panel.msgs[0], 'every atom is back exactly where it was before it', '…et en disant que rien ne traîne');
  near(dihedralDeg(at(0), at(1), at(2), at(3)), beforeDeg,
    'la molécule revenue porte son dihèdre d’origine, au chiffre près', 1e-9);
  eq(Panel.torsionUndoRef.current, null, '…et il ne reste plus rien à défaire');
  Panel.msgs.length = 0;
  Panel.undoLastTorsion();
  eq(readAll(), filePositions, '…un second ↺ n’écrit donc rien du tout');
  eq(Panel.msgs[0], '↺ Nothing to undo — no torsion has been applied from this panel yet.',
    '…il le dit simplement : le panneau défait LE DERNIER geste, il ne garde pas la pile');

  /* ── LE MÊME GESTE, MAIS PAR LA DISTANCE A–D ───────────────────────────────────── */
  /* Le fichier est de nouveau à l’écran (le ↺ ci-dessus) : ce geste-ci part donc de ses
     chiffres, comme un utilisateur qui pique quatre atomes sur un fichier jamais touché. */
  const restart = () => {
    const pts = idx.map((i) => at(i));
    return { points: pts, side: movingSideOf({
      neighbours: nb, atomCount: structure.atomCount, axis: [idx[1], idx[2]], moving: idx[3], stay: idx[0],
    }) };
  };
  const target = 3.1;      // Å — dans la fenêtre atteignable (2.55 … 3.85) : une rotation ne
                           //     change aucune distance, la fenêtre est la même à tout dihèdre
  const second = restart();
  const plan2 = planTorsion({
    points: second.points, moved: second.side.moved.map((i) => at(i)), request: { distance: target },
  });
  eq(plan2.ok, true, `la distance ${target} Å est à portée de la torsion`);
  ok(Number.isFinite(plan2.alternativeDeg),
    '⚠ le module annonce les DEUX angles qui l’atteignent (le panneau en applique un, l’autre est dit)');
  const labelDist = `A–D ${PanelFns.torsionAng(target)}`;
  Panel.msgs.length = 0;
  eq(Panel.commitTorsion(
    { ...picks, points: second.points, moved: second.side.moved }, plan2, labelDist,
  ), true, 'le panneau écrit la rotation qui atteint cette distance');
  const afterDist = readAll();
  near(distanceOf(afterDist[0], afterDist[3]), target,
    '⚠ TAPER 3.10 Å DONNE BIEN 3.10 Å : c’est la STRUCTURE qui est relue, pas le plan',
    TORSION_DISTANCE_TOLERANCE);
  near(dihedralDeg(afterDist[0], afterDist[1], afterDist[2], afterDist[3]), plan2.afterDeg,
    '…au dihèdre que la forme fermée a résolu', 1e-4);
  const msgDist = Panel.msgs[0];
  hasIn(msgDist, `A–D ${PanelFns.torsionAng(plan2.beforeDistance)} → ${PanelFns.torsionAng(plan2.afterDistance)}`,
    'le rapport annonce la distance d’avant → celle d’après');
  hasIn(msgDist, `at dihedral ${PanelFns.torsionDeg(plan2.afterDeg)}`,
    '…et le dihèdre auquel la molécule s’est arrêtée');
  hasIn(msgDist, `the other solution is ${PanelFns.torsionDeg(plan2.alternativeDeg)}`,
    '…en nommant l’autre solution, pour qui voulait celle-là');

  /* ── CE QUI SORTIRAIT DU FICHIER, APRÈS LE GESTE ───────────────────────────────── */
  const pdb = new NGL.PdbWriter(structure).getData();
  const pdbLines = pdb.split('\n');
  const pdbLineOf = (name) => pdbLines.find((l) => l.slice(12, 16).trim() === name);
  const pdbXyzOf = (name) => {
    const l = pdbLineOf(name);
    return [l.slice(30, 38), l.slice(38, 46), l.slice(46, 54)].map(Number);
  };
  for (const [i, tag] of [[1, 'C2'], [3, 'C4'], [4, 'C5']]) {
    near(distanceOf(pdbXyzOf(tag), afterDist[i]), 0,
      `l’export PDB porte ${tag} aux coordonnées que l’écran montre`, 1e-3);
  }
  eq(pdbLines.filter((l) => l.startsWith('CONECT')).length, 0,
    '⚠ NGL réécrit les COORDONNÉES mais PAS le CONECT : un fichier réenregistré par l’écran perd son graphe de liaisons');
  eq(structure.bondStore.count, 4,
    '…dans la mémoire de l’écran, la molécule garde pourtant ses quatre liaisons : le geste n’y a pas touché');
  const reloaded = await NGL.autoLoad(new Blob([pdb], { type: 'text/plain' }), { ext: 'pdb' });
  eq(reloaded.atomCount, 5, 'le PDB exporté se relit tout seul');
  eq(reloaded.bondStore.count, 4,
    '⚠ …et sans la moindre ligne CONECT, NGL retrouve quand même les quatre liaisons : il les DEVINE par les distances (inferBonds : all)');
  const bare = await NGL.autoLoad(
    new Blob([FILE.split('\n').filter((l) => !l.startsWith('CONECT')).join('\n')], { type: 'text/plain' }),
    { ext: 'pdb' },
  );
  eq(bare.bondStore.count, 4, '⚠ un PDB sans aucun CONECT arrive donc AVEC un graphe : jamais « vide » ici');
  eq(structuredClone(neighboursOf(bare)(2)).sort((a, b) => a - b), [1, 3],
    '…et sur cette molécule la devinette tombe juste (les distances sont celles d’une chaîne)');
  const ap2 = reloaded.getAtomProxy();
  const at2 = (i) => { ap2.index = i; return [ap2.x, ap2.y, ap2.z]; };
  near(distanceOf(at2(3), afterDist[3]), 0, 'les coordonnées relues sont bien celles exportées', 1e-3);
  eq(movingSideOf({
    neighbours: neighboursOf(reloaded), atomCount: reloaded.atomCount,
    axis: [idx[1], idx[2]], moving: idx[3], stay: idx[0],
  }).moved, [3, 4],
  '…donc C5 suit toujours C4 après un aller-retour par le fichier — la torsion y survit');
  /* ⚠ Mais ce graphe-là est une DEVINETTE : un atome amené près d’un autre par la torsion
     (une fermeture de cycle, par exemple) se verrait inventer une liaison au rechargement,
     et le panneau refuserait alors la charnière (le cas « STILL LINKED » de §3bis) — le
     rapport dit ce que le graphe qu’il lit donne, jamais ce que le fichier prétendait. */

  /* ── LE ↺ REND LÀ AUSSI LES CHIFFRES DU FICHIER — le geste de distance était le dernier ─ */
  Panel.componentRef.current = comp;
  Panel.msgs.length = 0;
  Panel.playbackFinishes.length = 0;
  Panel.undoLastTorsion();
  eq(Panel.playbackFinishes.length, 1,
    '⚠ …et le ↺ a TERMINÉ l’animation du ⚒ avant d’écrire : un seul chemin d’écriture à la fois');
  eq(readAll(), filePositions,
    '⚠ le ↺ défait la distance : les CINQ atomes sont EXACTEMENT aux chiffres du fichier, pas à ±float');
  hasIn(Panel.msgs[0], `↺ ${labelDist}`, '…et le message nomme le geste défait (la distance)');
  hasIn(Panel.msgs[0], 'every atom is back exactly where it was before it',
    '…en disant que la structure est entièrement revenue');
  ok(Panel.msgs[0].startsWith('↺'), 'avec le préfixe ↺ que le panneau colore en vert');
  near(dihedralDeg(at(0), at(1), at(2), at(3)), beforeDeg,
    'la molécule revenue porte son dihèdre d’origine, au chiffre près', 1e-9);
  eq(Panel.torsionUndoRef.current, null, '…et il ne reste plus rien à défaire');
  Panel.msgs.length = 0;
  Panel.undoLastTorsion();
  eq(readAll(), filePositions, '…un second ↺ n’écrit rien de plus');
  eq(Panel.msgs[0], '↺ Nothing to undo — no torsion has been applied from this panel yet.',
    '⚠ …et le panneau le dit : c’est le DERNIER geste qui est en mémoire, pas la pile des gestes');
  Panel.componentRef.current = null;
}

/* ── Bilan ─────────────────────────────────────────────────────────────────────── */
console.log(`_torsion_drive_test.mjs — ${passed} assertions OK (la convention du dihèdre, la forme fermée,`
  + ' le côté qui tourne, le plan, le panneau, et un vrai PDB tourné puis relu par NGL)');


