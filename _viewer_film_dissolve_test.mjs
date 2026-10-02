/* =========================================================================
   _viewer_film_dissolve_test.mjs — UN MOUVEMENT TRANSFORME UN ASPECT EN L'AUTRE,
   GRADUELLEMENT, ET LA SCÈNE N'EST PLUS JAMAIS VIDE.

   LE RAPPORT DE CETTE SESSION, MOT POUR MOT : « In the movie, the transition between one
   state and the other is not smooth. there is a fraction of time where there is nothing. It
   would be better to see one move transform into the other gradually. »

   LES DEUX CAUSES, ET CE QUI LES VÉRIFIE ICI :

     1. LA SCÈNE ÉTAIT REBÂTIE À CHAQUE IMAGE. Un instant de mouvement MÉLANGE les réglages
        (`sampleKeyframeFilm` → `state`), et ce sont ceux que le constructeur de
        représentations lit : la signature de reconstruction changeait donc à chaque image, et
        NGL recalcule une surface / un cartoon DANS UN WORKER — l'image restait vide. Le
        spectateur repose maintenant l'ASPECT D'UNE POSE une fois par moitié de mouvement
        (`filmSceneState`), et l'invariant est EXÉCUTÉ ici : `sceneRebuildSig` — la fonction
        du viewer elle-même — est CONSTANTE le long d'une moitié, alors qu'elle changeait à
        chaque image avec le mélange. Seuls glissent le POINT DE VUE et les CINQ réglages de
        l'étage (`FILM_GLIDE_KEYS`), qui se reposent sans rien reconstruire.

     2. LE CHANGEMENT D'ASPECT ÉTAIT UNE COUPURE. Le viewer garde maintenant les
        représentations de l'aspect QUITTÉ et les éteint pendant que les nouvelles
        s'allument : un FONDU. La couche de fondu est EXTRAITE du .jsx et EXÉCUTÉE, avec de
        fausses représentations — on vérifie le poids de chaque image, l'opacité PROPRE de
        chaque représentation (une surface à 0,85 ne devient jamais opaque), et que le fondu
        se TERMINE toujours (les quittées partent, les nouvelles retrouvent leur opacité).

     3. LE FONDU N'EST PAS UN SECOND MOTEUR : c'est la MÊME fonction qui met un instant à
        l'écran (▶ de contrôle, 🔴 enregistreur, 👁) qui avance le fondu, donc ce qui est vu
        et ce qui est écrit ne peuvent pas diverger. Le câblage est lu dans la source, y
        compris les endroits où le fondu DOIT se terminer (⏹, une pose à la main, le retour
        de la scène après un enregistrement).

   Run: node _viewer_film_dissolve_test.mjs
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  sampleKeyframeFilm, filmSceneState, FILM_GLIDE_KEYS, keyframeLegs,
} from './src/utils/viewerKeyframes.js';

let passed = 0;
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const eq = (a, b, what) => {
  assert.deepEqual(a, b, `${what}\n  attendu : ${JSON.stringify(b)}\n  obtenu  : ${JSON.stringify(a)}`);
  passed += 1;
};
const near = (a, b, what, eps = 1e-9) => {
  assert.ok(Math.abs(a - b) <= eps, `${what} (${a} ≠ ${b})`);
  passed += 1;
};
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const VIEW = read('./src/components/NMRMoleculeViewer.jsx').replace(/\r\n/g, '\n');
const has = (needle, what) => {
  assert.ok(VIEW.includes(needle), `${what}\n  introuvable : ${needle}`);
  passed += 1;
};
const gone = (needle, what) => {
  assert.ok(!VIEW.includes(needle), `${what}\n  encore présent : ${needle}`);
  passed += 1;
};
/* Une fonction du .jsx, extraite du `const` à l'accolade qui la ferme à la colonne 0. */
const sliceFn = (name) => {
  const start = VIEW.indexOf(`const ${name} = `);
  assert.ok(start >= 0, `le viewer porte ${name}`);
  const body = VIEW.indexOf('{', VIEW.indexOf('=>', start));
  let depth = 0;
  for (let i = body; i < VIEW.length; i += 1) {
    if (VIEW[i] === '{') depth += 1;
    else if (VIEW[i] === '}') { depth -= 1; if (depth === 0) return `${VIEW.slice(start, i + 1)};\n`; }
  }
  throw new Error(`unterminated ${name}`);
};

