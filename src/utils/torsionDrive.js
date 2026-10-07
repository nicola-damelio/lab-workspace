/* =========================================================================
   src/utils/torsionDrive.js
   ✏️ RÉGLER UNE TORSION — OU UNE DISTANCE — AU CHIFFRE, PAS À LA SOURIS.

   Le geste qui manquait au viewer : « tourner cette liaison jusqu'à ce que le
   dihèdre A–B–C–D vaille −60°, ou jusqu'à ce que ces deux atomes soient à
   2.60 Å ». Quatre atomes piqués dans la vue 3D, UN nombre tapé, et l'angle est
   RÉSOLU — aucun balayage, aucune dynamique, aucune énergie : seuls les atomes
   du côté de D tournent, d'UNE rotation rigide autour de l'axe B–C (les mêmes
   maths qu'un glisser de molécule — quatFromAxisAngle · rotateVectorByQuat de
   viewerMoleculeMoves.js — rien n'est réécrit ici).

   Trois questions, trois réponses, toutes pures (_torsion_drive_test.mjs) :

     1 · QUELS ATOMES TOURNENT — `movingSideOf`. La liaison B–C coupe le graphe
         des liaisons en deux, et c'est le côté qui porte D qui tourne : tourner
         D tout seul arracherait toutes ses liaisons. Le parcours ne traverse
         JAMAIS B–C, donc un CYCLE est DÉTECTÉ au lieu d'être déformé — quand B
         et C sont atteints tous les deux, la liaison n'est pas une charnière et
         l'appelant est prévenu. L'atome de référence A doit rester de l'autre
         côté, sans quoi le dihèdre serait indéfini dès qu'on le règle.

     2 · L'ANGLE QUI ATTEINT UNE DISTANCE — `solveDistance`. D tourne sur un
         CERCLE autour de l'axe, donc |A − D(θ)|² = c₀ − c₁·cos θ − c₂·sin θ est
         une sinusoïde de θ, et avec φ = atan2(c₂, c₁) l'équation s'écrit
         cos(θ − φ) = C/Amp : AU PLUS DEUX angles exacts modulo 360°, et AUCUN
         quand le cercle de D ne rencontre pas la sphère de rayon d. Dans ce cas
         la distance la plus proche (ou, si la cible est au-delà du cercle, la
         plus lointaine) et la rotation qui y mène reviennent AVEC la raison,
         au lieu d'un chiffre que la structure n'honore pas. C'est pourquoi il
         n'y a pas de balayage ici : un pas de 1° ne peut pas être exact, et sa
         réponse devrait de toute façon être retraduite en une rotation.

     3 · CE QUI S'EST RÉELLEMENT PASSÉ — `planTorsion`. Il tourne les atomes
         qu'on lui donne (règle de la main droite autour de B→C), RELIT le
         dihèdre et la distance sur les coordonnées TOURNÉES, et rend le rapport
         que le panneau affiche : avant → après, la rotation appliquée, et
         l'autre solution quand une distance en avait deux.

   ⚠ LA CONVENTION, une fois pour toutes : une rotation de +θ autour de
   unit(C − B), main droite, AJOUTE θ au dihèdre signé A–B–C–D (le signe IUPAC,
   celui des lecteurs χ/δ du viewer). Tout ce qui suit tient dans cette seule
   phrase, et la sonde la fixe sur un exemple à quatre atomes dont la réponse
   s'écrit à la main.
   ========================================================================= */


import { quatFromAxisAngle, rotateVectorByQuat } from './viewerMoleculeMoves.js';

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

/** An angle request that lands this close to its target has landed (degrees). */
export const TORSION_ANGLE_TOLERANCE_DEG = 0.02;
/** A distance request that lands this close to its target has landed (Å). */
export const TORSION_DISTANCE_TOLERANCE = 0.005;

/* ── the arithmetic a torsion needs — three numbers, no library ──────────── */

/** Une coordonnée, ou null : trois nombres finis (une copie, jamais la référence). */
const point3 = (p) => (
  Array.isArray(p) && p.length >= 3 && [p[0], p[1], p[2]].every((n) => Number.isFinite(Number(n)))
    ? [Number(p[0]), Number(p[1]), Number(p[2])]
    : null
);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a) => Math.sqrt(dot(a, a));
const unitVector = (a) => { const l = norm(a); return l > 1e-12 ? scale(a, 1 / l) : null; };

