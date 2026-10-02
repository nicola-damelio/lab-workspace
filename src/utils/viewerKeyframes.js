/* =========================================================================
   viewerKeyframes.js — 🎞 POSES & STYLES: capture a pose, morph to the next,
   and write the morph as one video.

   THE DEMAND: « a pose/style keyframe system: store several snapshots of the
   position and the styles of a structure, and smoothly interpolate between them
   to export a video ».

   WHY THIS MODULE EXISTS. The viewer already knows how to take a photograph of
   everything that makes its picture (⚙️ captureViewerSetup: the six menus, their
   radii and colours, the palettes of the ⚙ wheel, fog, shadows, clipping, the
   background, the camera AND where every molecule stands) and how to put that
   photograph back (applyViewerSetup). A KEYFRAME is therefore nothing but one of
   those photographs plus the TIME it is held and the WAY the next one is
   reached — no second description of the scene is written here, so a keyframe
   can never hold a setting the viewer does not read back.

   WHAT THIS MODULE DOES (and only this — it touches no DOM, no NGL, no React):
     · the easing of a morph, read by its name (`ease`);
     · the MIX of two photographs: numbers glide, hex colours glide through
       their RGB, a quaternion is SLERPED (a camera turned by 170° must go the
       short way round, which a per-number average would not do), positions
       glide, and anything that cannot be blended honestly (a flag, a style
       name, a word) CUTS at the middle of the morph instead of being invented;
     · the TIMELINE of a film: each keyframe is held `hold` seconds, then the
       scene takes `morph` seconds to reach the next one with that keyframe's
       easing — `keyframeLegs` says where each leg starts and ends, and
       `sampleKeyframeFilm` answers « what is on screen at t = 3.4 s? »;
     · the PLAN of the film (frames, rate, length, Mbps) so the viewer can SAY
       what the export will cost before the click, exactly like the 🎬 plan of a
       trajectory run;
     · the POSE of one molecule — its position and its rotation quaternion, read
       from the world matrix NGL is displaying (the same decomposition the
       🎯 « Fit on the chosen one » gesture uses, so a fitted molecule can be
       interpolated instead of snapping);
     · the codec of the store kept in the browser (a film that was saved once
       comes back at the next visit, and a hand-edited entry is clamped instead
       of trusted).

   Everything is a pure function, so the whole engine is exercised under node
   (see _viewer_keyframes_test.mjs) with no browser at all.
   ========================================================================= */
import {
  VIDEO_FPS_CHOICES, VIDEO_DEFAULT_FPS, VIDEO_MIN_FPS, VIDEO_MAX_FPS,
  VIDEO_MAX_FRAMES, VIDEO_LONG_RUN_SECONDS, videoBitrateOf, videoSecondsText,
} from './viewerTrajectoryVideo.js';
import { poseFromRigidMatrix } from './structureFit.js';

export { VIDEO_FPS_CHOICES, VIDEO_DEFAULT_FPS };

/* ---- WHAT THE 🎞 PANEL OFFERS -------------------------------------------- */
/* How a morph is read: five ways, each one named in the panel. « cut » is a
   HOLD — the scene does not move at all until the next keyframe's own hold
   begins, which is what « I want the same picture for 3 s, then the next one »
   means. */
export const KEYFRAME_EASINGS = Object.freeze(['inOut', 'linear', 'in', 'out', 'hold']);
export const KEYFRAME_DEFAULT_EASING = 'inOut';
export const KEYFRAME_EASING_LABELS = Object.freeze({
  inOut: 'smooth (in–out)',
  linear: 'linear',
  in: 'ease in',
  out: 'ease out',
  hold: 'cut (no move)',
});
/* The limits of one keyframe and of the whole list. A film is a gesture, not a
   database: past forty poses nobody finds the one to fix, and the browser store
   has to stay a store (see serialiseKeyframeFilm). */
export const KEYFRAME_LIMITS = Object.freeze({ keys: 40, hold: [0, 30], morph: [0, 30] });
export const KEYFRAME_DEFAULT_HOLD = 1.5;
export const KEYFRAME_DEFAULT_MORPH = 2;
/* A morph shorter than this would read as a jump: the panel clamps to it in the
   engine so a « 0 s » typed by hand still gives a leg the sampler can divide. */
export const KEYFRAME_MIN_MORPH = 0.05;
export const KEYFRAME_STORE_VERSION = 1;
/* The fields of a captured setup a keyframe does NOT keep: the 🧪 PyMOL session
   (its windows, its script — a film must never replay `set` commands forty
   times) and the stamp of the capture (it would make two identical poses look
   different, and it is not a picture). Everything else — styles, palettes, fog,
   shadows, clipping, background, labels, molecules, camera — IS the picture,
   and is kept. */
