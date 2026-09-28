/* =========================================================================
   utils/viewerMoleculeMoves.js — 🖱 DÉPLACER **UNE** MOLÉCULE DANS UNE STRUCTURE
   CHARGÉE, SANS DÉCOUPER LE FICHIER.

   ⚠⚠ POURQUOI LA DÉCOUPE DU PDB N'EST PAS LA RÉPONSE. La demande de cette session
   était : « in case where more molecules are present in one pdb, why don't you split
   the pdb so that you have more separated molecule and I can do the move independent
   or the fit independent? » — l'idée a été essayée AVANT (chaque molécule recevait sa
   propre composante NGL, voir splitStructureIntoMolecules) et elle a coûté deux
   rapports :
     • « I do not understand what you did to move the molecules now I have twice as
       much of molecules. » — la structure ENTIÈRE restait dessinée ET chaque molécule
       était redessinée par sa propre composante : chaque atome était peint deux fois,
       et une molécule déplacée ne faisait que séparer les deux copies ;
     • pour un ensemble multi-MODEL (NMR, docking), les « molécules » SONT les images
       de la trajectoire : des composantes séparées resteraient figées sur leur MODEL,
       le curseur de frames ne piloterait plus la scène, et tout ce qui est écrit « par
       molécule » dans le viewer (poses du film, plaques de la scène, ombres, ⚡ ESP,
       matériaux, ↺, 🎯 Fit) parle de composantes — il aurait fallu le refaire pour N
       fragments.
   ⇒ On ne découpe donc RIEN : les atomes de la molécule attrapée sont DÉPLACÉS DANS la
   structure. NGL sait le faire — c'est exactement ce que fait `panAtom`, et ce qu'il
   fait à chaque image d'une trajectoire (`updatePosition` → `refreshed` →
   `updateRepresentations({ position: true })`). Rien n'est dessiné deux fois, la
   trajectoire continue de piloter la scène, et une SEULE molécule bouge.

   CE QUE CE MODULE GARDE — un DÉPLACEMENT RIGIDE PAR MOLÉCULE, écrit pour pouvoir
   être REJOUÉ tel quel sur n'importe quelles coordonnées d'origine :

       p(base) = q · (base − pivot) + pivot + t

   `base` (les coordonnées de l'image courante) n'entre pas dans le mouvement : c'est
   ce qui permet de rejouer une molécule déplacée APRÈS un changement d'image (la
   trajectoire réinstalle ses coordonnées, le mouvement se repose dessus), après un
   rechargement du même fichier (la clé est déterministe, voir partKeyOf) et dans le
   film (une pose de molécule transporte `{ pivot, t, q }`, voir utils/viewerKeyframes).
   Le `pivot` est le barycentre des coordonnées d'origine : tourner = tourner AUTOUR
   DE SON PROPRE CENTRE, et le centre étant invariant par la rotation, une molécule ne
   dérive jamais de quelques pixels par geste.

   TOUT EST PUR ICI (aucun NGL, aucun React) : les maths se mesurent dans une sonde,
   _viewer_molecule_moves_test.mjs, et le viewer ne fait que les brancher.
   ========================================================================= */

/** Le pas de rotation de NGL, en radians par pixel : `TrackballControls.rotateSpeed`
 *  vaut 2,0 et `_getRotateXY` multiplie par 0,01 (`dy = +0,02·y`, `dx = −0,02·x`).
 *  Le geste d'une molécule tourne donc exactement au rythme de celui d'une composante
 *  entière — un rythme que l'utilisateur a déjà appris à la souris. */
export const PART_ROTATE_PER_PIXEL = 2.0 * 0.01;

/** Trois nombres finis, ou rien. */
const vec3Of = (v) => {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const out = v.map(Number);
  return out.every((n) => Number.isFinite(n)) ? out : null;
};