/** Un angle ramené dans (−180, 180] — la fenêtre dans laquelle un dihèdre se dit. */
export const wrapDeg = (deg) => {
  const v = Number(deg);
  if (!Number.isFinite(v)) return 0;
  const w = ((((v + 180) % 360) + 360) % 360) - 180;
  return w === -180 ? 180 : w;
};

/**
 * LE DIHÈDRE SIGNÉ A–B–C–D, en degrés (convention IUPAC, celle des lecteurs χ/δ du
 * viewer), ou `null` quand il n'en existe pas — trois points alignés, deux points
 * confondus : l'angle ne serait pas défini, et un nombre inventé vaudrait moins que
 * ce silence. C'est LA définition qu'on relit après une rotation (planTorsion), donc
 * la seule qui compte : le lecteur de l'écran et le solveur doivent dire pareil.
 */
export const dihedralDeg = (pA, pB, pC, pD) => {
  const a = point3(pA); const b = point3(pB); const c = point3(pC); const d = point3(pD);
  if (!a || !b || !c || !d) return null;
  const axis = unitVector(sub(c, b));           // l'axe B→C : le seul axe de la torsion
  if (!axis) return null;
  const v = sub(a, b);                          // ⚠ le vecteur A est PRIS DEPUIS B
  const w = sub(d, c);
  const vPerp = sub(v, scale(axis, dot(v, axis)));
  const wPerp = sub(w, scale(axis, dot(w, axis)));
  if (norm(vPerp) < 1e-9 || norm(wPerp) < 1e-9) return null;   // aligné : pas d'angle
  const x = dot(vPerp, wPerp);
  const y = dot(cross(axis, vPerp), wPerp);
  return wrapDeg(Math.atan2(y, x) * DEG);
};

/** La distance entre deux points, en ångströms. */
export const distanceOf = (p, q) => {
  const a = point3(p); const b = point3(q);
  return (a && b) ? norm(sub(a, b)) : null;
};

/**
 * LE REPÈRE DE L'AXE d'une torsion : une origine (B, un point de l'axe — n'importe
 * lequel ferait l'affaire, B est celui qu'on a sous la main) et la direction
 * unitaire B→C. `null` quand les deux atomes de l'axe sont confondus.
 */
export const axisFrame = (pB, pC) => {
  const b = point3(pB); const c = point3(pC);
  if (!b || !c) return null;
  const u = unitVector(sub(c, b));
  return u ? { origin: b, unit: u } : null;
};

/**
 * L'ANGLE QUI AMÈNE L'ATOME QUI TOURNE À UNE DISTANCE DONNÉE — la forme fermée,
 * et rien d'autre.
 *
 * L'atome mobile M tourne sur un CERCLE de rayon r autour de l'axe (c'est ce
 * qu'une liaison fait : la longueur M–C ne change pas, l'angle C–M ne change pas).
 * En écrivant M(θ) = B + w∥ + r(cos θ·m̂ + sin θ·n̂) — m̂ la direction de M
 * perpendiculaire à l'axe, n̂ = û × m̂ — la distance cherchée devient
 *
 *     |A − M(θ)|² = |δ|² + r² − 2r[(δ·m̂)cos θ + (δ·n̂)sin θ] = d²
 *     ⇔  P·cos θ + Q·sin θ = C,  P = 2r(δ·m̂), Q = 2r(δ·n̂), C = |δ|² + r² − d²
 *     ⇔  cos(θ − φ) = C/Amp,     Amp = √(P²+Q²), φ = atan2(Q, P)
 *
 * donc AU PLUS DEUX angles exacts modulo 360° (θ = φ ± β), et AUCUN quand le
 * cercle ne rencontre pas la sphère de rayon d : le rapport dit alors jusqu'où le
 * cercle va (`closestDistance`) et la rotation qui y mène (`closestDeltaDeg`), avec
 * `tooFar` pour distinguer « le cercle reste trop loin » de « le cercle ne va pas
 * assez loin ». L'angle rendu est la rotation À APPLIQUER depuis la position
 * courante (celles des deux solutions qui tient dans (−180, 180], l'autre est
 * rendue à part : c'est un rotamère, pas une erreur).
 *
 * @param {{a:number[], moving:number[], frame:{origin:number[],unit:number[]}, target:number}} spec
 * @returns {{ok:boolean, reason:string, deltaDeg?:number, alternativeDeg?:number,
 *            closestDistance?:number, closestDeltaDeg?:number, tooFar?:boolean,
 *            radius?:number, amp?:number, phiDeg?:number, target?:number}}
 */