export const KEYFRAME_STATE_DROP = Object.freeze(['pymol', 'savedAt']);

const clampNum = (value, min, max, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

/* ---- LA FACON D'ALLER D'UNE POSE A LA SUIVANTE --------------------------- */
/** The progress of a morph: `ease('linear', 0.5) === 0.5`, and « hold » answers
 *  0 for every t < 1 — the picture stays on the keyframe it started from, which
 *  is exactly what a cut is. A name nobody knows falls back to the smooth one. */
export const ease = (name, t) => {
  const x = clampNum(t, 0, 1, 0);
  switch (name) {
    case 'linear': return x;
    case 'in': return x * x;
    case 'out': return 1 - ((1 - x) * (1 - x));
    case 'hold': return x >= 1 ? 1 : 0;
    case 'inOut':
    default: return x * x * (3 - (2 * x));
  }
};

/* ---- LE MÉLANGE DE DEUX PHOTOGRAPHIES ----------------------------------- */
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
/* The names a 4-number array is a ROTATION under. Nothing else is slerped: a
   four-number list that is not a quaternion (a set of limits, a colour) must
   glide number by number like any other measurement. */
const QUATERNION_KEYS = Object.freeze(['q', 'quaternion', 'rotation']);
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const lerpNum = (a, b, t) => a + ((b - a) * t);
const numArrayOf = (v, n) => (Array.isArray(v) && v.length === n && v.every((x) => Number.isFinite(Number(x)))
  ? v.map(Number) : null);

/** « #ff8800 » at t = 0.5 between « #ff0000 » and « #00ff88 » is the colour half
 *  way through the two, not the first one: styles fade, they do not snap. */
export const mixHexColor = (a, b, t) => {
  if (!HEX_COLOR.test(a) || !HEX_COLOR.test(b)) return t < 0.5 ? a : b;
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const ca = rgb(a); const cb = rgb(b);
  const byte = (n) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');
  return `#${byte(lerpNum(ca[0], cb[0], t))}${byte(lerpNum(ca[1], cb[1], t))}${byte(lerpNum(ca[2], cb[2], t))}`;
};

/** A quaternion as the maths wants it (unit, [x, y, z, w]) or null when the
 *  numbers are not four finite values. */
export const normQuat = (q) => {
  const v = numArrayOf(q, 4);
  if (!v) return null;
  const len = Math.sqrt(v.reduce((s, n) => s + (n * n), 0));
  if (!(len > 1e-9)) return null;
  return v.map((n) => n / len);
};

/** The rotation between two orientations, followed on the SPHERE. Averaging the
 *  four numbers of two quaternions separately would shrink the rotation and, at
 *  the antipodes, turn the long way round: a scene that spins 170° would wobble
 *  through the wrong side. `dot < 0` is the antipodal case — one of the two is
 *  flipped first, which is the same rotation written the other way. */
export const slerpQuat = (a, b, t) => {
  const A = normQuat(a); const B = normQuat(b);
  if (!A || !B) return A ? A.slice() : (B ? B.slice() : [0, 0, 0, 1]);
  let dot = (A[0] * B[0]) + (A[1] * B[1]) + (A[2] * B[2]) + (A[3] * B[3]);
  let end = B;
  if (dot < 0) { dot = -dot; end = B.map((n) => -n); }
  if (dot > 0.9995) return normQuat(A.map((n, i) => lerpNum(n, end[i], t))) || A.slice();
  const theta = Math.acos(Math.min(1, dot));
  const sin = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sin;
  const wb = Math.sin(t * theta) / sin;
  return normQuat(A.map((n, i) => (n * wa) + (end[i] * wb))) || A.slice();
};

/* LE POINT DE VUE D'UNE POSE SE MÉLANGE, LUI AUSSI (le rapport de cette session :
   « it does not manage zoom. if pose 2 is zoomed respect to pose 1, the zoom
   remains the same in the movie. »). Une caméra est un quatuor de valeurs
   { q, p, zoom, dist } : sa ROTATION est slerpée, son DÉPLACEMENT et son ZOOM
   glissent nombre par nombre. La scène tourne, glisse et se rapproche donc au lieu
   de sauter au milieu du morphème — c'est ce que la barre annonce depuis toujours
   (« the camera glides », voir le titre du champ « Morph »). Rien n'est inventé :
   un champ qu'une seule des deux poses porte est repris tel quel. */
export const mixCamera = (a, b, t) => {
  const A = isPlainObject(a) ? a : null;
  const B = isPlainObject(b) ? b : null;
  if (!A) return B || a;
  if (!B) return A;
  const out = { ...A, ...B };
  const qa = normQuat(A.q); const qb = normQuat(B.q);
  if (qa && qb) out.q = slerpQuat(qa, qb, t);
  const pa = numArrayOf(A.p, 3); const pb = numArrayOf(B.p, 3);
  if (pa && pb) out.p = pa.map((n, i) => lerpNum(n, pb[i], t));
  /* LES DEUX NOMS DU ZOOM — `dist` est celui de NGL (cameraDistance), `zoom` celui
     des enregistrements écrits avant (voir applyCameraPose) : les deux glissent. */
  ['zoom', 'dist'].forEach((k) => {
    const va = Number(A[k]); const vb = Number(B[k]);
    if (Number.isFinite(va) && Number.isFinite(vb)) out[k] = lerpNum(va, vb, t);
  });
  return out;
};

/* The mix of ONE value, told the name it lives under — that name is what makes
   a four-number array a rotation and not a measurement. */
export const mixValue = (key, a, b, t) => {
  if (a === undefined) return b;
  if (b === undefined) return a;
  // LE POINT DE VUE : la seule valeur qui se mélange sous plusieurs noms (q · p ·
  // zoom · dist) et qui ne doit donc pas couper au milieu du morphème.
  if (key === 'camera') return mixCamera(a, b, t);
  if (typeof a === 'number' && typeof b === 'number') return lerpNum(a, b, t);
  if (typeof a === 'string' && typeof b === 'string' && HEX_COLOR.test(a) && HEX_COLOR.test(b)) {
    return mixHexColor(a, b, t);
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (QUATERNION_KEYS.includes(key) && a.length === 4 && b.length === 4) return slerpQuat(a, b, t);
    const na = numArrayOf(a, a.length); const nb = numArrayOf(b, b.length);
    if (na && nb && na.length === nb.length) return na.map((n, i) => lerpNum(n, nb[i], t));
    /* A LIST OF RECORDS — the extra molecules of the Molecules bar. They are
       paired by their `id`, so a molecule added in one pose (or hidden in the
       other) keeps standing where it was found instead of being invented. */
    const pair = (list) => {
      const m = new Map();
      list.forEach((x) => { if (isPlainObject(x) && typeof x.id === 'string') m.set(x.id, x); });
      return m;
    };
    const ma = pair(a); const mb = pair(b);
    if (ma.size && mb.size) {
      const ids = [...new Set([...ma.keys(), ...mb.keys()])];
      return ids.map((id) => (ma.has(id) && mb.has(id)
        ? mixState(ma.get(id), mb.get(id), t)
        : (ma.has(id) ? ma.get(id) : mb.get(id))));
    }
    return t < 0.5 ? a : b;             // two lists that cannot be paired: a cut
  }
  if (isPlainObject(a) && isPlainObject(b)) return mixState(a, b, t);
  /* A FLAG, A STYLE NAME, A WORD — nothing blends « ribbon » and « spheres ».
     The honest answer is a CUT at the middle of the morph; inventing a value in
     between would put the scene in a state no keyframe ever asked for. */
  return t < 0.5 ? a : b;
};

/** Two captured setups, mixed. The union of the keys is walked, so a setting
 *  that only one of the two poses holds is CARRIED (never silently dropped):
 *  a label added in pose 3 is on screen until a pose that does not hold it. */
export const mixState = (a, b, t) => {
  if (!isPlainObject(a)) return isPlainObject(b) ? b : mixValue('', a, b, t);
  if (!isPlainObject(b)) return a;
  const out = {};
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  keys.forEach((k) => { out[k] = mixValue(k, a[k], b[k], t); });
  return out;
};

/* ---- UN KEYFRAME, VALIDÉ ------------------------------------------------ */
let keyframeSeq = 0;
/** The id of a new pose. Two poses captured in the same millisecond (a script,
 *  a fast hand) must not collide, hence the counter. */
export const nextKeyframeId = () => {
  keyframeSeq += 1;
  return `kf${Date.now().toString(36)}${keyframeSeq.toString(36)}`;
};

/** Anything a browser store (or a hand-edited file) may hold becomes a keyframe
 *  the panel and the engine can use: a name, a hold, a morph, an easing from the
 *  list, a state that is an object. A state that is NOT an object makes the
 *  keyframe unusable and `null` is returned — dropping it is the honest answer,
 *  and normalizeKeyframeFilm counts what it dropped. */
export const normalizeKeyframe = (raw, index = 0) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const state = isPlainObject(raw.state) ? raw.state : null;
  if (!state) return null;
  const name = String(raw.name == null ? '' : raw.name).slice(0, 48).trim() || `Pose ${index + 1}`;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : nextKeyframeId(),
    name,
    hold: clampNum(raw.hold, KEYFRAME_LIMITS.hold[0], KEYFRAME_LIMITS.hold[1], KEYFRAME_DEFAULT_HOLD),
    morph: clampNum(raw.morph, KEYFRAME_LIMITS.morph[0], KEYFRAME_LIMITS.morph[1], KEYFRAME_DEFAULT_MORPH),
    easing: KEYFRAME_EASINGS.includes(raw.easing) ? raw.easing : KEYFRAME_DEFAULT_EASING,
    state,
    pose: Array.isArray(raw.pose)
      ? raw.pose.filter((p) => isPlainObject(p) && typeof p.key === 'string')
      : [],
  };
};

