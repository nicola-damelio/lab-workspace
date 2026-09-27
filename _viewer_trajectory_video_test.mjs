/* =========================================================================
   _viewer_trajectory_video_test.mjs — 🎬 « save the run as a video ».

   LA DEMANDE D'ORIGINE : « in molecular viewer allow saving videos of the
   trajectory ». Le viewer savait déjà JOUER le run (▶ Play · frame slider ·
   speed) et écrire UN instantané (⬇ le PDB de la frame affichée) ; il n'avait
   aucun moyen d'en écrire le FILM — il fallait le faire dehors, avec un
   enregistreur d'écran par-dessus la page.

   CE QUI EST VÉRIFIÉ ICI :

   1. LES FAITS DU MODULE (src/utils/viewerTrajectoryVideo.js), EXÉCUTÉS : le
      mime que le navigateur accepte vraiment, la détection honnête du support
      (MediaRecorder / canvas.captureStream), la toile de la scène NGL, le
      débit demandé à l'encodeur, le plan d'un enregistrement (frames, durée,
      mappage frame du film → frame du run, la DERNIÈRE frame toujours gardée),
      la ligne de progression, le nom du fichier et l'erreur qui porte son
      conseil.
   2. LA BOUCLE D'ENREGISTREMENT, conduite avec un faux MediaRecorder, un faux
      canvas et une horloge simulée : chaque frame est PRÉSENTÉE (dans l'ordre),
      NGL est redemandé, la frame est TENUE 1/fps (le film est en temps réel),
      la progression compte, le recorder est arrêté une fois, les pistes du
      stream sont rendues, le blob est bâti avec le mime RÉEL — et ⏹ Stop
      n'écrit RIEN.
   3. LE CÂBLAGE DANS LE VIEWER (lu dans la source) : la deuxième rangée de la
      barre ▶, les deux préférences persistées, le plan lu AVANT le clic, la
      frame rendue telle qu'elle était, ▶ et le curseur désarmés pendant
      l'enregistrement, l'écriture du fichier par le chemin commun
      (downloadBlob) — et l'ADDITIVITÉ : rien du chargement de la trajectoire
      n'est touché, et le module n'écrit jamais de fichier lui-même.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  VIDEO_FPS_CHOICES, VIDEO_DEFAULT_FPS, VIDEO_MAX_FPS,
  VIDEO_STEP_CHOICES, VIDEO_MIME_CANDIDATES, VIDEO_DEFAULT_MIME,
  VIDEO_MAX_FRAMES, VIDEO_LONG_RUN_SECONDS, VIDEO_STOP_TIMEOUT_MS,
  videoError, videoSupport, canvasOfStage, videoMime, videoExtension,
  videoBitrateOf, videoSecondsText, videoPlan, videoProgressText,
  videoFileName, recordTrajectoryVideo,
} from './src/utils/viewerTrajectoryVideo.js';

let passed = 0;
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};
const eq = (a, b, what) => {
  assert.equal(a, b, what);
  passed += 1;
};

const VIEWER_SRC = readFileSync('./src/components/NMRMoleculeViewer.jsx', 'utf8');
const MODULE_SRC = readFileSync('./src/utils/viewerTrajectoryVideo.js', 'utf8');
const hasIn = (src, needle, what) => ok(src.includes(needle), what);

/* ── 0. Les listes offertes par la barre ────────────────────────────────── */
{
  ok(VIDEO_FPS_CHOICES.length >= 3 && VIDEO_FPS_CHOICES.every((f) => f >= 1 && f <= 60),
    'les rates proposées sont toutes jouables (1 à 60 fps)');
  ok(VIDEO_FPS_CHOICES.includes(VIDEO_DEFAULT_FPS) && VIDEO_DEFAULT_FPS === 10,
    'le défaut est la rate de lecture du viewer (10 fps), et il est dans la liste');
  eq(VIDEO_STEP_CHOICES[0], 1, 'le premier pas proposé est « every frame » — le run entier');
  ok(VIDEO_STEP_CHOICES.every((s, i) => i === 0 || s > VIDEO_STEP_CHOICES[i - 1]),
    'les pas montent (aucun doublon dans le sélecteur)');
}