/* ── 1. L'ASPECT D'UNE POSE, ET CE QUI GLISSE ─────────────────────────────────────────── */
const poseState = (tag, style) => ({
  v: 1,
  catStyles: { protein: { backbone: style, surface: 'hide' } },
  catLabels: { protein: { residues: false, residueType: false, atoms: false } },
  sectionLooks: { 'main::protein|all': { backbone: { style, opacity: tag === 'A' ? 0.2 : 0.8 } } },
  sectionVis: { 'main::protein|all': true },
  background: tag === 'A' ? '#000000' : '#ffffff',
  fog: tag !== 'A',
  quality: tag === 'A',
  clip: { on: false, near: 0, far: 100, dist: 0 },
  shadows: { on: tag === 'A', darkness: 0.2, az: 45, el: 30, color: '#ffffff' },
  molecules: { main: { style: 'auto', pos: tag === 'A' ? [0, 0, 0] : [9, 9, 9] } },
  camera: { q: [0, 0, 0, 1], p: [tag === 'A' ? 0 : 12, 0, 0], dist: tag === 'A' ? 40 : 80 },
  savedAt: `2026-01-0${tag === 'A' ? '1' : '2'}T00:00:00.000Z`,
});
const kf = (id, state, hold, morph, easing = 'linear') => ({
  id, name: id, hold, morph, easing, state,
  pose: [{ key: 'main', position: state.molecules.main.pos, quaternion: [0, 0, 0, 1] }],
});
/* Une pose tenue 0 s puis morphée en 2 s : à `at` secondes, u = at/2 et (easing linéaire) t = u. */
const KEYS = [kf('a', poseState('A', 'cartoon'), 0, 2), kf('b', poseState('B', 'ball+stick'), 1, 0)];
eq(keyframeLegs(KEYS).totalSeconds, 3, 'le film de deux poses dure 0 + 2 + 1 = 3 s');

eq(FILM_GLIDE_KEYS, ['camera', 'fog', 'shadows', 'clip', 'background', 'quality'],
  'les six réglages qui glissent sont DITS par le module (le point de vue et les cinq de l’étage)');

const firstHalf = sampleKeyframeFilm(KEYS, 0.6);
const secondHalf = sampleKeyframeFilm(KEYS, 1.6);
eq([firstHalf.kind, firstHalf.u, firstHalf.t], ['morph', 0.3, 0.3], 'le premier instant est un morphème à t = 0,3');
near(secondHalf.t, 0.8, 'le second est à t = 0,8 (la seconde moitié)');

/* L'ASPECT VIENT D'UNE POSE, LE RESTE DU MÉLANGE : c'est toute la règle. */
eq(filmSceneState(firstHalf).catStyles, KEYS[0].state.catStyles,
  'l’aspect appliqué au premier demi-mouvement est CELUI DE LA POSE DE DÉPART (le même objet)');
eq(filmSceneState(secondHalf).catStyles, KEYS[1].state.catStyles,
  '… et celui de la pose d’arrivée dans la seconde moitié');
eq(filmSceneState(firstHalf).camera, firstHalf.state.camera,
  '⚠ … tandis que le POINT DE VUE est celui du MÉLANGE (il glisse, il ne bascule pas)');
ok(filmSceneState(firstHalf).camera.p[0] > 0 && filmSceneState(firstHalf).camera.p[0] < 12,
  'la caméra est bien À MI-CHEMIN entre les deux poses du premier demi-mouvement');
{
  const bg = filmSceneState(firstHalf).background;
  ok(bg !== KEYS[0].state.background && bg !== KEYS[1].state.background && /^#[0-9a-f]{6}$/.test(bg),
    `… et le FOND GLISSE (un réglage de l’étage : ${bg} n’est ni le noir du départ ni le blanc d’arrivée)`);
}
eq(filmSceneState(firstHalf).fog, firstHalf.state.fog, '… le brouillard aussi (appliqué en place)');
eq(filmSceneState(firstHalf).quality, firstHalf.state.quality, '… la qualité aussi');
eq(filmSceneState(firstHalf).shadows, firstHalf.state.shadows, '… les ombres aussi');
eq(filmSceneState(firstHalf).clip, firstHalf.state.clip, '… et le clipping');
eq(filmSceneState(secondHalf).sectionLooks, KEYS[1].state.sectionLooks,
  'la seconde moitié porte les styles de la pose d’arrivée');