/** A captured setup, reduced to what a keyframe keeps (see KEYFRAME_STATE_DROP).
 *  The copy is SHALLOW on purpose: the caller's object is never mutated and no
 *  deep clone is paid for a photograph that is written once. */
export const slimKeyframeState = (state) => {
  if (!isPlainObject(state)) return {};
  const out = { ...state };
  KEYFRAME_STATE_DROP.forEach((k) => { delete out[k]; });
  return out;
};

/* ---- LE STYLE D'UNE POSE, RETROUVÉ DANS LA SCÈNE PRÉSENTE -------------------
   LE RAPPORT DE CETTE SESSION : « it does not manage transitions in style. For
   example if pose 1 has a surface and pose 2 is ball and stick, the movie always
   shows the style of the first pose also for the second pose. » Une pose ne
   photographiait QUE l'environnement — les six menus de §2, les palettes, la
   caméra : les styles de la BARRE (un arbre de réglages par section, « protein ·
   chain A », et le ✔ de chaque espace) n'en faisaient pas partie. Un film reposait
   donc les mêmes styles du début à la fin, quelle que soit la pose.

   UNE SECTION SE RETROUVE PAR SON ID D'ABORD — il est global (`<molécule>::<clé>`,
   voir ensureSections) — PUIS PAR SA CLÉ LOCALE (« protein|A ») : le même fichier
   rechargé garde ses ids (la molécule principale est toujours « main »), tandis
   qu'une molécule AJOUTÉE reçoit un id neuf à chaque chargement — sa clé locale est
   alors le seul fil qui la relie à la pose. C'est exactement la règle des snapshots
   (voir loadSnapshot, dans le viewer).

   Rien n'est inventé : une section que la pose ne connaît pas est ABSENTE du
   résultat, et l'appelant la laisse telle qu'elle est. `null` quand la pose ne
   porte aucun style (un enregistrement d'avant, ou une scène sans section). */
