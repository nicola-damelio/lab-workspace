/* =========================================================================
   src/utils/viewerRayShadowLive.js
   LES OMBRES PORTÉES DU RÉTROPROJECTEUR — PENDANT QUE LA MOLÉCULE BOUGE.

   LA DEMANDE DE CETTE SESSION : « wow! it works! will it be possible to see it
   while the molecule is moving and not only as a still picture? »

   POURQUOI CE MODULE EXISTE, ET POURQUOI IL N'EST PAS LE MODULE DU « RAY ».
   L'ombre du « ✨ Ray » (utils/viewerRayShadows.js) n'est pas un effet de la
   « ray » : c'est une fonction PURE de (atomes, caméra, lampe, taille,
   options). Si elle n'apparaît que dans un PNG, c'est la CHAÎNE qui est un
   « still » — décoder un PNG, multiplier, ré-encoder. Le module des ombres ne
   connaît ni PNG ni Blob ; celui-ci s'en sert tel quel et écrit la même ombre
   AILLEURS : dans une toile 2D transparente posée sur la toile WebGL.

   POURQUOI UNE TOILE NOIRE D'ALPHA `s·m` EST EXACTEMENT L'OMBRE DU PNG. Le still
   multiplie chaque canal par `1 − s·m` (voir applyShadowToPixels). Une toile
   noire d'alpha `a` posée en `source-over` donne `dst·(1 − a)` : avec
   `a = s·m`, c'est LE MÊME produit, au 1/255 près. MESURÉ sur de vrais pixels
   WebGL (_viewer_ray_shadow_pixels_test.cjs) : écart MAXIMAL d'une unité par
   canal, zéro pixel à plus de deux unités, fond jamais sali. Le direct ne
   montre donc pas « une ombre approchée » : il montre la même.

   POURQUOI TROIS QUALITÉS, ET POURQUOI `auto` EST CELLE PAR DÉFAUT. Le masque
   coûte ce que coûtent ses PIXELS et ses TRIANGLES. Mesuré (Chrome headless,
   toile 900×600, hélice de 20 / 600 / 1400 résidus) :
       · relire le rig        1,7 ms   ·   11 ms   ·   16 ms   par image
       · masque 900×600        84 ms   ·  151 ms   ·  286 ms
       · masque 700 px         48 ms   ·   79 ms   ·  130 ms
       · masque 350 px         13 ms   ·   61 ms   ·  104 ms
       · peindre la toile       7 ms   ·   15 ms   ·   12 ms
   soit, image par image : 18 / 13 / 7,5 img/s en qualité « ray », et 103 / 20 /
   13 img/s en brouillon. Un masque plus petit ne raccourcit PAS les grosses
   scènes autant qu'il les éclaircit (c'est la rasterisation de 72 000 à
   168 000 triangles qui domine) — d'où les trois régimes :
       · 'auto'  (DÉFAUT) : brouillon pendant le geste, PLEINE qualité dès que
                   le mouvement s'arrête (RAY_LIVE_DEFAULTS.idleMs). On bouge à
                   100 img/s sur un peptide et on s'arrête sur l'ombre exacte.
       · 'full'  : la qualité du « ✨ Ray » à chaque image (7 à 18 img/s).
       · 'draft' : le brouillon toujours (le plus léger, le plus doux : il ne
                   rejoint jamais tout à fait l'ombre du PNG).
   La largeur du brouillon s'ADAPTE d'elle-même (nextDraftWidth) : le coût est
   proportionnel aux pixels du masque, donc à sa largeur au carré — une machine
   ou une scène qui dépasse le budget d'une image est ramenée dedans en
   rétrécissant le masque, au lieu de laisser la vue saccader.

   CE QU'IL NE FAIT PAS, ET QUI EST DIT. NGL 2.4 n'a AUCUNE passe d'ombre : la
   couche est donc une toile 2D PAR-DESSUS la toile WebGL. Un `captureStream`
   ne la verrait jamais — c'est déjà vrai de la vignette 🌑 Darkness, et c'est
   DÉJÀ résolu pour elle : le viewer compose sa toile de film image par image
   (`filmCanvasFor` / `beforeCapture`), et la couche y entre par un
   `drawImage`. Le 🎬 de la trajectoire porte donc l'ombre par la même raison et
   par le même chemin, pas par un second mécanisme.
   ========================================================================= */