eq(sampleKeyframeFilm(KEYS, 0).snap, KEYS[0].state, 'au tout début, `snap` EST la première pose');
eq(sampleKeyframeFilm(KEYS, 2.5).snap, KEYS[1].state, 'à la fin du morphème, celle d’arrivée');
const one = [kf('a', poseState('A', 'cartoon'), 2, 0)];
eq(sampleKeyframeFilm(one, 1).snap, sampleKeyframeFilm(one, 1).state,
  '⚠ pendant une TENUE, `snap` et `state` sont le même objet (l’aspect est la pose elle-même)');
eq(filmSceneState(null), null, 'un instant absent ne fait rien appliquer');
eq(filmSceneState({ state: { x: 1 } }), { x: 1 },
  'sans `snap` (un instant fabriqué à la main), le mélange est rendu tel quel — rien n’est inventé');


/* ── 2. L'INVARIANT : UNE RECONSTRUCTION PAR MOITIÉ, PAS UNE PAR IMAGE ───────────────── */
const sceneRebuildSig = new Function('FILM_GLIDE_KEYS',
  `${sliceFn('sceneRebuildSig')} return sceneRebuildSig;`)(FILM_GLIDE_KEYS);
const sigAt = (at) => sceneRebuildSig(filmSceneState(sampleKeyframeFilm(KEYS, at)));
const rawSigAt = (at) => sceneRebuildSig(sampleKeyframeFilm(KEYS, at).state);
const FIRST_HALF = [0, 0.3, 0.6, 0.9, 0.999].map(sigAt);
const SECOND_HALF = [1.001, 1.3, 1.6, 1.9, 2].map(sigAt);
ok(FIRST_HALF.every((s) => s === FIRST_HALF[0]),
  '⚠ LE PREMIER DEMI-MOUVEMENT NE CHANGE PAS DE SIGNATURE : la scène n’est pas rebâtie à chaque image (le trou du rapport)');
ok(SECOND_HALF.every((s) => s === SECOND_HALF[0]),
  '⚠ LA SECONDE MOITIÉ NON PLUS : une reconstruction par mouvement, au milieu, là où l’aspect bascule');
ok(FIRST_HALF[0] !== SECOND_HALF[0], '… et les deux moitiés DIFFÈRENT : le changement d’aspect a bien lieu (une fois)');
const RAW = [0.2, 0.4, 0.6, 0.8].map(rawSigAt);
ok(new Set(RAW).size === RAW.length,
  '⚠ LE MÉLANGE, LUI, changeait de signature À CHAQUE IMAGE — c’est la cause du rebâtiment permanent (mesuré ici)');
{
  const s = filmSceneState(firstHalf);
  ok(sceneRebuildSig({ ...s, camera: { q: [0, 0, 0, 1], p: [99, 0, 0], dist: 12 } }) === FIRST_HALF[0],
    '⚠ la CAMÉRA n’entre PAS dans la signature : elle peut glisser à chaque image sans rien rebâtir');
  ok(sceneRebuildSig({ ...s, molecules: { main: { style: 'auto', pos: [5, 5, 5] } } }) === FIRST_HALF[0],
    '⚠ la PLACE DES MOLÉCULES non plus — c’est ce qui laisse un mouvement se dessiner sans être reconstruit');
}


/* ── 3. LE FONDU, EXÉCUTÉ ─────────────────────────────────────────────────────────────── */
const FADE_SRC = ['repOpacityOf', 'setRepOpacity', 'endFilmDissolve', 'startFilmDissolve', 'stepFilmDissolve']
  .map(sliceFn).join('');