export const poseStylesForSections = (looks, vis, sections) => {
  const list = (Array.isArray(sections) ? sections : []).filter((s) => s && typeof s.id === 'string');
  const L = isPlainObject(looks) ? looks : null;
  const V = isPlainObject(vis) ? vis : null;
  if (!list.length || (!L && !V)) return null;
  const pick = (map, s) => {
    if (!map) return undefined;
    if (Object.prototype.hasOwnProperty.call(map, s.id)) return map[s.id];
    if (typeof s.key === 'string' && Object.prototype.hasOwnProperty.call(map, s.key)) return map[s.key];
    return undefined;
  };
  const outLooks = {};
  const outVis = {};
  let looksHit = 0;
  let visHit = 0;
  list.forEach((s) => {
    const look = pick(L, s);
    if (isPlainObject(look)) { outLooks[s.id] = look; looksHit += 1; }
    const v = pick(V, s);
    if (typeof v === 'boolean') { outVis[s.id] = v; visHit += 1; }
  });
  if (!looksHit && !visHit) return null;
  return { looks: looksHit ? outLooks : null, vis: visHit ? outVis : null };
};

/* ---- LE MAGASIN DU NAVIGATEUR ------------------------------------------ */
/** The whole film (its poses and the switches of the panel), read back from a
 *  store or from an object built by hand. Every number is clamped, every easing
 *  is checked against the list, and past KEYFRAME_LIMITS.keys the extra poses
 *  are dropped — a store can never hand the panel a film it cannot show. */
export const normalizeKeyframeFilm = (raw) => {
  const src = isPlainObject(raw) ? raw : {};
  const list = Array.isArray(src.keys) ? src.keys : [];
  const keys = [];
  list.forEach((k) => {
    if (keys.length >= KEYFRAME_LIMITS.keys) return;
    const one = normalizeKeyframe(k, keys.length);
    if (one) keys.push(one);
  });
  return {
    v: KEYFRAME_STORE_VERSION,
    fps: VIDEO_FPS_CHOICES.includes(Number(src.fps)) ? Number(src.fps) : VIDEO_DEFAULT_FPS,
    easing: KEYFRAME_EASINGS.includes(src.easing) ? src.easing : KEYFRAME_DEFAULT_EASING,
    hold: clampNum(src.hold, KEYFRAME_LIMITS.hold[0], KEYFRAME_LIMITS.hold[1], KEYFRAME_DEFAULT_HOLD),
    morph: clampNum(src.morph, KEYFRAME_LIMITS.morph[0], KEYFRAME_LIMITS.morph[1], KEYFRAME_DEFAULT_MORPH),
    keys,
  };
};