import { rayShadowInputsOf, buildRayShadowMask, rayShadowOptions } from './viewerRayShadows.js';

/* Les trois régimes, dans l'ordre où la barre les propose. */
export const RAY_LIVE_QUALITIES = Object.freeze(['auto', 'full', 'draft']);
export const RAY_LIVE_DEFAULTS = Object.freeze({
  quality: 'auto',
  /* Combien de temps sans mouvement avant la reconstruction NETTE. 220 ms : le
     temps qu'un relâchement de souris ou la fin d'une image de trajectoire
     passent inaperçus, et bien moins qu'un clignement. */
  idleMs: 220,
  /* La résolution du BROUILLON (le still, lui, plafonne à 1400 : c'est sa
     valeur, et elle ne bouge pas). */
  draftMaskWidth: 420,
  draftTaps: 4,
  /* Le budget d'une image de brouillon, en ms : au-dessus, la largeur du
     brouillon est revue à la baisse (nextDraftWidth). */
  targetMs: 45,
  minDraftWidth: 200,
  maxDraftWidth: 700,
  /* Deux poses sont « la même » sous cette différence : une caméra au repos
     n'écrit pas des matrices exactement égales d'une image à l'autre. */
  poseEpsilon: 1e-4,
  /* LE FILET. Ce qui bouge sans changer ni la pose ni la signature (une torsion
     pincée, une section cachée, une représentation construite) n'est pas
     visible gratuitement image par image : toute image rendue plus de 400 ms
     après la dernière ombre en redemande une. C'est un plancher de 2,5 Hz, pas
     une boucle : une scène immobile qui se rend pour rien ne recalcule pas.
     `0` DÉSACTIVE le filet (c'est ainsi que la politique se mesure seule, dans
     _viewer_ray_shadow_live_test.mjs) — sans quoi « 0 ms » voudrait dire
     « recalcule à chaque image », soit exactement l'inverse du but. */
  staleMs: 400,
});


/* La qualité, quelle que soit la façon dont elle arrive (une case, une chaîne,
   un réglage oublié) : tout ce qui n'est pas connu vaut le DÉFAUT. */
export const rayLiveQualityOf = (value) => (RAY_LIVE_QUALITIES.includes(value) ? value : RAY_LIVE_DEFAULTS.quality);

/* LE RÉGLAGE DE LA BARRE — les trois régimes, plus `off`. Il est SÉPARÉ de la
   qualité : la barre peut éteindre la couche vivante sans toucher au régime
   mémorisé, et le pilote, lui, ne connaît que les trois régimes. */
export const RAY_LIVE_SETTINGS = Object.freeze(['off', ...RAY_LIVE_QUALITIES]);
export const rayLiveSettingOf = (value) => (RAY_LIVE_SETTINGS.includes(value) ? value : RAY_LIVE_DEFAULTS.quality);

/* Les options d'ombre d'un régime. Le still et le direct doivent pouvoir
   produire EXACTEMENT le même masque : en 'full', les options sont rendues
   telles quelles (donc identiques à celles du « ✨ Ray ») ; en 'draft', la
   largeur du masque et le nombre d'échantillons sont les seuls à changer. */
export const rayLiveShadowOptions = (options = {}, mode = 'full', defaults = RAY_LIVE_DEFAULTS) => {
  const o = rayShadowOptions(options);
  if (mode !== 'draft') return o;
  const width = Math.max(64, Math.round(Number(defaults.draftMaskWidth) || 0) || RAY_LIVE_DEFAULTS.draftMaskWidth);
  const taps = Math.max(1, Math.round(Number(defaults.draftTaps) || 0) || RAY_LIVE_DEFAULTS.draftTaps);
  return { ...o, maskMaxWidth: Math.min(o.maskMaxWidth, width), pcfTaps: Math.min(o.pcfTaps, taps) };
};

/* LA DÉCISION D'UNE IMAGE — pure, donc mesurable sans navigateur.
   `moving` dit que la POSE vient de changer ; `sinceMoveMs` dit depuis combien
   de temps elle ne bouge plus. Renvoie le régime à peindre et s'il y a lieu de
   repeindre : c'est ce qui évite de recalculer un masque identique quand
   l'utilisateur ne touche à rien. */