const makeFade = () => {
  const filmFadeRef = { current: null };
  const filmMoveRef = { current: null };
  const api = new Function('reprOfElement', 'filmFadeRef', 'filmMoveRef',
    `${FADE_SRC} return { repOpacityOf, setRepOpacity, endFilmDissolve, startFilmDissolve, stepFilmDissolve };`)(
    (el) => (el && el.repr) || null, filmFadeRef, filmMoveRef,
  );
  return { ...api, filmFadeRef, filmMoveRef };
};
const fakeRep = (opacity) => {
  const repr = {
    opacity,
    setParameters: (p) => { if ('opacity' in p) repr.opacity = p.opacity; },
  };
  return { el: { repr }, repr };
};
const fakeComp = () => {
  const removed = [];
  return { removed, removeRepresentation: (el) => removed.push(el) };
};
{
  const fade = makeFade();
  const comp = fakeComp();
  const leaving = [fakeRep(1), fakeRep(0.4)];        // une opaque, une déjà translucide
  const arriving = [fakeRep(1), fakeRep(0.85)];      // …et une surface à 0,85
  fade.filmMoveRef.current = { active: true, t: 0.5 };
  eq(fade.startFilmDissolve(comp, leaving.map((r) => r.el), arriving.map((r) => r.el)), true,
    'le changement d’aspect d’un MOUVEMENT ouvre un fondu');
  eq(comp.removed.length, 0, '⚠ AUCUNE représentation n’est retirée au début du fondu : la scène n’est jamais vide');
  near(leaving[0].repr.opacity, 1, 'l’aspect quitté est encore entier au moment du changement');
  near(leaving[1].repr.opacity, 0.4, '⚠ …à SON opacité à elle (une rangée translucide reste translucide)');
  near(arriving[0].repr.opacity, 0, 'l’aspect neuf est INVISIBLE au premier instant');
  near(arriving[1].repr.opacity, 0, '…toutes ses représentations, y compris la surface à 0,85');

  fade.stepFilmDissolve(0.625);                      // w = (0,625 − 0,5)/0,5 = 0,25
  near(leaving[0].repr.opacity, 0.75, 'un quart du mouvement plus tard, l’ancien a perdu un quart');
  near(arriving[0].repr.opacity, 0.25, '…et le neuf en a gagné un quart');
  near(arriving[1].repr.opacity, 0.85 * 0.25, '⚠ la surface suit SON opacité (0,85 × 0,25), pas 1 × 0,25');

  fade.stepFilmDissolve(0.75);                       // w = 0,5
  near(leaving[0].repr.opacity, 0.5, 'à mi-fondu, les deux aspects sont à parts égales');
  near(arriving[0].repr.opacity, 0.5, '…exactement');

  fade.stepFilmDissolve(1);                          // w = 1 → fin
  eq(comp.removed.length, 2, '⚠ À LA FIN DU FONDU, les représentations quittées SONT retirées (aucune ne reste à moitié éteinte)');
  eq(fade.filmFadeRef.current, null, '…et le fondu est refermé');
  near(arriving[0].repr.opacity, 1, '⚠ les nouvelles retrouvent LEUR opacité d’origine (1)');
  near(arriving[1].repr.opacity, 0.85, '…et la surface retrouve la sienne (0,85), elle n’est pas rendue opaque');
}