export const serialiseKeyframeFilm = (film) => JSON.stringify(normalizeKeyframeFilm(film));

/** The text of a browser store, read back — NEVER throws: a store written by
 *  another build (or damaged) simply gives an empty film, so a bad entry can
 *  not lock the viewer out of its own panel. */
export const parseKeyframeFilm = (text) => {
  if (typeof text !== 'string' || !text.trim()) return normalizeKeyframeFilm({});
  try { return normalizeKeyframeFilm(JSON.parse(text)); } catch { return normalizeKeyframeFilm({}); }
};

/* ---- LA POSE D'UNE MOLÉCULE -------------------------------------------- */
/** One molecule's place in the world, as a keyframe keeps it: WHERE its centre
 *  stands and HOW it is turned. The rotation is read from the world matrix NGL
 *  is displaying (poseFromRigidMatrix — the very decomposition the 🎯 « Fit on
 *  the chosen one » gesture applies), so a molecule that was fitted or dragged
 *  is interpolated instead of snapping back.
 *
 *  The position is the one the component itself reports when it has one: it is
 *  exactly what `Component#setPosition` takes back, and the decomposition is
 *  only a fallback. A position that is not three finite numbers is refused.
 *
 *  ⚠ `parts` — LES MOLÉCULES DU FICHIER CHARGÉ QUI ONT ÉTÉ DÉPLACÉES (voir
 *  utils/viewerMoleculeMoves) : une composante n'a qu'UNE position, mais elle peut
 *  porter plusieurs molécules, dont une seule a été prise à la souris. Sans ce champ,
 *  le film remettrait la molécule dans le fichier au premier morphème — la scène
 *  perdrait exactement ce que l'utilisateur venait de placer. La forme est celle que
 *  le viewer sait relire : `{ clé: { pivot, t, q } }`, des nombres, rien d'autre. */
export const keyframePoseOf = (key, elements, position, center, parts) => {
  const { position: decomposed, quaternion } = poseFromRigidMatrix(elements, center);
  const given = numArrayOf(position, 3);
  const pose = { key: String(key), position: given || decomposed, quaternion };
  const moves = normalizePoseParts(parts);
  return moves ? { ...pose, parts: moves } : pose;
};

/* LES MOUVEMENTS D'UNE POSE, RELUS — chaque molécule doit dire son pivot (trois
   nombres), son déplacement (trois nombres) et son orientation (quatre nombres) : une
   entrée illisible est IGNORÉE plutôt que de peindre un NaN. Au-delà de 64 molécules
   déplacées, la liste est tronquée : un film est un document, pas un dépotoir. */
const POSE_PARTS_MAX = 64;
export const normalizePoseParts = (raw) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  let n = 0;
  Object.keys(raw).forEach((key) => {
    if (n >= POSE_PARTS_MAX || !key) return;
    const one = raw[key];
    if (!one || typeof one !== 'object') return;
    const pivot = numArrayOf(one.pivot, 3);
    const t = numArrayOf(one.t, 3);
    const q = numArrayOf(one.q, 4);
    if (!pivot || !t || !q) return;
    out[key] = { pivot, t, q };
    n += 1;
  });
  return n ? out : null;
};

/** DEUX MOUVEMENTS D'UNE MÊME MOLÉCULE, MÉLANGÉS : le déplacement et le pivot glissent
 *  nombre par nombre, l'orientation est slerpée (comme la caméra et les molécules).
 *  Une molécule qu'UNE SEULE des deux poses connaît se mélange avec « ne bouge pas »
 *  (les mêmes nombres, à l'arrêt) — elle entre donc dans la scène en glissant depuis
 *  sa place d'origine, elle ne saute pas. */
const mixPosePart = (a, b, t) => {
  const pivotA = numArrayOf((a && a.pivot) || null, 3) || numArrayOf((b && b.pivot) || null, 3) || [0, 0, 0];
  const pivotB = numArrayOf((b && b.pivot) || null, 3) || pivotA;
  const tA = numArrayOf((a && a.t) || null, 3) || [0, 0, 0];
  const tB = numArrayOf((b && b.t) || null, 3) || [0, 0, 0];
  return {
    pivot: pivotA.map((n, i) => lerpNum(n, pivotB[i], t)),
    t: tA.map((n, i) => lerpNum(n, tB[i], t)),
    q: slerpQuat((a && a.q) || [0, 0, 0, 1], (b && b.q) || [0, 0, 0, 1], t),
  };
};