/* ── 1. Le support, dit honnêtement ─────────────────────────────────────── */
{
  const bare = videoSupport({});
  eq(bare.ok, false, 'sans MediaRecorder, l’enregistrement est refusé d’avance');
  ok(/MediaRecorder is not available/.test(bare.note), '…et le message nomme ce qui manque');

  const noCanvas = videoSupport({ MediaRecorder: function () {}, HTMLCanvasElement: { prototype: {} } });
  eq(noCanvas.ok, false, 'un navigateur sans canvas.captureStream est refusé aussi');
  ok(/captureStream/.test(noCanvas.note), '…en nommant captureStream');

  const full = videoSupport({
    MediaRecorder: function () {},
    HTMLCanvasElement: { prototype: { captureStream() {} } },
  });
  eq(full.ok, true, 'MediaRecorder + captureStream : l’enregistrement est permis');
  eq(full.note, '', '…sans message d’avertissement');
}

/* ── 2. La toile de la scène, et le mime réellement accepté ─────────────── */
{
  const dom = { tagName: 'CANVAS' };
  eq(canvasOfStage({ viewer: { renderer: { domElement: dom } } }), dom,
    'la toile enregistrée est celle que NGL dessine (renderer.domElement)');
  eq(canvasOfStage({ viewer: { canvas: dom } }), dom,
    '…avec le repli viewer.canvas quand le renderer ne l’expose pas');
  eq(canvasOfStage({}), null, 'un stage vide n’a pas de toile');
  eq(canvasOfStage({ get viewer() { throw new Error('boom'); } }), null,
    'un accès qui jette rend null — jamais une exception pendant un rendu');

  eq(videoMime((m) => m.includes('vp9')), 'video/webm;codecs=vp9',
    'le premier codec que le navigateur accepte est choisi (vp9 d’abord)');
  eq(videoMime((m) => m === 'video/webm'), 'video/webm',
    'un navigateur qui ne connaît que webm reçoit webm');
  eq(videoMime((m) => m === 'video/mp4'), 'video/mp4',
    'un navigateur qui n’encode que mp4 reçoit mp4');
  eq(videoMime(() => false), '',
    'aucun candidat accepté → pas de mimeType (le recorder choisira)');
  eq(videoMime(null), VIDEO_DEFAULT_MIME,
    'sans isTypeSupported, le défaut honnête est webm');
  ok(VIDEO_MIME_CANDIDATES.every((m) => m.startsWith('video/')), 'la liste ne contient que des vidéos');

  eq(videoExtension('video/mp4'), 'mp4', 'un mime mp4 donne un nom de fichier .mp4');
  eq(videoExtension('video/webm;codecs=vp9'), 'webm', 'un mime webm donne .webm');
  eq(videoExtension(''), 'webm', 'sans mime connu, le repli est .webm');
}

/* ── 3. Le débit demandé, et les durées lisibles ────────────────────────── */
{
  eq(videoBitrateOf(1600, 900, 10), 1152000,
    '1600×900 à 10 fps demande ~1,15 Mbps (0,08 bit/pixel/s)');
  eq(videoBitrateOf(10, 10, 1), 1000000, 'une toile minuscule est plancherée à 1 Mbps');
  eq(videoBitrateOf(4000, 3000, 60), 24000000, 'une toile énorme est plafonnée à 24 Mbps');
  eq(videoBitrateOf(0, 0, 10), 1000000, 'une toile sans taille ne propose pas 0 bit/s');
  ok(videoBitrateOf(800, 600, VIDEO_MAX_FPS) <= 24000000, 'le plafond tient à la rate maximale');

  eq(videoSecondsText(0), '0:00', '0 s → 0:00');
  eq(videoSecondsText(9), '0:09', '9 s → 0:09 (deux chiffres)');
  eq(videoSecondsText(125), '2:05', '125 s → 2:05');
  eq(videoSecondsText(59.6), '1:00', 'une durée arrondie passe la minute');
  eq(videoSecondsText(NaN), '0:00', 'une durée illisible ne casse pas la ligne');
}