export const rayLiveDecision = ({ quality, moving = false, sinceMoveMs = 0, idleMs, lastMode = null } = {}) => {
  const q = rayLiveQualityOf(quality);
  const idle = Math.max(0, Number(idleMs) || 0);
  if (q === 'full') return { mode: 'full', rebuild: true, why: 'full' };
  if (q === 'draft') return { mode: 'draft', rebuild: true, why: 'draft' };
  if (moving) return { mode: 'draft', rebuild: true, why: 'moving' };
  if (Number(sinceMoveMs) >= idle) {
    /* Le geste est fini : une dernière passe NETTE, et une seule. */
    return lastMode === 'full'
      ? { mode: 'full', rebuild: false, why: 'idle-sharp' }
      : { mode: 'full', rebuild: true, why: 'idle-refine' };
  }
  return { mode: lastMode || 'draft', rebuild: false, why: 'idle-wait' };
};

/* LA LARGEUR DU BROUILLON QUI TIENT DANS LE BUDGET. Le coût d'un masque est
   proportionnel à ses pixels, donc au carré de sa largeur : pour diviser le
   temps par k, il faut rétrécir la largeur par √k. On ne grandit que d'un
   quart par image (pour ne pas osciller), et jamais au-delà du maximum. */
export const nextDraftWidth = (lastMs, width, defaults = RAY_LIVE_DEFAULTS) => {
  const min = Math.max(64, Math.round(Number(defaults.minDraftWidth) || RAY_LIVE_DEFAULTS.minDraftWidth));
  const max = Math.max(min, Math.round(Number(defaults.maxDraftWidth) || RAY_LIVE_DEFAULTS.maxDraftWidth));
  const clamp = (v) => Math.min(max, Math.max(min, Math.round(v)));
  const w = clamp(Number(width) || RAY_LIVE_DEFAULTS.draftMaskWidth);
  const ms = Number(lastMs);
  const target = Math.max(1, Number(defaults.targetMs) || RAY_LIVE_DEFAULTS.targetMs);
  if (!Number.isFinite(ms) || ms <= 0) return w;
  const scale = Math.min(1.25, Math.max(0.4, Math.sqrt(target / ms)));
  return clamp(w * scale);
};

/* LE POSEUR DE LA COUCHE — la partie pure : un masque, une force, des pixels
   RGBA. Chaque pixel du masque devient du NOIR d'alpha `s·m` ; le compositeur
   fera `dst·(1 − a)`, soit le produit du PNG. Renvoie le nombre de pixels
   réellement peints (donc la surface de l'ombre). */
export const maskAlphaInto = (imageData, mask, strength) => {
  if (!imageData || !imageData.data || !mask) return 0;
  const data = imageData.data;
  const s = Math.min(1, Math.max(0, Number(strength) || 0));
  const n = Math.min(mask.length, Math.floor(data.length / 4));
  let painted = 0;
  for (let i = 0, j = 0; i < n; i += 1, j += 4) {
    const a = s * (mask[i] || 0);
    data[j] = 0;
    data[j + 1] = 0;
    data[j + 2] = 0;
    if (a <= 0) { data[j + 3] = 0; continue; }
    data[j + 3] = a >= 1 ? 255 : (a * 255) | 0;
    if (data[j + 3] > 0) painted += 1;
  }
  return painted;
};

/* LA POSE D'UNE CAMÉRA NGL, en seize nombres comparables. ⚠ `camera.view` d'NGL
   n'est PAS la pose : c'est le view-offset d'un rendu tuilé (le module des
   ombres refuse une caméra au milieu d'une tuile à cause de ça). La pose, celle
   que `cameraFromViewer` lit, c'est `matrixWorldInverse`. */
export const poseOf = (viewer) => {
  const cam = (viewer && (viewer.camera || viewer.perspectiveCamera || viewer.orthographicCamera)) || null;
  const m = cam && (cam.matrixWorldInverse || cam.matrix);
  const e = m && (m.elements || m);
  if (!e || e.length < 16) return null;
  const out = new Array(16);
  for (let i = 0; i < 16; i += 1) out[i] = Number(e[i]) || 0;
  return out;
};