/** …ET TOUT UN LOT. Une clé qui n'existe QUE d'un côté compte comme « à l'arrêt » de
 *  l'autre (voir mixPosePart) ; s'il n'y a de mouvement nulle part, il n'y a pas de
 *  champ `parts` du tout — une pose de scène intacte reste exactement ce qu'elle était
 *  avant cette version du film. */
export const mixPoseParts = (a, b, t) => {
  const A = normalizePoseParts(a); const B = normalizePoseParts(b);
  if (!A && !B) return null;
  const out = {};
  const keys = new Set([...Object.keys(A || {}), ...Object.keys(B || {})]);
  keys.forEach((key) => { out[key] = mixPosePart(A && A[key], B && B[key], t); });
  return Object.keys(out).length ? out : null;
};

/** Two poses of the same molecule, mixed: the centre glides, the orientation is
 *  slerped, and the molecules the file holds follow the very same rule (see
 *  mixPoseParts) — their place AND their orientation glide too. */
export const mixPose = (a, b, t) => {
  const pa = numArrayOf(a.position, 3); const pb = numArrayOf(b.position, 3);
  const out = {
    key: a.key,
    position: (pa && pb) ? pa.map((n, i) => lerpNum(n, pb[i], t)) : (t < 0.5 ? a.position : b.position),
    quaternion: slerpQuat(a.quaternion, b.quaternion, t),
  };
  const parts = mixPoseParts(a.parts, b.parts, t);
  if (parts) out.parts = parts;
  return out;
};

/** The poses of a whole scene, mixed. They are paired by molecule KEY, so a
 *  molecule that only one of the two keyframes knows keeps standing where it was
 *  when it was captured — it neither flies in from nowhere nor disappears. */
export const mixPoseList = (a, b, t) => {
  const list = [];
  const ids = [];
  /* A key is listed ONCE, the first time either side holds it: the two lists
     share most of their molecules (the same scene, twice), and a molecule set
     twice per frame would be set to the same place twice — pure waste. */
  const seen = new Set();
  const index = (poses) => {
    const m = new Map();
    (poses || []).forEach((p) => {
      if (!p || typeof p.key !== 'string' || m.has(p.key)) return;
      m.set(p.key, p);
      if (!seen.has(p.key)) { seen.add(p.key); ids.push(p.key); }
    });
    return m;
  };
  const ma = index(a); const mb = index(b);
  ids.forEach((k) => {
    const pa = ma.get(k); const pb = mb.get(k);
    if (pa && pb) list.push(mixPose(pa, pb, t));
    else list.push(pa || pb);
  });
  return list;
};

/* ---- LA CHRONOLOGIE DU FILM -------------------------------------------- */
/** Where every leg of the film starts and ends, in seconds.
 *
 *  A keyframe is HELD `hold` seconds — the picture does not move — and is then
 *  followed by a MORPH of `morph` seconds towards the next one, read with that
 *  keyframe's own easing. The LAST keyframe morphs to nothing: it is held, and
 *  the film stops there. A zero-length leg is not emitted at all (a hold of 0 s
 *  simply starts the morph at once), and a morph is never shorter than
 *  KEYFRAME_MIN_MORPH, so the sampler always has a span to divide. */
export const keyframeLegs = (keyframes) => {
  const keys = Array.isArray(keyframes) ? keyframes : [];
  const legs = [];
  let at = 0;
  keys.forEach((k, i) => {
    /* A missing field AND a damaged entry both fall back to the defaults: a store
       read back from a browser may hold anything, and the sampler must always have
       a leg it can divide (a `null` entry used to give a hold of 0 s, i.e. a film
       of no length at all). */
    const src = (k && typeof k === 'object') ? k : {};
    const hold = clampNum(src.hold, KEYFRAME_LIMITS.hold[0], KEYFRAME_LIMITS.hold[1], KEYFRAME_DEFAULT_HOLD);
    const morph = i < keys.length - 1
      ? Math.max(KEYFRAME_MIN_MORPH, clampNum(src.morph, KEYFRAME_LIMITS.morph[0], KEYFRAME_LIMITS.morph[1], KEYFRAME_DEFAULT_MORPH))
      : 0;
    if (hold > 0) { legs.push({ kind: 'hold', from: i, to: i, start: at, end: at + hold, easing: src.easing }); at += hold; }
    if (morph > 0) { legs.push({ kind: 'morph', from: i, to: i + 1, start: at, end: at + morph, easing: src.easing }); at += morph; }
  });
  return { legs, totalSeconds: at };
};

