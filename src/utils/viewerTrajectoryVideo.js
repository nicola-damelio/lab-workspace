/* =========================================================================
   src/utils/viewerTrajectoryVideo.js
   🎬 THE VIDEO OF A TRAJECTORY — the run the ▶ button plays, written as ONE
   file, frame for frame, EXACTLY as it is on screen.

   THE DEMAND: « in molecular viewer allow saving videos of the trajectory ».
   The viewer could already SHOW the run (▶ Play · frame slider · speed) and
   write ONE snapshot of it (⬇ the PDB of the frame displayed); a MOVIE of the
   run itself had to be made outside the app — a screen recorder over the page,
   with its own window in the film, its own cursor and its own frame rate.

   WHY THE CANVAS, AND NOTHING ELSE. The film is taken from the canvas NGL is
   drawing into (`viewer.renderer.domElement` — the very canvas the ✨ Ray still
   and the frame export read, see viewerRayImage.js): what is recorded is what
   is on screen, in the order the ▶ button plays it — the palettes of the ⚙
   wheel, the labels, the extra molecules of the Molecules bar, the ring plates,
   the fog, the light rig, the frame at every step. No second engine, no
   re-drawing: nothing can drift from the picture.

   ⚠ ET CE QUI N'EST PAS DANS LA TOILE N'Y SERA PAS. L'écran porte AUSSI des
   couches HTML par-dessus la toile — la vignette de ★ Shadows → 🌑 Darkness est
   celle qui change la COULEUR du fond — et un `captureStream` ne les voit jamais :
   les coins du film restaient plats quand ceux de l'écran étaient assombris (le
   rapport de cette session : « even the background is of different colours »).
   L'appelant peut donc COMPOSER ces couches dans la toile qu'il enregistre, une
   fois par image, par `beforeCapture` (voir filmVignetteGeometry /
   filmVignetteStops) : rien n'est redessiné, la scène est simplement recopiée
   dans une toile de film en 2D. ⚠ LE FOND LUI-MÊME N'EST PAS DANS LA TOILE non
   plus : NGL le réserve au CSS du canvas (clear d'alpha 0) — voir
   filmBackdropColor, sans quoi le fond d'un film est noir.

   HOW A BROWSER WRITES A VIDEO. `canvas.captureStream(fps)` gives a MediaStream
   fed by the canvas and `MediaRecorder` encodes it — both are standard and
   present in Chrome / Edge / Firefox / Opera and Safari 14.1+. TWO
   consequences the whole design follows from:

     · IT IS REAL TIME. A canvas stream samples the canvas AS THE CLOCK RUNS: a
       frame left on screen for 3 ms at 30 fps is simply absent from the film.
       Every frame is therefore PRESENTED, then HELD for its own duration
       (1/fps), and NGL is asked for a frame first — so what is held is the NEW
       picture, never the previous one. Recording N frames at F fps takes about
       N/F seconds: the progress line says where it is, and ⏹ Stop ends it at
       any moment (nothing is written then — an interrupted film is not a film
       of the run, and pretending otherwise would be a lie in the file).

     · IT IS LOSSY IN TIME ONLY. The frames ARE the frames: no interpolation, no
       re-timing. « Keep every Nth frame » is the ONE knob that shortens a
       video, and it shortens it HONESTLY: the frames that are kept are the run,
       in order — the film is simply faster than the run was.

   WHAT IT COSTS IS READABLE BEFORE THE CLICK (`videoPlan`): the number of
   frames, the length in m:ss and the bitrate the browser will be asked for.
   The canvas has no fixed size — it is the window's — so the bitrate follows
   the real pixels (`videoBitrateOf`), and long runs are FLAGGED (`long`), not
   silently refused: the user decides.

   AND WHY A HELD FRAME IS REALLY CAPTURED. A canvas stream hands over the canvas
   as the browser composites it, so a picture that was drawn and then HELD is
   still there when the stream asks for it — which is only true while the
   drawing buffer SURVIVES the frame. The ngl 2.4.0 this app loads builds its
   renderer as `new WebGLRenderer({ preserveDrawingBuffer: true, alpha: true,
   antialias: true })` (read in the shipped dist/ngl.js, the very file the CDN
   serves — see src/utils/ngl.js), so the buffer is kept and the held frame is
   never an empty canvas. An engine that CLEARED its buffer after compositing
   would need a fresh render in front of every capture; this one does not.

   WHAT THIS MODULE NEVER DOES: it never touches the scene (no representation
   rebuilt, no state changed, no preference written), it never uploads anything,
   and it never writes a file itself — it hands back the BLOB and the viewer's
   own ⬇ download path (utils/viewerRayImage.js → downloadBlob) writes it, like
   the ✨ Ray PNG and the frame PDB. Everything here is importable and
   executable under node (the DOM objects it needs are INJECTED or absent, see
   _viewer_trajectory_video_test.mjs): `MediaRecorder`, the canvas stream, the
   clock and the paint wait are all parameters of `recordTrajectoryVideo`.
   ========================================================================= */