export const solveDistance = ({ a, moving, frame, target }) => {
  const A = point3(a); const M = point3(moving);
  const d = Number(target);
  if (!A || !M || !frame || !frame.unit || !frame.origin) return { ok: false, reason: 'bad-points' };
  if (!Number.isFinite(d) || d < 0) return { ok: false, reason: 'bad-target' };
  const u = frame.unit; const B = frame.origin;
  const w = sub(M, B);
  const along = dot(w, u);
  const perp = sub(w, scale(u, along));         // la part de M–B perpendiculaire à l'axe
  const r = norm(perp);
  /* Aucun angle n'existe quand la distance A–D NE DÉPEND PAS de la rotation : D est
     SUR l'axe (le cercle est de rayon nul, D ne bouge pas), ou bien A est sur l'axe
     (la part de A–B perpendiculaire à l'axe est nulle, donc Amp = 0). Dans les deux
     cas la distance est constante : tourner ne la change pas, et le dire vaut mieux
     que de rendre un angle qui ne ferait rien. */
  if (!(r > 1e-6)) return { ok: false, reason: 'distance-fixed', radius: r, target: d };
  const mHat = scale(perp, 1 / r);
  const nHat = cross(u, mHat);
  const delta = sub(A, add(B, scale(u, along)));      // A moins le pied de M sur l'axe
  const P = 2 * r * dot(delta, mHat);
  const Q = 2 * r * dot(delta, nHat);
  /* ⚠ LE SIGNE DE C : l'équation est P·cos θ + Q·sin θ = |δ|² + r² − d², donc C
     est « |δ|² + r² MOINS d² » — le point le plus proche de A (θ = φ) met bien
     |A − M|² = |δ|² + r² − Amp. Avec le signe inverse, la sonde numérique rendait
     des angles qui posaient la distance AILLEURS que sur la cible (et les deux
     refus s'inversaient) : c'est la vérification « l'angle rendu met vraiment la
     distance sur la cible » de _torsion_drive_test.mjs qui le tient. */
  const C = dot(delta, delta) + r * r - d * d;
  const amp = Math.hypot(P, Q);
  const phi = Math.atan2(Q, P);
  const base = { reason: 'ok', radius: r, amp, phiDeg: wrapDeg(phi * DEG), target: d };
  if (amp < 1e-9) return { ...base, ok: false, reason: 'distance-fixed' };  // A sur l'axe : cf. plus haut
  /* ⚠ LA LIMITE, à un bit près : quand la cible vaut EXACTEMENT la distance minimale
     ou maximale du cercle (C = ±Amp), elle EST atteignable (θ = φ, ou θ = φ + 180)
     — `acos` clampe déjà, mais la comparaison stricte, elle, refusait cette solution
     pour un écart d'un bit. La marge est RELATIVE à Amp, donc sans dimension. */
  const edge = amp * 1e-12;
  if (C > amp + edge) {                                 // la sphère est plus PETITE que le cercle
    return {
      ...base,
      ok: false,
      reason: 'unreachable',
      tooFar: false,
      closestDistance: Math.sqrt(Math.max(0, dot(delta, delta) + r * r - amp)),
      closestDeltaDeg: wrapDeg(phi * DEG),
    };
  }
  if (C < -amp - edge) {                                // la sphère est plus GRANDE que le cercle
    return {
      ...base,
      ok: false,
      reason: 'unreachable',
      tooFar: true,
      closestDistance: Math.sqrt(dot(delta, delta) + r * r + amp),
      closestDeltaDeg: wrapDeg((phi + Math.PI) * DEG),
    };
  }
  const beta = Math.acos(Math.max(-1, Math.min(1, C / amp)));
  const t1 = wrapDeg((phi + beta) * DEG);
  const t2 = wrapDeg((phi - beta) * DEG);
  const deltaDeg = Math.abs(t1) <= Math.abs(t2) ? t1 : t2;
  return { ...base, ok: true, deltaDeg, alternativeDeg: deltaDeg === t1 ? t2 : t1 };
};

