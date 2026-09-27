/* =========================================================================
   _viewer_film_match_test.mjs — LE FILM RESSEMBLE À L'ÉCRAN (vignette), ET LA BARRE NE
   RACONTE PLUS UN ROMAN.

   La demande de cette session, mot pour mot :
     · « the video generated for the trajectory is different from what I see on the
       screen when I run the trajectory ? even the background is of different colours. »
       → l'écran porte la VIGNETTE de ★ Shadows par-dessus la toile de NGL ; un
       `captureStream` ne la voyait pas. Le film est donc pris sur une toile de film où
       la scène est recopiée et la vignette PEINTE, avec la géométrie et les arrêts du
       CSS (utils/viewerTrajectoryVideo : filmVignetteGeometry / filmVignetteStops) ;
     · « Remove the long commentary from the video as it takes a lot of space. »
       → le paragraphe de sept lignes sous la barre ▶ est remplacé par trois lignes, et
       les faits qu'il portait vivent dans les titres des boutons.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  recordTrajectoryVideo, filmVignetteGeometry, filmVignetteStops, FILM_VIGNETTE_RGB,
} from './src/utils/viewerTrajectoryVideo.js';

let passed = 0;
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const eq = (a, b, what) => { assert.deepEqual(a, b, what); passed += 1; };
const VIEW = readFileSync(new URL('./src/components/NMRMoleculeViewer.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const has = (needle, what) => {
  assert.ok(VIEW.includes(needle), `${what}\n  introuvable : ${needle}`);
  passed += 1;
};
const gone = (needle, what) => {
  assert.ok(!VIEW.includes(needle), `${what}\n  encore présent : ${needle}`);
  passed += 1;
};

/* ── 1. LA VIGNETTE : LA MÊME GÉOMÉTRIE ET LES MÊMES ARRÊTS QUE LE CSS ────── */
eq(FILM_VIGNETTE_RGB, [30, 30, 30], 'la couleur de la vignette est celle de la couche de l’écran');
const geo = filmVignetteGeometry(1600, 900);
eq([geo.cx, geo.cy], [800, 360], 'le centre est « at 50% 40% », comme dans le CSS');
eq([geo.rx, geo.ry], [800, 540], 'les deux rayons vont jusqu’au coin le plus lointain (l’ellipse « farthest-corner » du CSS)');
const dark = filmVignetteStops(0);
eq(dark.map((s) => s[0]), [0, 0.45, 0.72, 1], 'les quatre arrêts sont ceux du CSS (0 · 45 % · 72 % · 100 %)');
eq(dark[0][1], 'rgba(30,30,30,0)', 'le centre est transparent');
eq(dark[1][1], 'rgba(30,30,30,0)', '…jusqu’à 45 %');
eq(dark[2][1], 'rgba(30,30,30,0.0400)', '72 % : l’opacité de la couche');
eq(dark[3][1], 'rgba(30,30,30,0.1200)', '100 % : l’opacité des coins');
const darkest = filmVignetteStops(1);
eq(darkest[2][1], 'rgba(30,30,30,0.1000)', '🌑 Darkness assombrit l’intérieur du même gradient');
eq(darkest[3][1], 'rgba(30,30,30,0.3000)', '…et les coins');
eq(filmVignetteStops(5)[3][1], darkest[3][1], 'une noirceur hors bornes est RAMENÉE à 1 (jamais plus sombre que la couche)');
eq(filmVignetteStops(-3)[3][1], dark[3][1], '…et une valeur négative à 0');
eq(filmVignetteGeometry(0, 0).rx, 1, 'une toile de taille nulle ne donne pas un rayon nul (division par zéro évitée)');