import { rayStamp } from './viewerRayImage.js';

/* ---- The settings the bar offers ----------------------------------------- */
/* The frame rates: they are the PLAYBACK rates of the viewer (`speed`), so a
   film always lasts about as long as the run does on screen. */
export const VIDEO_FPS_CHOICES = Object.freeze([5, 10, 15, 20, 30]);
export const VIDEO_DEFAULT_FPS = 10;
export const VIDEO_MIN_FPS = 1;
export const VIDEO_MAX_FPS = 60;
/* « Keep every Nth frame » — the honest way to shorten a film (see the header). */
export const VIDEO_STEP_CHOICES = Object.freeze([1, 2, 5, 10, 25, 50]);
/* The container. webm is the one every browser that HAS a MediaRecorder can
   WRITE; mp4 comes last because only some can encode it. The candidate list is
   walked with the browser's own answer (`MediaRecorder.isTypeSupported`), and
   the mime that really landed is written on the blob AND in the file name. */
export const VIDEO_MIME_CANDIDATES = Object.freeze([
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4',
]);
export const VIDEO_DEFAULT_MIME = 'video/webm';
/* A hard ceiling on the frames of ONE recording — a run left at half a million
   frames is a mistake, not a film (the stride of the trajectory load is what
   the bar offers for that: « keep every Nth frame »). */
export const VIDEO_MAX_FRAMES = 20000;
/* The recorder hands over one chunk every this often, so a long film never
   holds everything in one buffer until the end. */
export const VIDEO_CHUNK_MS = 250;
/* A recorder that is asked to stop but never answers (a lost WebGL context in
   the middle of a run) must not hang the button: the film is built from the
   chunks that DID arrive. */
export const VIDEO_STOP_TIMEOUT_MS = 15000;
/* Above this length, the plan SAYS the run is long instead of hiding it. */
export const VIDEO_LONG_RUN_SECONDS = 180;