/**
 * LE CÔTÉ QUI TOURNE — les atomes qui sont du côté de `moving` quand on coupe la
 * liaison `axis`.
 *
 * Un groupe tourne ENTIER : la liaison B–C est un axe, pas une paire de ciseaux,
 * donc le parcours du graphe de liaisons ne traverse JAMAIS l'arête B–C. Trois
 * refus, chacun dit par son `reason` :
 *
 *   • `ring` — B et C sont TOUS DEUX atteints sans traverser l'arête : il existe
 *     un autre chemin entre eux, la molécule est cyclique à cet endroit, et il n'y
 *     a pas de « côté de D » à tourner. Un cycle ainsi coupé se déformerait ;
 *   • `reference-moves` — l'atome de référence (A, `stay`) tomberait dans le côté
 *     qui tourne : le dihèdre serait indéfini dès qu'on le règle. A doit être de
 *     l'autre côté de l'axe ;
 *   • `axis-atom` — l'atome « qui tourne » EST un atome de l'axe : rien ne
 *     tournerait et le dihèdre n'existe pas.
 *
 * ⚠ `moved` ne contient PAS les deux atomes de l'axe (invariants par rotation) et
 * il est TRIÉ : le viewer écrit `positions[k]` sur `moved[k]`, donc cet ordre est
 * un contrat. `moving` lui-même y est toujours — c'est la contrainte qui compte.
 *
 * @param {{neighbours:(i:number)=>number[], atomCount:number, axis:number[],
 *          moving:number, stay?:number}} spec
 * @returns {{ok:boolean, reason:string, moved:number[], sideSize:number}}
 */
export const movingSideOf = ({ neighbours, atomCount, axis, moving, stay }) => {
  const n = Number(atomCount) || 0;
  const a = Number(axis && axis[0]); const b = Number(axis && axis[1]);
  const mv = Number(moving);
  const no = (reason) => ({ ok: false, reason, moved: [], sideSize: 0 });
  if (!n || !Number.isInteger(a) || !Number.isInteger(b) || a === b) return no('bad-axis');
  if (!Number.isInteger(mv) || mv < 0 || mv >= n) return no('bad-atom');
  if (mv === a || mv === b) return no('axis-atom');
  const nb = typeof neighbours === 'function' ? neighbours : () => [];
  const isAxis = (i) => i === a || i === b;
  const seen = new Set([mv]);
  const queue = [mv];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    let list = [];
    try { list = nb(cur) || []; } catch { list = []; }
    for (let k = 0; k < list.length; k++) {
      const i = Number(list[k]);
      if (!Number.isInteger(i) || i < 0 || i >= n) continue;
      if (isAxis(cur) && isAxis(i)) continue;      // ⚠ jamais B → C : l'axe est un axe
      if (seen.has(i)) continue;
      seen.add(i);
      queue.push(i);
    }
  }
  if (seen.has(a) && seen.has(b)) return no('ring');       // pas de charnière : un cycle
  const ref = Number(stay);
  if (Number.isInteger(ref) && seen.has(ref)) return no('reference-moves');
  const moved = [];
  seen.forEach((i) => { if (!isAxis(i)) moved.push(i); });
  moved.sort((x, y) => x - y);
  return { ok: true, reason: 'ok', moved, sideSize: seen.size };
};

/**
 * LE PLAN D'UNE TORSION, EN ENTIER : on tourne, on RELIT, on rapporte.
 *
 * On demande SOIT un angle (`request.angleDeg` : le dihèdre A–B–C–D visé), SOIT une
 * distance (`request.distance` : |A − D| visé, en Å) — l'angle l'emporte s'il y a les
 * deux, et la distance passe par `solveDistance` (forme fermée, cf. plus haut).
 * Les atomes de `moved` tournent d'un seul bloc, en quaternion, autour de l'axe
 * B→C : la rotation appliquée est le MÊME `rotateVectorByQuat` qu'un glisser de
 * molécule, donc les coordonnées écrites sont celles qu'un rayon ou un export
 * dessineront.
 *
 * ⚠ `moved` DOIT contenir la position de l'atome mobile D — sinon le rapport
 * décrirait un geste que les coordonnées ne portent pas : le plan est alors refusé
 * (`moving-not-covered`) au lieu d'être cru. (`movingSideOf` garantit ce point :
 * son parcours part de D, donc D y est toujours.)
 *
 * Le rapport relit la géométrie APRÈS rotation (`afterDeg`, `afterDistance`) : il
 * n'annonce pas le chiffre demandé, il annonce celui que la structure a maintenant —
 * c'est ce qui rend le « exact » du panneau vérifiable par le même lecteur de
 * dihèdre que le reste du viewer.
 *
 * @param {{points:number[][], moved?:number[][],
 *          request:{angleDeg?:number, distance?:number}}} spec
 *   `points` = [A, B, C, D] — B et C sont l'axe, D tourne, A est la référence qui
 *   ne bouge pas. `moved` = les coordonnées des atomes qui tournent (D compris).
 * @returns {{ok:boolean, reason:string, beforeDeg?:number, afterDeg?:number,
 *            deltaDeg?:number, alternativeDeg?:number, beforeDistance?:number,
 *            afterDistance?:number, targetAngleDeg?:number, targetDistance?:number,
 *            positions?:Array<number[]|null>, flatPositions?:Float32Array|null,
 *            rotatedD?:number[], movedCount:number, solved?:object}}
 */