{
  /* UN GESTE DE LA BARRE N’ATTEND PAS : pas de mouvement en cours, donc pas de fondu. */
  const fade = makeFade();
  const comp = fakeComp();
  const leaving = [fakeRep(1), fakeRep(1)];
  fade.filmMoveRef.current = { active: false, t: 0 };
  eq(fade.startFilmDissolve(comp, leaving.map((r) => r.el), [fakeRep(1).el]), false,
    'hors d’un mouvement du film, il n’y a PAS de fondu (un geste de la barre se voit tout de suite)');
  eq(comp.removed.length, 2, '…les représentations quittées partent à l’instant, comme avant cette session');
}
{
  /* UN FONDU INTERROMPU SE TERMINE : ⏹, une pose à la main, le retour de la scène. */
  const fade = makeFade();
  const comp = fakeComp();
  const leaving = [fakeRep(1)];
  const arriving = [fakeRep(1)];
  fade.filmMoveRef.current = { active: true, t: 0.5 };
  fade.startFilmDissolve(comp, leaving.map((r) => r.el), arriving.map((r) => r.el));
  fade.stepFilmDissolve(0.6);
  ok(arriving[0].repr.opacity < 1, 'un fondu à mi-chemin laisse l’aspect neuf à moitié allumé');
  eq(fade.endFilmDissolve(), true, 'endFilmDissolve ferme le fondu ouvert');
  eq(comp.removed.length, 1, '…il retire l’aspect quitté');
  near(arriving[0].repr.opacity, 1, '…et remet l’aspect neuf à son opacité pleine (aucune trace du fondu)');
  eq(fade.endFilmDissolve(), false, 'refermer un fondu déjà fermé ne fait rien (aucune erreur sur un film arrêté)');
  eq(fade.stepFilmDissolve(0.9), undefined, 'avancer un fondu absent ne fait rien non plus');
}
{
  /* UN SEUL FONDU À LA FOIS : un second changement referme le premier avant d’ouvrir le sien. */
  const fade = makeFade();
  const comp = fakeComp();
  const first = [fakeRep(1)];
  const second = [fakeRep(1)];
  fade.filmMoveRef.current = { active: true, t: 0.5 };
  fade.startFilmDissolve(comp, first.map((r) => r.el), second.map((r) => r.el));
  const third = [fakeRep(1)];
  fade.startFilmDissolve(comp, second.map((r) => r.el), third.map((r) => r.el));
  eq(comp.removed.length, 1, 'le premier fondu est refermé (sa moitié quittée est retirée)');
  near(second[0].repr.opacity, 0, '…et l’aspect qu’il venait d’allumer est repris comme le nouveau « quitté »');
}
{
  /* UNE REPRÉSENTATION SANS OPACITÉ LISIBLE (un magasin abîmé, un rep exotique) retombe sur 1. */
  const fade = makeFade();
  eq(fade.repOpacityOf(null), 1, 'une entrée absente vaut 1 (aucun NaN dans un fondu)');
  eq(fade.repOpacityOf({}), 1, 'un élément sans représentation vaut 1');
  eq(fade.repOpacityOf({ repr: { opacity: 2 } }), 1, 'une opacité hors bornes est RAMENÉE dans les bornes');
  eq(fade.repOpacityOf({ repr: { opacity: -3 } }), 0, '…aussi vers le bas');
  eq(fade.repOpacityOf({ repr: { opacity: 'nope' } }), 1, 'une opacité illisible vaut 1');
  const silent = { repr: { opacity: 1, setParameters: () => { throw new Error('refusé'); } } };
  eq(fade.setRepOpacity(silent, 0.5), undefined, '⚠ une opacité que NGL refuse ne fait jamais lever le fondu');
}


/* ── 4. LE CÂBLAGE DU VIEWER ──────────────────────────────────────────────────────────── */
/* L'ASPECT NEUF EST CONSTRUIT AVANT QUE L'ANCIEN NE PARTE. */
has('const leaving = baseCompsRef.current;', 'la reconstruction retient l’aspect QUITTÉ au lieu de le retirer');
has('    startFilmDissolve(component, leaving, baseCompsRef.current);',
  '…elle construit le neuf, PUIS demande le fondu (l’ancien ne part pas avant que le neuf existe)');
gone('    baseCompsRef.current.forEach((r) => { try { component.removeRepresentation(r); } catch {} });\n    baseCompsRef.current = [];\n    buildMainReps();',
  '⚠ l’ancien code — retirer TOUT avant de reconstruire — a disparu (le trou ne peut pas revenir)');
has('const filmMoveRef = useRef(null);        // { active, t } — le dernier instant de MOUVEMENT posé',
  'le viewer retient le dernier instant de MOUVEMENT (sa progression, son drapeau)');