/* ── 4. LE PLAN : ce que le film coûtera, lu AVANT le clic ──────────────── */
{
  const none = videoPlan({ keptFrames: 0, fps: 10, width: 800, height: 600 });
  eq(none.ok, false, 'sans frame de trajectoire, le plan est refusé');
  ok(/trajectory/.test(none.reason), '…et dit qu’il faut charger une trajectoire');
  eq(none.frames, 0, '…avec 0 frame à enregistrer');

  const noCanvas = videoPlan({ keptFrames: 100, fps: 10, width: 0, height: 0 });
  eq(noCanvas.ok, false, 'sans toile, le plan est refusé');
  ok(/canvas/.test(noCanvas.reason), '…et dit que la toile n’a pas de taille');

  const all = videoPlan({ keptFrames: 121, fps: 10, step: 1, width: 1600, height: 900 });
  eq(all.ok, true, 'avec 121 frames sur une toile 1600×900, le plan passe');
  eq(all.frames, 121, 'step 1 : toutes les frames jouées sont filmées');
  eq(all.secondsText, '0:12', '121 frames à 10 fps font 0:12 de film');
  eq(all.lastIndex, 120, '…et la dernière frame du film est la dernière du run');
  eq(all.covers, true, '…donc le film COUVRE le run');
  eq(all.bitrate, 1152000, 'le débit suit les pixels réels de la toile');
  eq(all.long, false, '12 s n’est pas un long run');

  const tenth = videoPlan({ keptFrames: 121, fps: 10, step: 10, width: 1600, height: 900 });
  eq(tenth.frames, 13, 'step 10 sur 121 frames : 13 images (0, 10, … 120)');
  eq(tenth.indexAt(12), 120, '…la 13e étant bien la DERNIÈRE frame du run');
  eq(tenth.covers, true, '…le film couvre donc le run jusqu’au bout');

  const ragged = videoPlan({ keptFrames: 100, fps: 10, step: 10, width: 800, height: 600 });
  eq(ragged.frames, 11, 'step 10 sur 100 frames : 11 images (0, 10 … 90 + la dernière)');
  eq(ragged.indexAt(10), 99, 'la DERNIÈRE frame du run est gardée malgré le pas irrégulier');
  eq(ragged.covers, true, '…un run de 100 frames est filmé jusqu’à la frame 99');
  eq(ragged.indexAt(0), 0, 'la première frame du film est la première du run');
  eq(ragged.indexAt(999), 99, 'un index au-delà du plan est borné à la dernière frame');

  const capped = videoPlan({ keptFrames: 50000, fps: 10, step: 1, width: 800, height: 600 });
  eq(capped.frames, VIDEO_MAX_FRAMES, 'le nombre de frames d’un film est plafonné');
  eq(capped.covers, false, '…et le plan DIT que le run n’est pas filmé en entier');

  const clamped = videoPlan({ keptFrames: 100, fps: 1000, step: 0, width: 800, height: 600 });
  eq(clamped.fps, VIDEO_MAX_FPS, 'une rate au-delà du maximum est ramenée à 60 fps');
  eq(clamped.step, 1, 'un pas nul devient 1 (aucune division par zéro)');
  const slow = videoPlan({ keptFrames: 100, fps: 0, step: -5, width: 800, height: 600 });
  eq(slow.fps, 1, 'une rate nulle devient 1 fps');
  eq(slow.step, 1, 'un pas négatif devient 1');

  const long = videoPlan({ keptFrames: 1000, fps: 5, step: 1, width: 800, height: 600 });
  ok(long.seconds >= VIDEO_LONG_RUN_SECONDS, 'le plan sait qu’une longue durée…');
  eq(long.long, true, '…et le DIT (long: true) au lieu de la cacher');
}

/* ── 5. La progression, le nom du fichier, l’erreur qui conseille ───────── */
{
  const line = videoProgressText(12, 121, 10);
  ok(line.includes('12/121'), 'la ligne compte les frames du film');
  ok(line.includes('0:01 of 0:12'), '…et les secondes déjà filmées face à la durée totale');
  ok(videoProgressText(999, 121, 10).includes('121/121'), 'la progression est bornée au total');
  eq(videoProgressText(0, 0, 10).includes('0/1'), true, 'un total nul ne divise pas par zéro');

  const stamp = new Date(2026, 8, 27, 14, 5);   // 27 septembre 2026, 14:05
  const name = videoFileName({
    label: 'Ubiquitin (2 conformers) — MD 100 ns',
    frames: 121, fps: 10, width: 1600, height: 900,
    mime: 'video/webm;codecs=vp9', date: stamp,
  });
  eq(name, 'Trajectory_Ubiquitin_2_conformers_MD_100_ns_121f_10fps_1600x900_2026-09-27_1405.webm',
    'le nom porte la structure, les frames, la rate, la taille et la date');
  ok(videoFileName({ label: '', frames: 10, fps: 10, width: 8, height: 6, date: stamp }).startsWith('Trajectory_trajectory_'),
    'sans nom de structure, le repli est « trajectory »');
  ok(videoFileName({ label: 'a/b:c', frames: 10, fps: 10, width: 8, height: 6, mime: 'video/mp4', date: stamp }).endsWith('.mp4'),
    'un film mp4 est nommé .mp4');

  const err = videoError('boom', 'try a slower rate');
  eq(err.message, 'boom', 'l’erreur porte son message');
  eq(err.hint, 'try a slower rate', '…et le conseil que le viewer écrit tel quel');
  eq(videoError('boom').hint, undefined, 'un conseil vide n’est pas inventé (le viewer a le sien)');
}