/* ── 2. `beforeCapture` EST APPELÉ UNE FOIS PAR IMAGE, APRÈS LE DESSIN ────── */
class FakeRecorder {
  constructor(stream, settings) {
    this.stream = stream;
    this.settings = settings || {};
    this.mimeType = this.settings.mimeType || 'video/webm';
    this.state = 'inactive';
  }
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    if (this.ondataavailable) this.ondataavailable({ data: new Blob(['frame']) });
    if (this.onstop) this.onstop();
  }
}
const run = async (opts = {}) => {
  const log = [];
  const { compose = false, throwing = false } = opts;
  const canvas = { width: 1600, height: 900, captureStream: (fps) => { log.push(`stream:${fps}`); return { getTracks: () => [] }; } };
  const beforeCapture = (compose || throwing)
    ? () => { log.push(throwing ? 'compose-throws' : 'compose'); if (throwing) throw new Error('boom'); }
    : undefined;
  const out = await recordTrajectoryVideo({
    canvas,
    frames: 3,
    fps: 10,
    Recorder: FakeRecorder,
    beforeCapture,
    presentFrame: (i) => log.push(`frame:${i}`),
    requestRender: () => log.push('render'),
    paint: async () => { log.push('paint'); },
    sleep: async () => {},
    now: () => 0,
  });
  return { out, log, lines: log.filter((l) => !l.startsWith('stream:')) };
};
const composed = await run({ compose: true });
eq(composed.lines.filter((l) => l === 'compose').length, 3, 'la composition est demandée UNE FOIS PAR IMAGE');
eq(composed.lines, ['frame:0', 'render', 'paint', 'compose', 'frame:1', 'render', 'paint', 'compose', 'frame:2', 'render', 'paint', 'compose'],
  'l’ordre, par image : présentation → rendu → peinture → COMPOSITION (ce qui est tenu est donc ce qui a été composé)');
eq(composed.out.frames, 3, '…et le film a bien ses trois images');
const plain = await run({});
eq(plain.lines, ['frame:0', 'render', 'paint', 'frame:1', 'render', 'paint', 'frame:2', 'render', 'paint'],
  'sans composition, la boucle est celle d’avant (le film est la toile elle-même)');
const broken = await run({ throwing: true });
eq(broken.out.frames, 3, 'une composition qui échoue N’ARRÊTE PAS le film (l’erreur est absorbée)');

/* ── 3. LE BRANCHEMENT DANS LE VIEWER, ET LE PARAGRAPHE RACCOURCI ─────────── */
has('filmVignetteGeometry, filmVignetteStops,', 'le viewer prend la géométrie et les arrêts du module 🎬');
has('const filmCanvasFor = (source, vignetteDarkness) => {', 'la toile de film est construite par le viewer');
has("ctx.globalCompositeOperation = 'multiply';", 'la vignette est PEINTE en « multiply », comme le mix-blend-mode du CSS');
has('canvas: film ? film.canvas : canvas,', 'le 🎬 de la trajectoire enregistre la toile de film');
has('beforeCapture: film ? film.composite : undefined,', '…et compose la vignette à chaque image');
has('canvas: kfFilmCanvas ? kfFilmCanvas.canvas : canvas,', 'le film de poses enregistre la MÊME toile de film (les deux films se ressemblent)');
has('beforeCapture: kfFilmCanvas ? kfFilmCanvas.composite : undefined,', '…et compose lui aussi');
has("if (!source || typeof document === 'undefined' || typeof document.createElement !== 'function') return null;",
  'sans contexte 2D le film retombe sur la toile de NGL (rien ne casse)');
has('const stops = Number.isFinite(Number(vignetteDarkness)) ? filmVignetteStops(vignetteDarkness) : null;',
  'une vignette ÉTEINTE n’est pas peinte dans le film');
/* Le module, lui, porte l’option et l’appelle : */
const MODULE = readFileSync(new URL('./src/utils/viewerTrajectoryVideo.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
ok(MODULE.includes('    beforeCapture,\n'), 'le module 🎬 accepte la composition dans ses options');
ok(MODULE.includes("if (typeof beforeCapture === 'function') {"), '…et l’appelle dans sa boucle');
ok(MODULE.includes('beforeCapture(i)'), '…une fois par image');
ok(MODULE.includes('export const filmVignetteGeometry') && MODULE.includes('export const filmVignetteStops'),
  'les deux règles de la vignette sont pures et exportées (donc mesurées ici)');

/* ── 4. LE PARAGRAPHE DE SEPT LIGNES EST PARTI (il ne reste que l’essentiel) ─ */
gone('sets how fast the FILM plays', 'la phrase sur Speed vs fps n’encombre plus la barre');
gone('a hidden tab is not painted and the film would repeat', '…ni le couple de phrases sur l’onglet caché');
has('keep this tab in the foreground', 'l’essentiel (garder l’onglet devant) reste dit, en une ligne');
has('🎬 The film is the 3D canvas with the vignette the screen draws over it',
  '…et la ligne dit désormais CE QUE LE FILM CONTIENT (la scène ET la vignette)');

console.log(`_viewer_film_match_test.mjs — ${passed} assertions OK (vignette du CSS · beforeCapture par image · barre raccourcie)`);