/** « What is on screen at t seconds? » — the one question the recorder asks.
 *
 *  During a HOLD the answer is the keyframe ITSELF (`state` and `pose` handed
 *  back as captured, so a held pose is exactly what was photographed). During a
 *  MORPH it is the mix of the two poses at the eased progress. Past the end the
 *  last leg answers (the film holds its final image instead of flickering back
 *  to the first keyframe) and before the start the first leg does.
 *
 *  `snap` — THE APPEARANCE OF THE NEAREST POSE, BESIDE THE MIX. THE REPORT OF THIS SESSION,
 *  VERBATIM: "In the movie, the transition between one state and the other is not smooth.
 *  there is a fraction of time where there is nothing. It would be better to see one move
 *  transform into the other gradually." `state` mixes everything — numbers glide (a
 *  transparency, a radius, a colour) — and those are exactly the settings the
 *  representation BUILDER reads: a scene deposited on every frame was therefore REBUILT on
 *  every frame, and NGL computes a surface / a cartoon IN A WORKER, so the picture was
 *  empty for most of the move. `snap` carries the state of ONE POSE (its own half of the
 *  move), so the player deposits that appearance ONCE PER HALF (see `filmSceneState`) and
 *  the change becomes a DISSOLVE (the viewer's fade layer) instead of a hole. */
export const sampleKeyframeFilm = (keyframes, seconds) => {
  const keys = (Array.isArray(keyframes) ? keyframes : []).map((k) => ((k && typeof k === 'object') ? k : {}));
  if (!keys.length) return null;
  const { legs, totalSeconds } = keyframeLegs(keys);
  const at = Math.min(Math.max(0, Number(seconds) || 0), totalSeconds);
  const use = legs.find((l) => at < l.end) || legs[legs.length - 1] || { kind: 'hold', from: 0, to: 0, start: 0, end: 0, easing: keys[0].easing };
  const span = Math.max(KEYFRAME_MIN_MORPH, use.end - use.start);
  const u = Math.min(1, Math.max(0, (at - use.start) / span));
  const last = keys.length - 1;
  const from = keys[Math.min(last, Math.max(0, use.from))];
  if (use.kind !== 'morph' || use.to <= use.from) {
    return { kind: 'hold', from: use.from, to: use.from, u, t: 0, at, totalSeconds, state: from.state, snap: from.state, pose: from.pose };
  }
  const t = ease(use.easing, u);
  const to = keys[Math.min(last, use.to)];
  return {
    kind: 'morph',
    from: use.from,
    to: use.to,
    u,
    t,
    at,
    totalSeconds,
    state: mixState(from.state, to.state, t),
    /* L'ASPECT DE LA POSE LA PLUS PROCHE (voir le JSDoc de `snap`) : le melange pour ce qui
       glisse (la camera, les molecules), la POSE elle-meme pour tout ce qui fait rebatir la
       scene. C'est la moitie du mouvement au sens de `mixValue` (un mot bascule a t = 0,5). */
    snap: t < 0.5 ? from.state : to.state,
    pose: mixPoseList(from.pose, to.pose, t),
  };
};

/* ---- CE QU'UN MOUVEMENT REPOSE D'UN COUP, ET CE QU'IL FAIT GLISSER ----------
   LE RAPPORT DE CETTE SESSION, MOT POUR MOT : "In the movie, the transition between one
   state and the other is not smooth. there is a fraction of time where there is nothing.
   It would be better to see one move transform into the other gradually."

   LA CAUSE. Un instant de mouvement MELANGE tout (`mixState`) : les nombres glissent, et
   les reglages qui glissent ainsi sont ceux que le CONSTRUCTEUR de representations lit.
   Leur valeur changeait donc a chaque image, la scene etait REBATIE a chaque image, et NGL
   calcule une surface / un cartoon DANS UN WORKER : l'image restait vide une bonne partie
   du mouvement ("a fraction of time where there is nothing").

   LA REGLE. Ce qu'un spectateur applique est `filmSceneState` : l'ASPECT de la pose la plus
   proche (`snap`), repose d'un seul coup, une fois par moitie de mouvement - et deux choses
   seulement continuent de GLISSER, parce qu'elles se reposent sans rien reconstruire :
     . LE POINT DE VUE (la camera, slerpee par `mixCamera`) ;
     . LES CINQ REGLAGES DE L'ETAGE, appliques EN PLACE par leurs propres effets : fog,
       shadows, clipping, background et la qualite.
   Tout le reste fait REBATIR la scene, donc tout le reste vient d'une POSE : les styles de
   la barre, les palettes, les rayons, les couleurs, les etiquettes. Le changement est
   ensuite un FONDU (la couche de fondu du viewer le tient pendant ce qui reste au
   mouvement), ce que la demande appelle "transform into the other gradually".
   ⚠ Un champ oublie dans cette liste couterait un rebatiment de trop par image - c'est la
   meme regle que `sceneRebuildSig` du viewer, et les deux vivent cote a cote pour que
   l'ecart se voie : `sceneRebuildSig` dit ce qui REBATIT, celle-ci dit ce qui GLISSE. */