/**
 * LA CLÉ D'UNE MOLÉCULE — ce qui la désigne dans un film ou dans un setup, et qui ne
 * dépend QUE du fichier : la même molécule, rechargée demain, porte la même clé. Le
 * nom de la barre ne peut pas servir : deux copies du même ligand dans la même chaîne
 * reçoivent « Chain A · LIG » et « Chain A · LIG #2 » (un numéro d'ORDRE, qui
 * bougerait si l'une des deux disparaissait), alors que ce sont leurs RÉSIDUS qui les
 * distinguent vraiment (601 contre 602).
 */
export const partKeyOf = (part) => {
  const p = part || {};
  /* ⚠ Le nom de la chaîne s'appelle `chain` dans la règle pure et `chainId` dans les
     entités que le viewer charge (namedPartsOf) : la clé accepte les deux, sinon une
     molécule d'une chaîne nommée prendrait la clé « sans chaîne ». */
  const rawChain = p.chain != null ? p.chain : p.chainId;
  const chain = String(rawChain == null ? '' : rawChain).trim() || '_';
  const model = Number.isFinite(Number(p.model)) ? Number(p.model) : 0;
  const lo = Number.isFinite(Number(p.resnoMin)) ? Number(p.resnoMin) : 0;
  const hi = Number.isFinite(Number(p.resnoMax)) ? Number(p.resnoMax) : lo;
  const what = (Array.isArray(p.resnames) ? p.resnames : []).map((r) => String(r).trim()).filter(Boolean).join('+');
  const count = Number.isFinite(Number(p.atomCount)) ? Number(p.atomCount) : 0;
  return `${chain}|${model}|${lo}-${hi}|${what || '?'}|${count}`;
};

/** Une direction, ramenée à l'unité — jamais zéro (une direction nulle ne tourne
 *  rien : on préfère rendre `null` et laisser l'appelant garder son geste NGL). */
export const normalisedDirection = (v) => {
  const n = vec3Of(v);
  if (!n) return null;
  const len = Math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]);
  if (!(len > 1e-12)) return null;
  return [n[0] / len, n[1] / len, n[2] / len];
};

/** Une rotation d'axe et d'angle : [x·sin(θ/2), y·sin(θ/2), z·sin(θ/2), cos(θ/2)]. */
export const quatFromAxisAngle = (axis, angle) => {
  const a = normalisedDirection(axis);
  const th = Number(angle);
  if (!a || !Number.isFinite(th)) return null;
  const s = Math.sin(th / 2);
  return [a[0] * s, a[1] * s, a[2] * s, Math.cos(th / 2)];
};

/** a SUIVI de b (l'ordre de `Quaternion#multiply` de three, que NGL utilise :
 *  `qx.multiply(qy)` ⇒ qx·qy, et c'est ce produit qui est appliqué à l'orientation
 *  de la composante — donc « la rotation d'axe écran X » d'abord). */
export const quatMul = (a, b) => {
  const A = quat4Of(a); const B = quat4Of(b);
  if (!A || !B) return A || B || quatIdentity();
  const [ax, ay, az, aw] = A; const [bx, by, bz, bw] = B;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
};

/** Le vecteur tourné par un quaternion (forme de Rodrigues, sans three ni NGL) :
 *  v' = v + w·t + qᵥ × t avec t = 2·(qᵥ × v). */
export const rotateVectorByQuat = (q, v) => {
  const Q = quat4Of(q); const V = vec3Of(v);
  if (!V) return [0, 0, 0];
  if (!Q) return V;
  const [qx, qy, qz, qw] = Q;
  const tx = 2 * (qy * V[2] - qz * V[1]);
  const ty = 2 * (qz * V[0] - qx * V[2]);
  const tz = 2 * (qx * V[1] - qy * V[0]);
  return [
    V[0] + qw * tx + (qy * tz - qz * ty),
    V[1] + qw * ty + (qz * tx - qx * tz),
    V[2] + qw * tz + (qx * ty - qy * tx),
  ];
};