/* Deux poses sont-elles la même ? Comparaison terme à terme, avec une
   tolérance : une caméra immobile n'écrit pas toujours des matrices
   strictement égales. */
export const samePose = (a, b, epsilon = RAY_LIVE_DEFAULTS.poseEpsilon) => {
  if (!a || !b) return false;
  for (let i = 0; i < 16; i += 1) if (Math.abs(a[i] - b[i]) > epsilon) return false;
  return true;
};

/* LA SIGNATURE DE LA SCÈNE, hors caméra : ce qui peut bouger sans elle. Une
   molécule qui JOUE une trajectoire ne bouge pas la caméra — elle change de
   `currentFrame` ; un glissement la déplace par `rotationGroup` /
   `translationGroup` (c'est `viewerMatrixOf` du module des ombres qui les lit) ;
   un composant tourné porte son propre `matrix`. Tout cela tient en une
   cinquantaine de nombres, lus en quelques microsecondes : la comparaison est
   donc faite à CHAQUE image rendue, sans coût mesurable — contrairement à
   `atomsFromStage`, qui relit et transforme toute la géométrie (1 à 16 ms). */
export const sceneSignatureOf = (stage) => {
  const comps = (stage && stage.compList) || [];
  const viewer = stage && stage.viewer;
  const rot = viewer && viewer.rotationGroup && viewer.rotationGroup.matrix;
  const re = rot && (rot.elements || rot);
  const pos = viewer && viewer.translationGroup && viewer.translationGroup.position;
  const parts = [comps.length];
  if (re) for (let i = 0; i < 16; i += 1) parts.push(Math.round((Number(re[i]) || 0) * 1000));
  if (pos) parts.push(Math.round((Number(pos.x) || 0) * 100), Math.round((Number(pos.y) || 0) * 100), Math.round((Number(pos.z) || 0) * 100));
  comps.forEach((comp) => {
    const e = comp && comp.matrix && (comp.matrix.elements || comp.matrix);
    const reps = (comp && comp.reprList) || [];
    parts.push(comp && comp.visible === false ? 0 : 1, Number(comp && comp.currentFrame) || 0, reps.length);
    if (e) for (let i = 0; i < 15; i += 1) parts.push(Math.round((Number(e[i]) || 0) * 1000));
  });
  return parts.join(',');
};

/* ---- LA COUCHE, DANS LE DOM ----------------------------------------------
   La toile est FOURNIE par l'appelant (le viewer la rend dans son propre JSX,
   au-dessus de la toile WebGL, `pointer-events: none` et étirée en CSS) : ce
   module ne fabrique aucun élément et ne touche à aucune mise en page. Sa
   taille EST celle du masque — le navigateur l'agrandit d'un bilinéaire, comme
   `applyShadowToPixels` échantillonne le sien : la même image, au même endroit.

   `paint` RÉÉCRIT TOUS les pixels (`putImageData` remplace, il ne compose pas) :
   là où le masque est nul l'alpha est nul, donc le fond reste le fond. Une
   ombre impossible (pas d'atome, masque vide) efface la couche au lieu de
   laisser l'ombre de l'image d'avant. */
export const createRayShadowOverlay = (element) => {
  if (!element || typeof element.getContext !== 'function') return null;
  const ctx = element.getContext('2d');
  if (!ctx || typeof ctx.putImageData !== 'function') return null;
  let image = null;
  let imageWidth = 0;
  let imageHeight = 0;

  const clear = () => {
    try {
      if (element.width !== 1 || element.height !== 1) { element.width = 1; element.height = 1; }
      image = null;
      imageWidth = 0;
      imageHeight = 0;
    } catch { /* une couche qu'on ne peut pas vider n'arrête rien */ }
  };

  const paint = (shadow) => {
    const mw = shadow && Math.round(Number(shadow.maskWidth) || 0);
    const mh = shadow && Math.round(Number(shadow.maskHeight) || 0);
    if (!shadow || !shadow.mask || !(mw > 0) || !(mh > 0)) { clear(); return 0; }
    if (element.width !== mw || element.height !== mh) {
      element.width = mw;
      element.height = mh;
      image = null;                       // un redimensionnement efface déjà la toile
    }
    if (!image || imageWidth !== mw || imageHeight !== mh) {
      image = ctx.createImageData(mw, mh);
      imageWidth = mw;
      imageHeight = mh;
    }
    const painted = maskAlphaInto(image, shadow.mask, shadow.strength);
    ctx.putImageData(image, 0, 0);
    return painted;
  };

  return { element, paint, clear, dispose: clear, size: () => [element.width, element.height] };
};