export const planTorsion = ({ points, moved, request }) => {
  const p = (points || []).map(point3);
  if (p.length !== 4 || p.some((q) => !q)) return { ok: false, reason: 'bad-points', movedCount: 0 };
  const [A, B, C, D] = p;
  const frame = axisFrame(B, C);
  const beforeDeg = dihedralDeg(A, B, C, D);
  const beforeDistance = distanceOf(A, D);
  const head = { beforeDeg, beforeDistance, movedCount: 0 };
  if (!frame) return { ok: false, reason: 'no-axis', ...head };
  if (beforeDeg === null) return { ok: false, reason: 'no-dihedral', ...head };
  const req = request || {};
  const angle = Number(req.angleDeg);
  const dist = Number(req.distance);
  const byDeg = Number(req.rotateByDeg);
  /* Trois façons de demander la MÊME chose — une rotation. `rotateByDeg` est la
     primitive (c'est ce que « ↳ Apply closest » emploie quand la distance demandée est
     hors d'atteinte) ; `angleDeg` vise un dihèdre ; `distance` passe par solveDistance. */
  const wantRotate = req.rotateByDeg !== undefined && req.rotateByDeg !== null && Number.isFinite(byDeg);
  const wantAngle = !wantRotate
    && req.angleDeg !== undefined && req.angleDeg !== null && Number.isFinite(angle);
  const wantDistance = !wantRotate && !wantAngle
    && req.distance !== undefined && req.distance !== null && Number.isFinite(dist);
  if (!wantRotate && !wantAngle && !wantDistance) return { ok: false, reason: 'no-request', ...head };
  let deltaDeg;
  let solved = null;
  if (wantRotate) {
    deltaDeg = wrapDeg(byDeg);
  } else if (wantAngle) {
    deltaDeg = wrapDeg(angle - beforeDeg);
  } else {
    solved = solveDistance({ a: A, moving: D, frame, target: dist });
    if (!solved.ok) return { ok: false, reason: solved.reason, solved, targetDistance: dist, ...head };
    deltaDeg = solved.deltaDeg;
  }
  const q = quatFromAxisAngle(frame.unit, deltaDeg * RAD);
  if (!q) return { ok: false, reason: 'no-rotation', ...head };
  const turned = (pt) => add(frame.origin, rotateVectorByQuat(q, sub(pt, frame.origin)));
  const pts = (moved || []).map(point3);
  if (!pts.some((pt) => pt && norm(sub(pt, D)) < 1e-9)) {
    return { ok: false, reason: 'moving-not-covered', ...head };
  }
  const positions = pts.map((pt) => (pt ? turned(pt) : null));
  /* LA MÊME LISTE, À PLAT — trois nombres par atome, dans l'ordre de `moved`, et en
     Float32 : c'est EXACTEMENT ce que `AtomProxy#positionFromArray(tab, k * 3)` écrit,
     donc le viewer n'a aucune conversion à faire, et le geste passe par le même tableau
     que celui qu'un glisser de molécule écrit (`partPositionsInto`). Float32 est de
     toute façon la précision que NGL tient en mémoire ; `null` quand une coordonnée
     manquait (aucune n'est jamais écrite, dans ce cas le plan est refusé avant). */
  const flatPositions = positions.every(Boolean) ? Float32Array.from(positions.flat()) : null;
  const rotatedD = turned(D);
  return {
    ok: true,
    reason: 'ok',
    beforeDeg,
    afterDeg: dihedralDeg(A, B, C, rotatedD),
    deltaDeg: wrapDeg(deltaDeg),
    beforeDistance,
    afterDistance: distanceOf(A, rotatedD),
    targetAngleDeg: wantAngle ? wrapDeg(angle) : null,
    targetDistance: wantDistance ? dist : null,
    alternativeDeg: solved ? solved.alternativeDeg : null,
    solved,
    positions,
    flatPositions,
    rotatedD,
    movedCount: positions.filter(Boolean).length,
  };
};