/** Quatre nombres finis, ou rien (une orientation). */
const quat4Of = (q) => {
  if (!Array.isArray(q) || q.length !== 4) return null;
  const out = q.map(Number);
  return out.every((n) => Number.isFinite(n)) ? out : null;
};

/** L'orientation neutre. */

/** LE BARYCENTRE de coordonnées à plat (x y z x y z …) — le point autour duquel une
 *  molécule tourne sur elle-même. */
export const centroidOf = (flat) => {
  const a = flat || [];
  const n = Math.floor(a.length / 3);
  if (!n) return [0, 0, 0];
  let x = 0; let y = 0; let z = 0;
  for (let i = 0; i < n; i++) { x += a[i * 3] || 0; y += a[i * 3 + 1] || 0; z += a[i * 3 + 2] || 0; }
  return [x / n, y / n, z / n];
};

/**
 * UN MOUVEMENT NEUF, À L'ARRÊT, POUR UNE MOLÉCULE : son pivot (le barycentre de ses
 * coordonnées d'ORIGINE) et rien d'autre. `base` n'est pas gardé ici — c'est la
 * mémoire du viewer, qui seule connaît les coordonnées — mais il sert à calculer le
 * pivot (voir centroidOf) : tourner une molécule, c'est la tourner sur elle-même.
 */
export const partMoveIdentity = (key, pivot) => ({
  key: String(key == null ? '' : key),
  pivot: vec3Of(pivot) || [0, 0, 0],
  t: [0, 0, 0],
  q: quatIdentity(),
});

/**
 * TOURNER LA MOLÉCULE TENUE — le geste de la souris, en radians par pixel.
 * `axes` sont les DIRECTIONS D'ÉCRAN ramenées dans le repère de la molécule (le viewer
 * les mesure sur NGL lui-même, voir screenVector) : `axes.x` est « la droite de
 * l'écran » et `axes.y` « le haut de l'écran », DANS la molécule. Un glisser vertical
 * fait donc tourner autour de l'axe horizontal de l'écran, un glisser horizontal
 * autour de l'axe vertical — le trackball de NGL, dont on reprend les DEUX signes
 * (`dy` positif, `dx` négatif) pour que le geste aille du même côté que celui d'une
 * composante entière.
 *
 * ⚠ LA COMPOSITION EST `step · q` : le pas vient À GAUCHE, comme un
 * `quaternion.premultiply` de NGL. C'est ce qui fait qu'une rotation ne « repart »
 * jamais de l'origine : chaque pixel tourne la molécule d'un cran SUR ce qu'elle est
 * devenue, et le pivot (invariant par rotation) reste son centre.
 */
export const rotatePartMove = (move, axes, dx, dy, perPixel = PART_ROTATE_PER_PIXEL) => {
  const m = move || partMoveIdentity('', [0, 0, 0]);
  const qx = quatFromAxisAngle(axes && axes.x, perPixel * Number(dy || 0));
  const qy = quatFromAxisAngle(axes && axes.y, -perPixel * Number(dx || 0));
  const step = (qx && qy) ? quatMul(qx, qy) : (qx || qy);
  if (!step) return m;
  return { ...m, q: quatMul(step, m.q) };
};


/**
 * OÙ VONT LES ATOMES — écrit `out` (x y z …, même longueur que `base`) avec
 * p = q·(base − pivot) + pivot + t. PURE : deux fois la même entrée donnent les mêmes
 * nombres, donc rejouer un mouvement ne dépend jamais de ce qui a été dessiné avant —
 * c'est TOUT l'intérêt de garder les coordonnées d'origine de l'image :
 *   • après un changement d'image de trajectoire, les coordonnées réinstallées
 *     deviennent les nouvelles `base` et le mouvement se repose dessus ;
 *   • après un ↺, les coordonnées d'origine reviennent et le mouvement est oublié ;
 *   • au premier morphème d'un film, une pose repose `{ pivot, t, q }`.
 */