/* ---- LE PILOTE : LA POLITIQUE, LA BOUCLE, ET RIEN D'AUTRE ------------------
   Il s'accroche au signal `rendered` d'NGL — la seule façon de savoir QUAND la
   scène a bougé : la pose est comparée à la précédente (deux images identiques
   ne recalculent rien), le régime vient de `rayLiveDecision`, et le
   rafraîchissement NET est armé par une minuterie plutôt que par une image,
   parce qu'une caméra immobile ne rend plus rien — sans minuterie, l'ombre
   resterait en brouillon pour toujours.

   `light`, `options` et `quality` arrivent en FONCTION ou en valeur : la lampe
   du rig ◐ et les curseurs de la barre bougent, et le pilote doit lire l'état
   vivant sans qu'on le recrée (un démontage/remontage à chaque curseur ferait
   clignoter l'ombre). */
export const attachRayShadowLive = ({
  stage,
  overlay,
  light = () => [0, 0, 1],
  options = () => ({}),
  quality = RAY_LIVE_DEFAULTS.quality,
  defaults = RAY_LIVE_DEFAULTS,
  now = () => Date.now(),
  onStats = null,
  /* LES DEUX MOITIÉS INJECTABLES, comme le décodeur et l'encodeur du module du
     « Ray » : `readInputs` (le rig) et `buildMask` (le masque). Le pilote ne
     fait alors que ce qu'il promet — décider, peindre, réarmer — et sa
     politique se mesure sans NGL ni navigateur (_viewer_ray_shadow_live_test). */
  readInputs = rayShadowInputsOf,
  buildMask = buildRayShadowMask,
} = {}) => {
  const viewer = stage && stage.viewer;
  if (!overlay || !viewer) return null;
  const read = (v) => (typeof v === 'function' ? v() : v);
  const state = {
    quality: rayLiveQualityOf(read(quality)),
    mode: null, drafts: 0, fulls: 0, builds: 0,
    draftWidth: Math.round(Number(defaults.draftMaskWidth) || RAY_LIVE_DEFAULTS.draftMaskWidth),
    lastMs: 0, draftMs: 0, fullMs: 0, painted: 0, error: '',
  };
  let pose = null;
  let scene = null;
  let movedAt = 0;
  let lastBuiltAt = 0;
  let timer = null;
  let stopped = false;

  const stats = () => ({ ...state });
  const publish = () => { if (typeof onStats === 'function') { try { onStats(stats()); } catch { /* le diagnostic ne casse jamais la vue */ } } };

  const buildNow = (mode) => {
    const canvas = viewer.renderer && viewer.renderer.domElement;
    if (!canvas) return false;
    const width = Math.max(1, Math.round(Number(canvas.width) || 0));
    const height = Math.max(1, Math.round(Number(canvas.height) || 0));
    if (!width || !height) return false;
    /* Le brouillon lit la largeur APPRISE (state.draftWidth), pas le défaut :
       c'est ce qui le garde dans le budget d'une image. */
    const opts = rayLiveShadowOptions(read(options), mode, {
      draftMaskWidth: state.draftWidth,
      draftTaps: defaults.draftTaps,
    });
    const t0 = now();
    let shadow = null;
    try {
      const inputs = readInputs(stage, { lightDir: read(light), options: opts });
      shadow = buildMask({
        atoms: inputs.atoms, camera: inputs.camera, light: inputs.light,
        width, height, options: opts,
      });
    } catch (err) {
      state.error = (err && err.message) || String(err);
      overlay.clear();
      lastBuiltAt = now();               // une erreur persistante ne doit pas boucler à chaque image
      publish();
      return false;
    }
    const ms = now() - t0;
    state.painted = overlay.paint(shadow);
    state.error = '';
    state.mode = mode;
    state.lastMs = Math.round(ms);
    state.builds += 1;
    lastBuiltAt = now();
    if (mode === 'draft') {
      state.drafts += 1;
      state.draftMs = Math.round(ms);
      /* Le brouillon APPREND : une image trop chère rétrécit le masque suivant. */
      state.draftWidth = nextDraftWidth(ms, state.draftWidth, defaults);
    } else {
      state.fulls += 1;
      state.fullMs = Math.round(ms);
    }
    publish();
    return true;
  };


  const cancelRefine = () => { if (timer) { clearTimeout(timer); timer = null; } };
  const armRefine = () => {
    cancelRefine();
    if (stopped || state.quality === 'draft') return;
    /* ⚠ `Number(x) || défaut` ferait d'un `idleMs: 0` (mesuré par les tests)
       un 220 ms : une échéance EXPLICITE de zéro est respectée (1 ms, la plus
       petite minuterie utile). */
    const asked = Number(defaults.idleMs);
    const wait = Math.max(1, Number.isFinite(asked) ? asked : RAY_LIVE_DEFAULTS.idleMs);
    timer = setTimeout(() => { timer = null; step(false); }, wait);
  };

  /* Une image d'ombre : décider, puis peindre (et réarmer le NET si l'on vient
     de peindre un brouillon). */
  const step = (moving) => {
    if (stopped) return null;
    const decision = rayLiveDecision({
      quality: state.quality,
      moving,
      sinceMoveMs: now() - movedAt,
      idleMs: defaults.idleMs,
      lastMode: state.mode,
    });
    if (!decision.rebuild) return decision;
    const done = buildNow(decision.mode);
    if (done && decision.mode === 'draft' && state.quality !== 'draft') armRefine();
    return decision;
  };

  /* La scène a été rendue : a-t-elle BOUGÉ ? Deux réponses, et une seule
     question — la caméra (la pose), puis ce qui bouge sans elle (la signature
     de la scène : la trajectoire, un composant tourné, le groupe de la vue).
     Le FILET, lui, couvre ce qui n'est visible ni dans l'une ni dans l'autre
     (une torsion pincée, une section cachée) : toute image rendue plus de
     `staleMs` après la dernière ombre en redemande une. */
  const onRendered = () => {
    if (stopped) return;
    const view = poseOf(viewer);
    if (!view) return;
    const signature = sceneSignatureOf(stage);
    const moved = !samePose(view, pose, defaults.poseEpsilon) || signature !== scene;
    const staleGap = Math.max(0, Number(defaults.staleMs) || 0);
    const stale = !moved && staleGap > 0 && (now() - lastBuiltAt) >= staleGap;
    if (!moved && !stale) return;
    pose = view;
    scene = signature;
    if (moved) movedAt = now();
    step(true);
  };

  const signal = viewer.signals && viewer.signals.rendered;
  if (signal && typeof signal.add === 'function') signal.add(onRendered);

  return {
    stats,
    /* Un changement venu de la BARRE (la force, la douceur, la lampe, la
       qualité) : on repeint tout de suite, dans le régime de l'instant. */
    refresh ({ force = false } = {}) {
      if (stopped) return null;
      if (!force) return step(false);
      const decision = rayLiveDecision({
        quality: state.quality, moving: false,
        sinceMoveMs: now() - movedAt, idleMs: defaults.idleMs, lastMode: state.mode,
      });
      const done = buildNow(state.mode || decision.mode);
      /* ⚠ LA POSE EST REPRISE APRÈS UNE PEINTURE FORCÉE. Sinon la première
         image rendue ensuite croirait que la scène vient de bouger (la pose
         d'avant n'existe pas encore) et repeindrait un brouillon juste après
         une ombre NETTE — deux fois le travail pour la même image. */
      if (done) {
        pose = poseOf(viewer) || pose;
        scene = sceneSignatureOf(stage);
      }
      armRefine();
      return decision;
    },
    setQuality (value) {
      state.quality = rayLiveQualityOf(typeof value === 'function' ? value() : value);
      const decision = step(state.quality === 'auto');
      if (state.quality === 'auto') armRefine();
      return decision;
    },
    /* L'état courant, pour la barre (son titre dit ce qui vient de se passer). */
    state: stats,
    stop () {
      stopped = true;
      cancelRefine();
      if (signal && typeof signal.remove === 'function') signal.remove(onRendered);
      overlay.clear();
    },
  };
};