/* ── 6. LA BOUCLE D'ENREGISTREMENT, conduite pour de vrai ─────────────────
   Le module ne connaît AUCUNE de ces pièces (canvas, MediaRecorder, horloge,
   attente de peinture) : elles sont injectées ici, exactement comme le viewer
   injecte les vraies. Le film est donc fabriqué sous node — et ce que la
   boucle promet (ordre des frames, TENUE de 1/fps, progression, arrêt du
   recorder, pistes rendues) est vérifié, pas supposé. */
const makeLogger = () => ({ streamFps: 0, tracksStopped: 0, started: 0, timeSlice: 0, settings: null });
const makeCanvas = (log) => ({
  width: 1600,
  height: 900,
  captureStream(fps) {
    log.streamFps = fps;
    return { getTracks: () => [{ stop: () => { log.tracksStopped += 1; } }] };
  },
});
class FakeRecorder {
  constructor(stream, settings) {
    this.stream = stream;
    this.settings = settings || {};
    this.mimeType = this.settings.mimeType || 'video/webm';
    this.state = 'inactive';
    this.chunks = 0;
    FakeRecorder.last = this;
  }
  start(ms) {
    this.state = 'recording';
    this.timeslice = ms;
    FakeRecorder.last = this;
  }
  stop() {
    this.state = 'inactive';
    this.chunks += 1;
    if (this.ondataavailable) this.ondataavailable({ data: new Blob([new Uint8Array([1, 2, 3, 4])], { type: this.mimeType }) });
    if (this.onstop) this.onstop();
  }
}
// A recorder whose mimeType is NOT the one asked for (a browser that falls back
// on another codec): the file must be named and typed after what it really took.
class Vp8Recorder extends FakeRecorder {
  constructor(stream, settings) {
    super(stream, settings);
    this.mimeType = 'video/webm;codecs=vp8';
  }
}
// A recorder that answers the stop with its chunks but NEVER fires onstop: the
// module must not hang the button waiting for a signal that does not come.
class SilentRecorder extends FakeRecorder {
  stop() {
    this.state = 'inactive';
    if (this.ondataavailable) this.ondataavailable({ data: new Blob([new Uint8Array([9, 9])], { type: this.mimeType }) });
  }
}
// A recorder that produces nothing at all.
class EmptyRecorder extends FakeRecorder {
  stop() {
    this.state = 'inactive';
    if (this.onstop) this.onstop();
  }
}
// A recorder that gives up in the middle of the run (its `onerror` is fired by
// the test through the instance), and a canvas whose captureStream refuses.
class FailingRecorder extends FakeRecorder {
  giveUp(message) {
    if (this.onerror) this.onerror({ error: new Error(message) });
  }
}

let clock = 0;
const clockOf = () => clock;
const paintOf = (counter) => async () => { clock += 4; counter.paints += 1; };
const sleepOf = (log) => async (ms) => { log.slept.push(ms); clock += ms; };