export const partPositionsInto = (base, move, out) => {
  const src = base || [];
  const dst = (out && out.length === src.length) ? out : new Float32Array(src.length);
  const m = move || partMoveIdentity('', [0, 0, 0]);
  const p = vec3Of(m.pivot) || [0, 0, 0];
  const t = vec3Of(m.t) || [0, 0, 0];
  const q = quat4Of(m.q) || quatIdentity();
  for (let i = 0; i + 2 < src.length; i += 3) {
    const r = rotateVectorByQuat(q, [src[i] - p[0], src[i + 1] - p[1], src[i + 2] - p[2]]);
    dst[i] = r[0] + p[0] + t[0];
    dst[i + 1] = r[1] + p[1] + t[1];
    dst[i + 2] = r[2] + p[2] + t[2];
  }
  return dst;
};

/** LE MOUVEMENT, TEL QU'UNE POSE LE GARDE : trois tableaux de nombres, rien d'autre
 *  (sérialisable dans un film, mélangeable comme le reste — voir utils/viewerKeyframes). */
export const partPosePartOf = (move) => {
  const m = move || partMoveIdentity('', [0, 0, 0]);
  return {
    pivot: (vec3Of(m.pivot) || [0, 0, 0]).slice(),
    t: (vec3Of(m.t) || [0, 0, 0]).slice(),
    q: (quat4Of(m.q) || quatIdentity()).slice(),
  };
};

/** …ET LE MÊME MOUVEMENT, RELU D'UNE POSE. Le `pivot` retombe sur le barycentre fourni
 *  quand la pose n'en porte pas (une pose d'une version antérieure, ou un film écrit à
 *  la main) : la molécule tourne alors autour de son centre, comme toujours. */
export const partMoveFromPose = (key, pose, pivotFallback = [0, 0, 0]) => partMoveIdentity(
  key,
  (pose && vec3Of(pose.pivot)) || vec3Of(pivotFallback) || [0, 0, 0],
);

/** Tous les mouvements d'une scène, tels qu'une pose les garde : `{ clé: {pivot,t,q} }`.
 *  Les mouvements à l'arrêt ne sont PAS écrits — une molécule qu'on n'a pas touchée
 *  n'alourdit pas le film, et une pose sans `parts` décrit donc une scène d'origine. */
export const partPosesOf = (moves) => {
  const out = {};
  (Array.isArray(moves) ? moves : []).forEach((m) => {
    if (!m || !m.key || isIdentityMove(m)) return;
    out[m.key] = partPosePartOf(m);
  });
  return out;
};

/** FAIRE GLISSER LA MOLÉCULE TENUE : on ajoute au déplacement le vecteur que NGL
 *  aurait ajouté à la composante — `v`, déjà dans le repère de la molécule (le viewer
 *  le mesure en laissant NGL déplacer UN atome, puis en le remettant où il était). */
export const slidePartMove = (move, v) => {
  const m = move || partMoveIdentity('', [0, 0, 0]);
  const d = vec3Of(v);
  if (!d || (!d[0] && !d[1] && !d[2])) return m;
  return { ...m, t: [m.t[0] + d[0], m.t[1] + d[1], m.t[2] + d[2]] };
};

/** Le mouvement ne fait rien (à l'arrêt, à l'origine) — ce qu'un film n'a pas besoin de
 *  garder : une pose sans `parts` VAUT l'identité (voir partPosesOf et mixPose). */
export const isIdentityMove = (move, eps = 1e-6) => {
  if (!move) return true;
  const t = vec3Of(move.t) || [0, 0, 0];
  const q = quat4Of(move.q) || quatIdentity();
  return Math.abs(t[0]) <= eps && Math.abs(t[1]) <= eps && Math.abs(t[2]) <= eps
    && Math.abs(Math.abs(q[3]) - 1) <= eps
    && Math.abs(q[0]) <= eps && Math.abs(q[1]) <= eps && Math.abs(q[2]) <= eps;
};

export const quatIdentity = () => [0, 0, 0, 1];