/* ---- Small local helpers -------------------------------------------------- */
const clampInt = (value, min, max, fallback) => {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

/** Every error of this module carries the ADVICE that goes with it (`hint`),
 *  which the viewer writes as-is after the message — exactly like the ✨ Ray
 *  module, so « try a slower rate » never lands on a lost WebGL context. */
export const videoError = (message, hint = '') => {
  const err = new Error(message);
  if (hint) err.hint = hint;
  return err;
};

/* ---- Can this browser record at all? --------------------------------------
   Asked BEFORE the button is armed, so a browser that cannot record says so
   instead of failing on the click. `win` is injectable (a test passes a stub). */
export const videoSupport = (win = typeof globalThis === 'undefined' ? null : globalThis) => {
  const hasRecorder = !!(win && typeof win.MediaRecorder === 'function');
  if (!hasRecorder) {
    return {
      ok: false,
      recorder: false,
      note: 'this browser cannot record video — MediaRecorder is not available (Chrome, Edge, Firefox or Safari 14.1+ can)',
    };
  }
  const proto = win.HTMLCanvasElement && win.HTMLCanvasElement.prototype;
  if (proto && typeof proto.captureStream !== 'function') {
    return {
      ok: false,
      recorder: true,
      note: 'this browser cannot record the 3D canvas — canvas.captureStream is not available',
    };
  }
  return { ok: true, recorder: true, note: '' };
};

/* The canvas NGL draws into — the same DOM access as viewerRayImage.js
   (`renderer.domElement` first, then `viewer.canvas`), guarded so a stub of a
   stage (a test, another engine) simply answers null. */
export const canvasOfStage = (stage) => {
  try {
    const viewer = stage && stage.viewer;
    if (!viewer) return null;
    const renderer = viewer.renderer;
    if (renderer && renderer.domElement) return renderer.domElement;
    return viewer.canvas || null;
  } catch { return null; }
};

/* ---- The mime the browser really accepts ---------------------------------- */
/** Walk `candidates` with the browser's own answer. A browser that has no
 *  `isTypeSupported` gets the default (webm): guessing there is honest, since
 *  the recorder itself will refuse a type it cannot write. `''` means NOTHING
 *  in the list is supported — the caller then records without a mimeType, which
 *  is what such a browser wants. */
export const videoMime = (isSupported = null, candidates = VIDEO_MIME_CANDIDATES) => {
  if (typeof isSupported !== 'function') return VIDEO_DEFAULT_MIME;
  for (const mime of candidates) {
    try { if (isSupported(mime)) return mime; } catch { /* a browser that throws on a string is not a reason to stop */ }
  }
  return '';
};

/** The extension of the file that will come out of a mime. */
export const videoExtension = (mime) => {
  const m = String(mime || '').toLowerCase();
  if (m.includes('mp4')) return 'mp4';
  return 'webm';
};

/* ---- WHAT A FRAME COSTS ---------------------------------------------------
   A 3D scene is not a camera feed: its pixels are mostly flat background, but
   the atoms, the labels and the fog move at every frame. 0.08 bit per pixel per
   second sits between « a blurry film » and « a file nobody wants to upload »:
   a 1600×900 canvas at 10 fps asks for ~1.2 Mbps and a 12 s film is a few
   megabytes. The result is kept between 1 and 24 Mbps — the floor so a tiny
   canvas is not encoded to mud, the ceiling so a 4K one does not ask for a rate
   no browser honours. */
export const videoBitrateOf = (width, height, fps, quality = 0.08) => {
  const w = Math.max(0, Math.round(Number(width) || 0));
  const h = Math.max(0, Math.round(Number(height) || 0));
  const rate = clampInt(fps, VIDEO_MIN_FPS, VIDEO_MAX_FPS, VIDEO_DEFAULT_FPS);
  const q = Number.isFinite(Number(quality)) && Number(quality) > 0 ? Number(quality) : 0.08;
  const bits = w * h * rate * q;
  if (!Number.isFinite(bits) || bits <= 0) return 1e6;
  return Math.round(Math.min(24e6, Math.max(1e6, bits)));
};

/* ---- « 12 » → « 0:12 » : a length, as a clock ----------------------------- */
export const videoSecondsText = (seconds) => {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};

/* ---- THE PLAN OF A RECORDING — read BEFORE the click -----------------------
   The bar shows all of this, so the price of a film is known before it starts:
   how many frames, how long it will take (the recording IS real time), and how
   many pixels the encoder is given. `keptFrames` is what the ▶ button plays
   (the frames really loaded, after the load stride — see the viewer), `step` is
   « keep every Nth frame ». Nothing is clamped silently: an impossible plan
   comes back with `ok:false` and the REASON the bar writes as-is.

   WHICH FRAMES, EXACTLY (`indexAt`). Frame `i` of the film is frame `i × step`
   of the run — and THE LAST FRAME OF THE RUN IS ALWAYS IN THE FILM (`tail`),
   even when the step does not divide the run evenly: a film of a run that stops
   before the end would be a truncated record of it, and « keep every 10th
   frame » is not a request to lose the last image. Everything the plan says
   (`frames`, `lastIndex`, `covers`) follows from that one rule. */
export const videoPlan = ({ keptFrames, fps = VIDEO_DEFAULT_FPS, step = 1, width = 0, height = 0, bitrate = 0 } = {}) => {
  const kept = Math.max(0, Math.round(Number(keptFrames) || 0));
  const rate = clampInt(fps, VIDEO_MIN_FPS, VIDEO_MAX_FPS, VIDEO_DEFAULT_FPS);
  const every = clampInt(step, 1, 1000, 1);
  const body = kept > 0 ? Math.floor((kept - 1) / every) + 1 : 0;              // 0, every, 2·every…
  const tail = kept > 0 && (kept - 1) % every !== 0 ? 1 : 0;                   // …plus the very last frame
  const frames = Math.min(VIDEO_MAX_FRAMES, body + tail);
  const indexAt = (i) => Math.min(kept - 1, Math.max(0, Math.round(Number(i) || 0)) * every);
  const w = Math.max(0, Math.round(Number(width) || 0));
  const h = Math.max(0, Math.round(Number(height) || 0));
  const seconds = frames > 0 ? frames / rate : 0;
  const lastIndex = frames > 0 ? indexAt(frames - 1) : 0;
  const reason = kept <= 0
    ? 'there is no trajectory frame to record yet — load a trajectory first'
    : (!w || !h ? 'the 3D canvas has no size yet — load a structure first' : '');
  return {
    ok: !reason,
    reason,
    frames,
    fps: rate,
    step: every,
    frameMs: 1000 / rate,
    seconds,
    secondsText: videoSecondsText(seconds),
    width: w,
    height: h,
    bitrate: Number(bitrate) > 0 ? Math.round(Number(bitrate)) : videoBitrateOf(w, h, rate),
    long: seconds >= VIDEO_LONG_RUN_SECONDS,
    /* The mapping the recorder is driven with, and the two facts it is checked
       against: the run is filmed to its END (`covers`), and it ends where the
       run ends (`lastIndex`). */
    indexAt,
    lastIndex,
    covers: kept > 0 && lastIndex >= kept - 1,
    keptFrames: kept,
  };
};

/* ---- The progress line, and the name of the file -------------------------- */
/** « 🎬 Recording… 12/121 frames · 0:01 of 0:12 » — the elapsed length is the
 *  one that matters, because the recording lasts as long as the film will. */
export const videoProgressText = (done, total, fps = VIDEO_DEFAULT_FPS) => {
  const t = Math.max(1, Math.round(Number(total) || 1));
  const d = Math.min(t, Math.max(0, Math.round(Number(done) || 0)));
  const rate = clampInt(fps, VIDEO_MIN_FPS, VIDEO_MAX_FPS, VIDEO_DEFAULT_FPS);
  return `🎬 Recording… ${d}/${t} frames · ${videoSecondsText(d / rate)} of ${videoSecondsText(t / rate)}`;
};

/* `Trajectory_<structure>_<frames>f_<fps>fps_<w>x<h>_<date>.webm` — the run's
   own numbers are in the name (frames, rate, size, DATE, like the ✨ Ray PNG),
   so two films of the same trajectory never overwrite each other and a file can
   be traced back to what produced it. Everything a file name cannot carry
   (spaces, accents, `/ \ : * ? " < > |`) becomes `_`. */
export const videoFileName = ({ label, frames, fps = VIDEO_DEFAULT_FPS, width = 0, height = 0, mime = '', date = new Date() } = {}) => {
  const raw = String(label == null ? '' : label)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_')
    .slice(0, 60) || 'trajectory';
  const n = Math.max(0, Math.round(Number(frames) || 0));
  const rate = clampInt(fps, VIDEO_MIN_FPS, VIDEO_MAX_FPS, VIDEO_DEFAULT_FPS);
  const size = `${Math.max(0, Math.round(Number(width) || 0))}x${Math.max(0, Math.round(Number(height) || 0))}`;
  return `Trajectory_${raw}_${n}f_${rate}fps_${size}_${rayStamp(date)}.${videoExtension(mime)}`;
};

/* ---- THE RECORDING -------------------------------------------------------- */
/* One paint of the browser, then one more: NGL draws on an animation frame, so
   the first rAF is when the new picture is DRAWN and the second when it has
   been PRESENTED — the earliest moment a canvas stream can hand it over. */
const waitTwoPaints = () => new Promise((resolve) => {
  if (typeof requestAnimationFrame !== 'function') { setTimeout(resolve, 0); return; }
  requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
});

/* The tracks of the canvas stream, given back to the browser: as long as one
   track lives, the page keeps its « recording » indicator. */
const stopStream = (stream) => {
  try {
    if (!stream || typeof stream.getTracks !== 'function') return;
    stream.getTracks().forEach((track) => { try { track.stop(); } catch { /* ignore */ } });
  } catch { /* ignore */ }
};

const blobOf = (chunks, type) => {
  if (typeof Blob !== 'function') return null;
  try { return new Blob(chunks, { type: type || VIDEO_DEFAULT_MIME }); } catch { return null; }
};

/* ---- 🖼 CE QU'UN FILM NE PEUT PAS PRENDRE À L'ÉCRAN ------------------------
   Le film est pris sur la toile de NGL. L'écran, lui, porte des couches HTML
   PAR-DESSUS cette toile — la vignette de ★ Shadows → 🌑 Darkness (un
   `radial-gradient` multiplié, voir le viewer) en est la seule qui change la
   COULEUR du fond — et aucune d'elles n'entre dans un `captureStream`. Le
   rapport de cette session : « the video generated for the trajectory is
   different from what I see on the screen … even the background is of different
   colours. » D'où `beforeCapture` : l'appelant compose ces couches dans la toile
   qu'il fait enregistrer.

   LES TROIS RÈGLES DE LA VIGNETTE SONT PURES (donc exécutées sous node par
   _viewer_trajectory_video_test.mjs) : la géométrie, les arrêts, et rien
   d'autre — c'est le viewer qui possède la toile et le contexte 2D. Elles
   reproduisent EXACTEMENT le CSS de la couche (`radial-gradient(ellipse at
   50% 40%, rgba(30,30,30,0) 45%, rgba(30,30,30,·) 72%, rgba(30,30,30,·) 100%)`) :
   même centre, mêmes arrêts, mêmes opacités, et l'ellipse « farthest-corner »
   du CSS — ses deux rayons sont les distances du centre au coin le plus loin
   (la moitié de la largeur, 60 % de la hauteur), donc elle passe par ce coin.
   Un `multiply` de canvas sur `rgba(30,30,30,α)` assombrit EXACTEMENT comme le
   `mix-blend-mode: multiply` du CSS (les deux valent `C·(1 − α·(225/255))`). */
export const FILM_VIGNETTE_RGB = [30, 30, 30];
/** Le centre et les deux rayons de l'ellipse de la vignette, en pixels. */
export const filmVignetteGeometry = (width, height) => {
  const w = Math.max(1, Number(width) || 1);
  const h = Math.max(1, Number(height) || 1);
  return {
    cx: w * 0.5,
    cy: h * 0.4,
    rx: Math.max(1, w * 0.5),        // le coin le plus loin en largeur
    ry: Math.max(1, h * 0.6),        // …et en hauteur (centre à 40 %)
  };
};
/** Les quatre arrêts de la vignette, dans l'ordre — `[position, couleur CSS]`. */
export const filmVignetteStops = (darkness) => {
  const d = Math.min(1, Math.max(0, Number(darkness) || 0));
  const [r, g, b] = FILM_VIGNETTE_RGB;
  const inner = 0.04 + d * 0.06;
  const outer = 0.12 + d * 0.18;
  return [
    [0, `rgba(${r},${g},${b},0)`],
    [0.45, `rgba(${r},${g},${b},0)`],
    [0.72, `rgba(${r},${g},${b},${inner.toFixed(4)})`],
    [1, `rgba(${r},${g},${b},${outer.toFixed(4)})`],
  ];
};

/* 🖼 LE FOND DU FILM — LA COULEUR DE LA SCÈNE, SOUS L'IMAGE (le rapport de cette
   session : « The saved movie always has a black background even if my movie was
   taken with white background. On the right there is always like an ellipse that is
   not part of the movie. »).

   POURQUOI LE FILM ÉTAIT NOIR. NGL NE PEINT PAS SON FOND DANS LA TOILE. Son
   `setBackground` fait les deux choses suivantes (viewer.setBackground, ngl 2.4) :
   `renderer.setClearColor(couleur, 0)` — un clear d'alpha ZÉRO — puis
   `domElement.style.backgroundColor = couleur`. Le fond que l'on voit à l'écran est
   donc la COULEUR CSS DU CANVAS, vue À TRAVERS une toile transparente ; c'est aussi
   ce qui permet à la vignette de ★ Shadows (une couche HTML multipliée PAR-DESSUS)
   d'assombrir ce fond. Un film, lui, n'a pas d'alpha : le WebM que MediaRecorder
   écrit est en YUV (même un codec qui sait porter un alpha n'est pas demandé ici),
   donc le transparent y devient NOIR. Et la vignette, multipliée sur un fond
   transparent, ne pouvait plus assombrir quoi que ce soit : ses quatre arrêts se
   peignaient tels quels, et l'ellipse apparaissait comme une tache au lieu d'être
   une ombre.

   LA RÈGLE. La toile de film (voir filmCanvasFor, dans le viewer) commence par
   REMPLIR son fond de la couleur de la scène, puis recopie la toile de NGL, puis
   peint la vignette : ce qui est enregistré est alors ce que l'œil voit — le fond
   de la figure, ses molécules et ses coins assombris. La couleur est celle que la
   barre porte (§2 Toolbar → 🌫 Scene → 🎨 Background, `bgColor` du viewer) ; une
   valeur qui n'est pas un `#rrggbb` retombe sur le fond par défaut du viewer, et
   jamais sur du noir : un film ne doit pas être plus sombre que l'écran. */
export const FILM_BACKDROP_DEFAULT = '#f8fafc';
/** La couleur de fond d'un film, VALIDÉE (`#rrggbb`), avec le fond par défaut en
 *  secours — la couleur d'une scène, jamais un noir imposé. */
export const filmBackdropColor = (value, fallback = FILM_BACKDROP_DEFAULT) => {
  const v = typeof value === 'string' ? value.trim() : '';
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase();
  const f = typeof fallback === 'string' ? fallback.trim() : '';
  return /^#[0-9a-fA-F]{6}$/.test(f) ? f.toLowerCase() : FILM_BACKDROP_DEFAULT;
};

/* ---- 🎬 RECORD THE RUN -----------------------------------------------------
   Drives ONE real-time pass of the run into a MediaRecorder, and resolves with
   the film. Everything the recording needs is a PARAMETER, so the whole drive
   loop is exercised under node with a fake recorder and a fake clock (see
   _viewer_trajectory_video_test.mjs) — and so the viewer can hand it the real
   ones.

   `presentFrame(i)` puts video frame `i` on screen (the viewer does
   `setFrameSafe(traj, toActualFrame(plan.indexAt(i)))`) and `requestRender`
   asks NGL for the frame; the module then waits for the picture to be
   presented and HOLDS it for 1/fps (see the header — this is what gives the
   film its rate). `onProgress(done, total)` feeds the bar's progress line.
   `beforeCapture(i)` is called once per frame, just after that wait and BEFORE
   the hold: it is the caller's one chance to compose into the recorded canvas
   what the canvas cannot carry by itself (see « CE QU'UN FILM NE PEUT PAS
   PRENDRE À L'ÉCRAN »). A caller with nothing to compose omits it.

   WHAT IT RETURNS, AND WHEN:
     · `{ blob, frames, seconds, mime }` — the film, built from the chunks the
       recorder handed over, typed with the mime that really landed.
     · `{ blob: null, cancelled: true }` — ⏹ Stop (or the run going away): the
       recorder is stopped and NOTHING is written; a film of half the run is not
       the film of the run.
   It THROWS (with a `hint`) when there is nothing to record, when the browser
   refuses the canvas, and when a recorder that was started produced no data at
   all — three different stories, each with its own advice. */
export const recordTrajectoryVideo = async (options = {}) => {
  const {
    canvas,
    frames,
    fps = VIDEO_DEFAULT_FPS,
    mime = '',
    bitrate = 0,
    presentFrame,
    requestRender,
    onProgress,
    onStarted,
    beforeCapture,
    cancelled,
    Recorder = typeof MediaRecorder === 'undefined' ? null : MediaRecorder,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    paint = waitTwoPaints,
    now = () => Date.now(),
    chunkMs = VIDEO_CHUNK_MS,
    stopTimeoutMs = VIDEO_STOP_TIMEOUT_MS,
  } = options;

  if (!canvas || typeof canvas.captureStream !== 'function') {
    throw videoError('there is no 3D canvas to record', 'load a structure first — the film is made of what is on screen');
  }
  if (typeof Recorder !== 'function') {
    throw videoError('this browser cannot record video (MediaRecorder is not available)', 'try Chrome, Edge, Firefox or Safari 14.1+');
  }
  const total = clampInt(frames, 0, VIDEO_MAX_FRAMES, 0);
  if (total <= 0) throw videoError('there is no trajectory frame to record', 'load a trajectory first');
  const rate = clampInt(fps, VIDEO_MIN_FPS, VIDEO_MAX_FPS, VIDEO_DEFAULT_FPS);
  const frameMs = 1000 / rate;

  let stream = null;
  let recorder = null;
  try {
    stream = canvas.captureStream(rate);
    const settings = {};
    if (mime) settings.mimeType = mime;
    if (Number(bitrate) > 0) settings.videoBitsPerSecond = Math.round(Number(bitrate));
    recorder = new Recorder(stream, settings);
  } catch (err) {
    stopStream(stream);
    throw videoError(
      `the browser refused to record this canvas (${(err && err.message) || 'unknown error'})`,
      'reload the page (Ctrl+F5) — a lost WebGL context cannot be recorded',
    );
  }
  /* The mime the recorder REALLY took may differ from the one asked for (a
     browser can ignore a codec it does not know): what it says is what the blob
     and the file name carry, so the file is never named after a lie. */
  const realMime = String(recorder.mimeType || mime || VIDEO_DEFAULT_MIME);

  const chunks = [];
  let failed = null;
  const stoppedOnce = new Promise((resolve) => { recorder.onstop = () => resolve(); });
  recorder.ondataavailable = (ev) => {
    const data = ev && ev.data;
    if (data && Number(data.size) > 0) chunks.push(data);
  };
  recorder.onerror = (ev) => {
    const err = ev && (ev.error || ev);
    failed = videoError(`the recorder failed (${(err && err.message) || 'unknown error'})`, 'try a slower rate (fps) or a smaller window');
  };
  recorder.start(chunkMs);
  if (typeof onStarted === 'function') onStarted(realMime);

  let stoppedEarly = false;
  try {
    for (let i = 0; i < total; i += 1) {
      if (failed) break;
      if (typeof cancelled === 'function' && cancelled()) { stoppedEarly = true; break; }
      const startedAt = now();
      if (typeof presentFrame === 'function') presentFrame(i);
      if (typeof requestRender === 'function') requestRender();
      await paint();                                   // the new picture is on screen
      /* 🧩 CE QUE LA TOILE N'EST PAS SEULE À PORTER — le rapport de cette session :
         « the video generated for the trajectory is different from what I see on
         the screen when I run the trajectory ? even the background is of
         different colours. » Le film EST la toile que NGL dessine, mais l'écran,
         lui, porte AUSSI des couches HTML par-dessus (la vignette de ★ Shadows →
         🌑 Darkness en est une) : un `captureStream` ne les voit jamais. C'est ici
         que l'appelant les COMPOSE, une fois par image, dans la toile qu'il fait
         enregistrer (la sienne, voir filmCanvasFor / filmVignetteStops) : l'image
         ensuite TENUE pendant 1/fps est celle qui a été composée, donc ce qui est
         écrit est ce que l'écran montre. Un appelant qui n'a rien à composer ne
         passe simplement rien — le film est alors la toile elle-même. */
      if (typeof beforeCapture === 'function') {
        try { beforeCapture(i); } catch { /* une composition ratée n'arrête jamais le film */ }
      }
      const left = frameMs - (now() - startedAt);
      if (left > 1) await sleep(left);                 // …and it stays there for 1/fps
      if (typeof onProgress === 'function') onProgress(i + 1, total);
    }
  } finally {
    try { if (recorder.state !== 'inactive') recorder.stop(); } catch { /* ignore */ }
    /* A recorder that never answers must not hang the button: the film is built
       from the chunks that DID arrive. */
    await Promise.race([stoppedOnce.catch(() => {}), sleep(stopTimeoutMs)]);
    stopStream(stream);
  }
  if (failed) throw failed;
  if (stoppedEarly) return { blob: null, cancelled: true, frames: 0, seconds: 0, mime: realMime, chunks: chunks.length };
  const blob = blobOf(chunks, realMime);
  if (!blob || !blob.size) {
    throw videoError('the recorder produced no data', 'try a slower rate (fps) or a smaller window — the film was empty');
  }
  return { blob, cancelled: false, frames: total, seconds: (total * frameMs) / 1000, mime: realMime, chunks: chunks.length };
};