{
  clock = 0;
  const log = makeLogger();
  const held = { slept: [], paints: 0 };
  const frames = [];
  const progress = [];
  let renders = 0;
  const out = await recordTrajectoryVideo({
    canvas: makeCanvas(log),
    frames: 5,
    fps: 10,
    mime: 'video/webm;codecs=vp9',
    bitrate: 1152000,
    Recorder: FakeRecorder,
    now: clockOf,
    paint: paintOf(held),
    sleep: sleepOf(held),
    presentFrame: (i) => frames.push(i),
    requestRender: () => { renders += 1; },
    onProgress: (done, total) => progress.push(`${done}/${total}`),
  });
  eq(log.streamFps, 10, 'le canvas est capturé à la rate du film');
  eq(log.streamFps, 10, '…la rate demandée est celle du plan');
  eq(FakeRecorder.last.settings.mimeType, 'video/webm;codecs=vp9', 'le mime choisi est passé au recorder');
  eq(FakeRecorder.last.settings.videoBitsPerSecond, 1152000, '…avec le débit du plan');
  eq(FakeRecorder.last.timeslice, 250, 'les morceaux arrivent régulièrement (250 ms)');
  eq(frames.join(), '0,1,2,3,4', 'les frames sont présentées DANS L’ORDRE du run');
  eq(renders, 5, 'NGL est redemandé à chaque frame (sinon le film montre l’ancienne)');
  eq(held.paints, 5, 'chaque frame attend d’être réellement peinte');
  const holds = held.slept.filter((ms) => ms < 1000);
  eq(holds.join(), '96,96,96,96,96', '…puis est TENUE 1/fps (100 ms − 4 ms de peinture)');
  eq(held.slept[held.slept.length - 1], VIDEO_STOP_TIMEOUT_MS,
    'après l’arrêt, l’attente du recorder est PLAFONNÉE (un recorder muet ne bloque jamais le bouton)');
  eq(progress.join(), '1/5,2/5,3/5,4/5,5/5', 'la progression compte les frames filmées');
  eq(out.cancelled, false, 'un run mené au bout n’est pas annulé');
  eq(out.frames, 5, 'le film compte ses frames');
  eq(Math.round(out.seconds * 100) / 100, 0.5, '5 frames à 10 fps font 0,5 s');
  eq(out.mime, 'video/webm;codecs=vp9', 'le blob est typé avec le mime réel');
  ok(out.blob && out.blob.size > 0, 'le blob du film n’est pas vide');
  eq(FakeRecorder.last.state, 'inactive', 'le recorder a été arrêté');
  eq(log.tracksStopped, 1, 'les pistes du stream sont rendues au navigateur');
}

/* ── 6bis. Le mime RÉEL fait le fichier, et un recorder muet ne bloque pas ─ */
{
  clock = 0;
  const log = makeLogger();
  const held = { slept: [], paints: 0 };
  let startedWith = '';
  const fallback = await recordTrajectoryVideo({
    canvas: makeCanvas(log), frames: 3, fps: 10,
    mime: 'video/webm;codecs=vp9', Recorder: Vp8Recorder,
    now: clockOf, paint: paintOf(held), sleep: sleepOf(held),
    onStarted: (mime) => { startedWith = mime; },
  });
  eq(fallback.mime, 'video/webm;codecs=vp8', 'le mime que le navigateur a VRAIMENT pris fait foi');
  eq(startedWith, 'video/webm;codecs=vp8', '…et il est annoncé au viewer (le fichier sera nommé d’après lui)');
  eq(fallback.blob.type, 'video/webm;codecs=vp8', '…le blob est typé pareil');

  clock = 0;
  const silentLog = makeLogger();
  const silentHeld = { slept: [], paints: 0 };
  const silent = await recordTrajectoryVideo({
    canvas: makeCanvas(silentLog), frames: 2, fps: 10, Recorder: SilentRecorder,
    now: clockOf, paint: paintOf(silentHeld), sleep: sleepOf(silentHeld),
    stopTimeoutMs: 20,
  });
  ok(silent.blob && silent.blob.size > 0, 'un recorder qui ne dit jamais « stop » rend quand même son film');
  eq(silentLog.tracksStopped, 1, '…et ses pistes sont rendues');
}

/* ── 6ter. ⏹ STOP N'ÉCRIT RIEN ────────────────────────────────────────────
   Un film de la moitié du run n'est pas le film du run : la boucle s'arrête,
   les morceaux sont JETÉS (blob null) et le recorder est arrêté proprement. */
{
  clock = 0;
  const log = makeLogger();
  const held = { slept: [], paints: 0 };
  const seen = [];
  let stop = false;
  const out = await recordTrajectoryVideo({
    canvas: makeCanvas(log), frames: 50, fps: 10, Recorder: FakeRecorder,
    now: clockOf, paint: paintOf(held), sleep: sleepOf(held),
    presentFrame: (i) => { seen.push(i); if (i === 1) stop = true; },
    cancelled: () => stop,
  });
  eq(out.blob, null, '⏹ Stop ne rend AUCUN fichier');
  eq(out.cancelled, true, '…et le dit (cancelled: true)');
  eq(out.frames, 0, '…aucune frame n’est annoncée comme filmée');
  eq(seen.join(), '0,1', 'la boucle s’arrête au lieu de filmer les 50 frames');
  eq(FakeRecorder.last.state, 'inactive', 'le recorder est arrêté proprement');
  eq(log.tracksStopped, 1, 'les pistes sont rendues même à l’arrêt');
}