export const FILM_GLIDE_KEYS = Object.freeze(['camera', 'fog', 'shadows', 'clip', 'background', 'quality']);

/** L'ETAT QU'UN INSTANT DE FILM POSE VRAIMENT - l'aspect de la pose la plus proche, plus ce
 *  qui glisse (voir FILM_GLIDE_KEYS). Sans `snap` (un instant fabrique a la main, un magasin
 *  d'avant cette session) le melange est rendu tel quel : rien n'est invente. */
export const filmSceneState = (sample) => {
  if (!sample) return null;
  const mixed = sample.state || null;
  if (!sample.snap) return mixed;
  const out = { ...sample.snap };
  FILM_GLIDE_KEYS.forEach((k) => {
    if (mixed && Object.prototype.hasOwnProperty.call(mixed, k)) out[k] = mixed[k];
    else delete out[k];
  });
  return out;
};

/* ---- LE PLAN DU FILM, LU AVANT LE CLIC --------------------------------- */
/** Frames, rate, length, pixels and Mbps of the film the 🔴 button would write.
 *  Nothing is clamped silently: an impossible film comes back with `ok:false`
 *  and the REASON the bar writes as-is (one pose is not a film, a list past
 *  VIDEO_MAX_FRAMES would never finish, a canvas with no size has nothing to
 *  record). `timeAt(i)` is the mapping the recorder is driven with, and it
 *  visits the first AND the last instant of the film — like the plan of a
 *  trajectory run, a film that stops before the end would be a truncated record
 *  of the gesture. */
export const keyframePlan = ({ keyframes, fps = VIDEO_DEFAULT_FPS, width = 0, height = 0, bitrate = 0 } = {}) => {
  const keys = Array.isArray(keyframes) ? keyframes : [];
  const rate = clampNum(fps, VIDEO_MIN_FPS, VIDEO_MAX_FPS, VIDEO_DEFAULT_FPS);
  const { totalSeconds } = keyframeLegs(keys);
  const frames = totalSeconds > 0 ? Math.max(1, Math.round(totalSeconds * rate)) : 0;
  const w = Math.max(0, Math.round(Number(width) || 0));
  const h = Math.max(0, Math.round(Number(height) || 0));
  const seconds = frames > 0 ? frames / rate : 0;
  const reason = keys.length < 2
    ? 'a film needs at least two poses — capture a second one (＋ Capture this pose)'
    : (Number(totalSeconds) <= 0
      ? 'the film lasts 0 s — give a keyframe a hold, or the morph before the last pose a duration'
      : (!w || !h ? 'the 3D canvas has no size yet — load a structure first' : ''));
  const capped = reason || (frames > VIDEO_MAX_FRAMES
    ? `the film would need ${frames} frames (max ${VIDEO_MAX_FRAMES}) — shorten the holds or lower the rate`
    : '');
  return {
    ok: !capped,
    reason: capped,
    frames: Math.min(VIDEO_MAX_FRAMES, frames),
    fps: rate,
    frameMs: 1000 / rate,
    seconds,
    secondsText: videoSecondsText(seconds),
    width: w,
    height: h,
    bitrate: Number(bitrate) > 0 ? Math.round(Number(bitrate)) : videoBitrateOf(w, h, rate),
    long: seconds >= VIDEO_LONG_RUN_SECONDS,
    totalSeconds,
    /* The instant of film frame `i`: frame 0 is the very first image of the film
       and the last frame is its very end. */
    timeAt: (i) => {
      if (frames <= 1) return 0;
      const n = Math.min(frames - 1, Math.max(0, Math.round(Number(i) || 0)));
      return (totalSeconds * n) / (frames - 1);
    },
  };
};

/** The one line the bar writes under the buttons: what will be written, before
 *  the click — the same contract as the 🎬 line of a trajectory run. */
export const keyframeFilmSummary = (count, plan) => {
  if (!plan) return '';
  if (!plan.ok) return `⚠️ ${plan.reason}`;
  const poses = `${count} pose${count === 1 ? '' : 's'}`;
  const frames = `${plan.frames} frame${plan.frames === 1 ? '' : 's'}`;
  return `🎞 ${poses} · ${frames} at ${plan.fps} fps → ${plan.secondsText} · `
    + `${plan.width}×${plan.height} px · ${(plan.bitrate / 1e6).toFixed(1)} Mbps`;
};