has("const moving = driven && sample.kind === 'morph';",
  '⚠ le fondu n’existe que pendant un vrai MOUVEMENT conduit par un film (une tenue est un arrivé)');
has('if (moving) stepFilmDissolve(filmMoveRef.current.t);',
  '…et c’est la MÊME fonction qui met l’instant à l’écran qui avance le fondu (le vu et l’écrit ne divergent pas)');
has('else endFilmDissolve();',
  '…tandis qu’une tenue referme un fondu encore ouvert (le fondu est déclaré ouvert seulement par un MOUVEMENT)');
has('applyKeyframeSample({ state: key.state, pose: key.pose }, false);',
  '👁 montrer une pose n’est pas un mouvement : elle se pose d’un coup, aucun fondu n’est ouvert');
has('applyKeyframeSample(back, false);', '…comme le RETOUR de la scène après un enregistrement');
has('  filmMoveRef.current = null;\n  endFilmDissolve();',
  '⏹ referme le fondu au lieu de laisser la scène à moitié éteinte');
has('const repOpacityOf = (el) => {', 'le fondu lit l’opacité PROPRE de chaque représentation');
has('  const r = reprOfElement(el);\n  const v = r ? Number(r.opacity) : NaN;', '…sur la représentation elle-même');
has('try { r.setParameters({ opacity: Math.min(1, Math.max(0, v)) }); }',
  '…et il la pose par `setParameters({ opacity })` — le chemin EN PLACE de NGL');
const KEYFRAMES = read('./src/utils/viewerKeyframes.js').replace(/\r\n/g, '\n');
ok(KEYFRAMES.includes('FILM_GLIDE_KEYS.forEach((k) => {\n    if (mixed && Object.prototype.hasOwnProperty.call(mixed, k)) out[k] = mixed[k];'),
  'le module du 🎞 ne laisse glisser que les six réglages de FILM_GLIDE_KEYS (les autres viennent de la pose)');
ok(KEYFRAMES.includes('    snap: t < 0.5 ? from.state : to.state,'),
  'l’instant de film porte l’ASPECT de la pose la plus proche (le basculement du mélange, au milieu)');
ok(KEYFRAMES.includes('state: from.state, snap: from.state, pose: from.pose'),
  '…et une tenue porte la sienne (le même objet que son état : rien n’est recopié)');

/* ── 5. POURQUOI C'EST EN PLACE : LA SOURCE DE NGL INSTALLÉE LE DIT ───────────────────── */
/* Les suites du viewer lisent la source de ngl installée quand un fait de NGL décide du
   design (voir _viewer_materials_test.mjs) : ici, c'est ce qui rend un fondu PAR IMAGE
   possible sans rebâtir quoi que ce soit. */
const NGL_REP = read('./_ngl_src/representation__representation.ts').replace(/\r\n/g, '\n');
const NGL_BUF = read('./_ngl_src/src__buffer__buffer.ts').replace(/\r\n/g, '\n');
const opacityAt = NGL_REP.indexOf('      opacity: {');
const opacityParam = NGL_REP.slice(opacityAt, opacityAt + 120);
ok(opacityParam.includes("type: 'range'") && opacityParam.includes('buffer: true'),
  'ngl : `opacity` est déclaré `buffer: true` dans les paramètres d’une représentation');
ok(NGL_REP.includes('    if (rebuild) {\n      this.build()\n    } else {\n      this.updateParameters(bufferParams, what)'),
  '…et `setParameters` n’appelle `build()` que pour un paramètre déclaré `rebuild` : une opacité ne rebâtit RIEN');
ok(NGL_BUF.includes('opacity: { uniform: true }'), 'ngl : l’opacité est un UNIFORME de shader (posée en place)');
ok(NGL_BUF.includes("if (name === 'opacity') {\n        this.setProperties({ transparent: this.transparent })"),
  '…et `transparent` suit l’opacité : un aspect à 0,5 est vraiment translucide (le fondu se voit)');

console.log(`_viewer_film_dissolve_test.mjs — ${passed} assertions OK (un aspect par moitié de mouvement · fondu EXÉCUTÉ · ⏹ le referme · l'opacité est un uniforme de ngl)`);