/* ── 6quater. LES REFUS, chacun avec son conseil ────────────────────────── */
{
  const bad = async (options, re, what) => {
    let err = null;
    try { await recordTrajectoryVideo(options); } catch (e) { err = e; }
    ok(err && re.test(err.message), what);
    return err;
  };
  const base = { frames: 3, fps: 10, Recorder: FakeRecorder, sleep: async () => {}, paint: async () => {} };

  const noCanvas = await bad({ ...base, canvas: null }, /no 3D canvas/, 'sans toile, l’enregistrement est refusé');
  ok(/load a structure/.test(noCanvas.hint), '…et le conseil dit de charger une structure');

  await bad({ ...base, canvas: { captureStream: () => { throw new Error('context lost'); } } },
    /refused to record this canvas/, 'un canvas qui refuse captureStream est signalé');

  const noRecorder = await bad({ ...base, canvas: makeCanvas(makeLogger()), Recorder: null },
    /MediaRecorder is not available/, 'sans MediaRecorder, l’enregistrement est refusé');
  ok(/Chrome/.test(noRecorder.hint), '…en nommant les navigateurs qui savent le faire');

  await bad({ ...base, canvas: makeCanvas(makeLogger()), frames: 0 },
    /no trajectory frame to record/, 'sans frame, l’enregistrement est refusé');

  await bad({ ...base, canvas: makeCanvas(makeLogger()), Recorder: EmptyRecorder },
    /produced no data/, 'un recorder qui ne rend aucun morceau est signalé (aucun fichier vide)');
}

/* ── 6quinquies. Un recorder qui lâche en cours de route ───────────────── */
{
  clock = 0;
  const log = makeLogger();
  const held = { slept: [], paints: 0 };
  let presented = 0;
  let failure = null;
  try {
    await recordTrajectoryVideo({
      canvas: makeCanvas(log), frames: 200, fps: 10, Recorder: FailingRecorder,
      now: clockOf, paint: paintOf(held), sleep: sleepOf(held),
      presentFrame: () => {
        presented += 1;
        if (presented === 2) FailingRecorder.last.giveUp('gpu lost');
      },
    });
  } catch (e) { failure = e; }
  ok(failure, 'un recorder qui échoue fait échouer l’enregistrement');
  ok(/gpu lost/.test(failure.message), '…en gardant la cause');
  ok(/slower rate/.test(failure.hint), '…et en conseillant une rate plus lente');
  ok(presented <= 2, 'la boucle s’arrête dès l’échec au lieu de filmer 200 frames');
  eq(log.tracksStopped, 1, 'les pistes sont rendues malgré l’échec');
}

/* ── 7. LE MODULE RESTE PUR : aucun fichier, aucun DOM, aucune horloge ──── */
{
  ok(!/\bdocument\b/.test(MODULE_SRC),
    'le module ne touche pas au DOM : il REND le blob, c’est le viewer qui écrit');
  ok(!/createObjectURL/.test(MODULE_SRC),
    '…et n’ouvre aucun objet URL (l’écriture passe par downloadBlob du viewer)');
  ok(/import \{ rayStamp \} from '\.\/viewerRayImage\.js'/.test(MODULE_SRC),
    'l’horodatage du nom vient du module ✨ Ray : une seule définition pour les deux fichiers');
  ok(/typeof MediaRecorder === 'undefined' \? null : MediaRecorder/.test(MODULE_SRC),
    'sous node (aucun MediaRecorder), le module s’importe et s’exécute quand même');
  ok(/return `Trajectory_\$\{raw\}_\$\{n\}f_/.test(MODULE_SRC),
    'le nom du film est bâti à un seul endroit');
}

/* ── 7bis. LE FAIT QUI PORTE TOUT LE DESSEIN, LU DANS NGL INSTALLÉ ────────
   Le film tient chaque frame 1/fps : encore faut-il que la frame SOIT encore
   dans la toile quand le flux la demande. NGL 2.4.0 (le dist/ngl.js que le CDN
   sert, voir src/utils/ngl.js) construit son renderer avec
   `preserveDrawingBuffer: true` — la toile garde donc son contenu après
   composition, et une frame tenue n’est jamais une toile vidée. */
{
  const NGL_DIST = readFileSync('./node_modules/ngl/dist/ngl.js', 'utf8');
  ok(NGL_DIST.includes('preserveDrawingBuffer:!0'),
    'ngl 2.4.0 garde le drawing buffer (preserveDrawingBuffer: true) : une frame tenue est vraiment capturée');
  ok(NGL_DIST.includes('preserveDrawingBuffer:u=!1'),
    '…et la valeur `false` vue dans le bundle est le DÉFAUT de three.js, pas le choix d’NGL (le fait est lu, pas deviné)');
  ok(/hold/i.test(MODULE_SRC) && /1\/fps/.test(MODULE_SRC),
    'le module DIT que chaque frame est tenue 1/fps — c’est ce que cette garantie rend possible');
}

/* ── 8. LE CÂBLAGE DANS LE VIEWER ───────────────────────────────────────── */
{
  hasIn(VIEWER_SRC, "} from '../utils/viewerTrajectoryVideo';",
    'le viewer importe le module du film');
  ['VIDEO_FPS_CHOICES', 'VIDEO_STEP_CHOICES', 'videoSupport', 'canvasOfStage', 'videoMime',
    'videoPlan', 'videoProgressText', 'videoSecondsText', 'videoFileName', 'recordTrajectoryVideo',
  ].forEach((name) => hasIn(VIEWER_SRC, `${name},`, `…dont ${name}`));

  // Les deux préférences du film, comme toutes celles du viewer.
  hasIn(VIEWER_SRC, "localStorage.getItem('labViewerVideoFps')", 'la rate du film est relue du navigateur');
  hasIn(VIEWER_SRC, "localStorage.setItem('labViewerVideoFps', String(videoFps))", '…et persistée');
  hasIn(VIEWER_SRC, "localStorage.getItem('labViewerVideoStep')", 'le pas du film est relu du navigateur');
  hasIn(VIEWER_SRC, "localStorage.setItem('labViewerVideoStep', String(videoStep))", '…et persisté');

  // Le plan, lu AVANT le clic (la barre l’annonce) ET au clic (la toile a pu bouger).
  hasIn(VIEWER_SRC, 'const videoCanvas = canvasOfStage(stageRef.current);',
    'la taille du film est lue sur la toile que captureStream enregistre');
  hasIn(VIEWER_SRC, 'const videoPlanNow = videoPlan({', 'le plan est lu à chaque rendu');
  hasIn(VIEWER_SRC, 'const plan = videoPlan({', '…et relu au moment du clic');
  hasIn(VIEWER_SRC, '${videoPlanSummary(videoPlanNow)}', 'la barre ANNONCE ce que le film coûtera');

  // La rangée 🎬 de la barre ▶, ses deux réglages et ses deux boutons.
  hasIn(VIEWER_SRC, '🎬 Video', 'la barre ▶ a sa rangée vidéo');
  hasIn(VIEWER_SRC, '{VIDEO_FPS_CHOICES.map((f) => <option key={f} value={f}>{f} fps</option>)}',
    'le sélecteur de rate vient de la liste du module');
  hasIn(VIEWER_SRC, "{s === 1 ? 'frame' : `${s}th frame`}", 'le sélecteur « keep every Nth frame » dit ce qu’il garde');
  hasIn(VIEWER_SRC, '🎬 Record the run', 'le bouton d’enregistrement existe');
  hasIn(VIEWER_SRC, '{videoBusy ? \'🎬 Recording…\' : \'🎬 Record the run\'}', '…et dit qu’il enregistre');
  hasIn(VIEWER_SRC, '⏹ Stop', '⏹ Stop est là pendant l’enregistrement');
  hasIn(VIEWER_SRC, 'onClick={recordTrajectoryVideoClick}', 'le clic appelle le handler du film');
  hasIn(VIEWER_SRC, 'onClick={stopTrajectoryVideo}', '⏹ appelle l’arrêt');
  hasIn(VIEWER_SRC, 'disabled={videoBusy || trajStatus !== \'ready\' || keptFrames === 0 || !videoReady.ok}',
    'le bouton est désarmé sans trajectoire — et si le navigateur ne sait pas enregistrer');
  hasIn(VIEWER_SRC, '`🎬 ${videoReady.note}`', '…en DISANT pourquoi, jamais en silence');
}

/* ── 9. LE HANDLER DU FILM — ce qu’il promet, et ce qu’il ne fait pas ───── */
{
  const handlerSrc = VIEWER_SRC.slice(
    VIEWER_SRC.indexOf('const recordTrajectoryVideoClick'),
    VIEWER_SRC.indexOf('// ---- ⬇ PDB of the structure'),
  );
  ok(handlerSrc.length > 800, 'le handler du film est bien dans la source');
  hasIn(handlerSrc, 'const recordTrajectoryVideoClick = async () => {', 'il est async (l’enregistrement dure)');
  hasIn(handlerSrc, 'if (trajStatus !== \'ready\' || !trajRef.current || keptFrames === 0) {',
    'sans trajectoire chargée, il refuse en le disant');
  hasIn(handlerSrc, 'setPlaying(false);', 'il prend la frame au ▶ : un seul pilote à la fois');
  hasIn(handlerSrc, 'const traj = trajRef.current;', 'il tient LA trajectoire qu’il filme');
  hasIn(handlerSrc, 'const out = await recordTrajectoryVideo({', 'il conduit la boucle d’enregistrement');
  hasIn(handlerSrc, 'presentFrame: (i) => {', 'chaque frame du film est présentée…');
  hasIn(handlerSrc, 'const kept = plan.indexAt(i);', '…par le mappage du plan (frame du film → frame du run)');
  hasIn(handlerSrc, 'setFrameSafe(traj, toActualFrame(kept));', '…sur la trajectoire tenue');
  hasIn(handlerSrc, 'requestRender: requestSceneRepaint,', '…et NGL est redemandé (sinon le film montre l’ancienne image)');
  hasIn(handlerSrc, 'onProgress: (done, total) => {', 'la progression est affichée');
  hasIn(handlerSrc, 'videoProgressText(done, total, plan.fps)', '…avec la ligne du module');
  hasIn(handlerSrc, '|| trajRef.current !== traj,', 'une autre trajectoire qui arrive arrête le film (deux runs ne se mélangent pas)');
  hasIn(handlerSrc, 'const name = videoFileName({', 'le fichier est nommé par le module');
  hasIn(handlerSrc, 'const saved = downloadBlob(out.blob, name);', 'il est écrit par le chemin commun du viewer (downloadBlob)');
  hasIn(handlerSrc, 'if (!out.blob) {', '⏹ Stop n’est jamais annoncé comme un fichier écrit');
  hasIn(handlerSrc, 'setFrameSafe(trajRef.current, toActualFrame(backToFrame));',
    'la frame où l’utilisateur était REVIENT à la fin');
  hasIn(handlerSrc, '${videoSecondsText(out.seconds)}', 'le message final dit la durée du film');

  hasIn(VIEWER_SRC, 'const stopTrajectoryVideo = () => {', '⏹ a son propre handler');
  hasIn(VIEWER_SRC, 'videoCancelRef.current = true;', '…qui arrête vraiment la boucle (jeton d’annulation)');
  ok(!/archiveFileToDrive|fetch\(|driveUpload/i.test(handlerSrc),
    'enregistrer un film n’envoie RIEN sur le réseau : le fichier reste sur l’ordinateur');
  ok(!/setTrajFile|setStride|setMaxFrames|setNumFrames/.test(handlerSrc),
    'le film ne touche pas au CHARGEMENT : il ne fait que rejouer les frames déjà là');

  // ▶ et le curseur sont désarmés pendant l’enregistrement : un seul pilote.
  eq((VIEWER_SRC.match(/disabled=\{trajStatus !== 'ready' \|\| keptFrames === 0 \|\| videoBusy\}/g) || []).length, 2,
    '▶ Play et le curseur de frame sont désarmés pendant un enregistrement (et eux seuls)');
  ok(VIEWER_SRC.includes('keep this tab in the foreground'),
    'la barre DIT que l’onglet doit rester au premier plan (un onglet caché n’est pas peint)');
  ok(VIEWER_SRC.includes('nothing is uploaded anywhere'),
    '…et que le film ne part nulle part : il est écrit sur l’ordinateur');
  ok(VIEWER_SRC.includes('keep this tab in the foreground') && VIEWER_SRC.includes('recording is real time'),
    'la durée de l’enregistrement (temps réel) est annoncée avant le clic');
}

/* ── Bilan ──────────────────────────────────────────────────────────────── */
console.log(`_viewer_trajectory_video_test.mjs — ${passed} assertions OK (🎬 le run écrit en un fichier vidéo)`);

