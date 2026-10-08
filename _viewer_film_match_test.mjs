/* =========================================================================
   _viewer_film_match_test.mjs — LE FILM RESSEMBLE À L'ÉCRAN (vignette, surfaces), ET LA
   BARRE NE RACONTE PLUS UN ROMAN.

   La demande de cette session, mot pour mot :
     · « the video generated for the trajectory is different from what I see on the
       screen when I run the trajectory ? even the background is of different colours. »
       → l'écran porte la VIGNETTE de ★ Shadows par-dessus la toile de NGL ; un
       `captureStream` ne la voyait pas. Le film est donc pris sur une toile de film où
       la scène est recopiée et la vignette PEINTE, avec la géométrie et les arrêts du
       CSS (utils/viewerTrajectoryVideo : filmVignetteGeometry / filmVignetteStops) ;
     · « Remove the long commentary from the video as it takes a lot of space. »
       → le paragraphe de sept lignes sous la barre ▶ est remplacé par trois lignes, et
       les faits qu'il portait vivent dans les titres des boutons ;
     · « The surface representations are ignored in the movie, even in the preview but
       they are very important. »
       → la scène n'est plus rebâtie à chaque image d'un film : une image qui ne repose
       que la caméra et la place des molécules ne recrée AUCUNE représentation, donc la
       SURFACE que NGL calcule en tâche de fond arrive vraiment à l'écran — l'aperçu ▶
       et le fichier 🔴 montrent alors ce que l'écran montrait.
      · « The saved movie always has a black background even if my movie was taken with
        white background. On the right there is always like an ellipse that is not part
        of the movie. »
        → le fond de la FIGURE est peint dans la toile de film AVANT la scène (NGL le
        réserve au CSS de son canvas : clear d'alpha 0), donc le film est aussi clair que
        l'écran — et la vignette, multipliée sur ce fond, assombrit les coins au lieu de
        s'y voir comme une ellipse (voir filmBackdropColor).
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  recordTrajectoryVideo, filmVignetteGeometry, filmVignetteStops, FILM_VIGNETTE_RGB,
  filmBackdropColor, FILM_BACKDROP_DEFAULT,
} from './src/utils/viewerTrajectoryVideo.js';
import { FILM_GLIDE_KEYS } from './src/utils/viewerKeyframes.js';

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

/* ── 1bis. LE FOND DU FILM — LA COULEUR DE LA SCÈNE, PAS DU NOIR ────────────
   Le rapport de cette session, mot pour mot : « The saved movie always has a black
   background even if my movie was taken with white background. On the right there is
   always like an ellipse that is not part of the movie. »

   POURQUOI. NGL ne peint pas son fond dans la toile : `setBackground` fait
   `setClearColor(couleur, 0)` — alpha ZÉRO — puis pose la couleur en
   `style.backgroundColor` DU CANVAS (ngl 2.4, viewer.setBackground) : le fond de
   l'écran est la couleur CSS du canvas, vue à travers une toile transparente. Un film
   n'a pas d'alpha (un WebM est écrit en YUV) : le transparent y devient NOIR, et la
   vignette multipliée sur du transparent se peignait telle quelle — une ellipse au
   lieu d'une ombre. La toile de film remplit donc son fond AVANT de recopier la scène. */
eq(filmBackdropColor('#ffffff'), '#ffffff', 'le fond du film est celui de la scène (blanc ici)');
eq(filmBackdropColor('#F8FAFC'), '#f8fafc', 'la casse est normalisée (un canvas s’en moque, un test non)');
eq(filmBackdropColor('  #112233  '), '#112233', 'les espaces autour sont ignorés');
eq(filmBackdropColor('red'), FILM_BACKDROP_DEFAULT,
  'une couleur nommée n’est pas un #rrggbb : le fond par défaut du viewer');
eq(filmBackdropColor(''), FILM_BACKDROP_DEFAULT, 'une valeur vide aussi — JAMAIS du noir');
eq(filmBackdropColor(null), FILM_BACKDROP_DEFAULT, 'null aussi');
eq(filmBackdropColor('#fff'), FILM_BACKDROP_DEFAULT,
  'trois chiffres ne suffisent pas (le viewer écrit toujours six)');
eq(filmBackdropColor(undefined, '#123456'), '#123456', 'un secours VALIDE sert quand la couleur ne l’est pas');
eq(filmBackdropColor('red', 'blue'), FILM_BACKDROP_DEFAULT, 'un secours invalide retombe sur le défaut du viewer');
eq(FILM_BACKDROP_DEFAULT, '#f8fafc', 'le défaut du module EST le fond par défaut du viewer (BG_DEFAULT)');
/* LE CÂBLAGE : la fabrique valide et PEINT la couleur, et les DEUX enregistreurs (la
   trajectoire 🎬 et les poses 🎞) lui passent le `bgColor` de la barre. */
has('const backdrop = filmBackdropColor(background);', 'la toile de film valide la couleur de la scène');
has('ctx.fillStyle = backdrop;\n        ctx.fillRect(0, 0, w, h);',
  '…et REMPLIT son fond avant de recopier la scène');
has('const film = filmCanvasFor(canvas, vignetteDarkness, bgSpecLive(), rayLiveOn ? rayShadowCanvasRef.current : null);',
  'le 🎬 de la trajectoire passe la SPÉCIFICATION VIVANTE du fond (la couleur de la scène ET la rampe ⬚, angle de la lampe compris — voir utils/viewerBackground)');
has(': Number.NaN, bgSpecLive(), rayLiveOn ? rayShadowCanvasRef.current : null);',
  'le 🎞 des poses aussi (les deux films ont le même fond, et c’est celui de l’écran)');
/* L'ORDRE DU COMPOSITE est ce qui fait qu'une ombre assombrit le fond au lieu de le
   couvrir : le fond, puis la scène, puis la vignette. */
ok(VIEW.indexOf('ctx.fillStyle = backdrop;') < VIEW.indexOf('ctx.drawImage(source, 0, 0, w, h);'),
  'le fond est peint AVANT la scène');
ok(VIEW.indexOf('ctx.drawImage(source, 0, 0, w, h);') < VIEW.indexOf("ctx.globalCompositeOperation = 'multiply';"),
  '…et la vignette APRÈS la scène (elle assombrit, elle ne masque pas)');

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
has('const filmCanvasFor = (source, vignetteDarkness, background, shadowLayer = null) => {', 'la toile de film est construite par le viewer');
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

/* ── 5. UNE SURFACE SURVIT AU FILM ────────────────────────────────────────────
   Le rapport de cette session : « the surface representations are ignored in the
   movie, even in the preview but they are very important. »

   POURQUOI ELLES L'ÉTAIENT. Un film de poses (🎞) applique un instant du geste
   plusieurs fois par seconde (applyKeyframeSample → applyViewerSetup →
   applySceneExtras). Chaque application comptait comme un GESTE et faisait rebâtir
   TOUTES les représentations de la scène ; or NGL calcule une surface EN TÂCHE DE
   FOND, maille par maille — la représentation suivante était ajoutée (et la
   précédente retirée) avant que la moindre enveloppe ne soit prête. L'écran portait
   donc la surface, l'aperçu ▶ et le fichier 🔴 jamais.

   Ce qui est vérifié ici est EXÉCUTÉ : `sceneRebuildSig` est EXTRAITE du .jsx et
   lancée pour de vrai (c'est une fonction pure). */
{
  const start = VIEW.indexOf('const sceneRebuildSig = (s) => {');
  ok(start >= 0, 'le viewer porte la règle qui décide de rebâtir la scène (sceneRebuildSig)');
  const body = VIEW.indexOf('{', VIEW.indexOf('=>', start));
  let depth = 0; let end = -1;
  for (let i = body; i < VIEW.length; i += 1) {
    if (VIEW[i] === '{') depth += 1;
    else if (VIEW[i] === '}') { depth -= 1; if (depth === 0) { end = i + 1; break; } }
  }
  ok(end > start && body > start, '… et elle se lit d’un seul tenant (un bloc complet)');
  const sceneRebuildSig = new Function('FILM_GLIDE_KEYS',
    `${VIEW.slice(start, end)}; return sceneRebuildSig;`)(FILM_GLIDE_KEYS);

  /* Un instant du film, tel que `captureViewerSetup` le photographie. */
  const scene = (over = {}) => ({
    v: 1,
    catStyles: { protein: { backbone: 'cartoon', surface: 'transparent', surfaceOpacity: 0.4 } },
    catLabels: { protein: { residues: false, residueType: false, atoms: false } },
    background: '#000000',
    quality: true,
    molecules: {
      main: { style: 'auto', color: '', colorMode: 'element', transparency: 0, pos: [0, 0, 0] },
      extras: [{ id: 'mol_1', name: 'Ligand', style: 'auto', color: '', colorMode: 'element', transparency: 0, position: [0, 0, 0] }],
      chosen: 'main',
    },
    labels: { 'main::protein|all': { residues: true, residueType: false, atoms: false } },
    camera: { q: [0, 0, 0, 1], p: [0, 0, 0], zoom: 1 },
    savedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  });
  const base = scene();
  /* LE CAS DU FILM : la caméra tourne, les molécules glissent de leur pose à la
     suivante — les réglages, eux, sont ceux du même geste. */
  const gliding = scene({
    camera: { q: [0, 0.7071, 0, 0.7071], p: [12, -3, 4], zoom: 2.5 },
    molecules: {
      main: { ...base.molecules.main, pos: [9, 9, 9] },
      extras: [{ ...base.molecules.extras[0], position: [-4, 2, 8] }],
      chosen: 'main',
    },
    savedAt: '2026-07-07T07:07:07.000Z',
  });
  eq(sceneRebuildSig(base), sceneRebuildSig(gliding),
    'la caméra ET la place des molécules ne changent PAS la signature : aucun rebâtiment, donc la surface reste à l’écran');
  ok(sceneRebuildSig(base).length > 40, 'la signature est bien celle des réglages (pas une chaîne vide)');

  /* …MAIS TOUT CE QUI EST DESSINÉ LA CHANGE : un style, une surface, un drapeau, une
     molécule ajoutée ou son look, la couleur de structure, une étiquette. */
  const differs = (patch, what) => ok(sceneRebuildSig(scene(patch)) !== sceneRebuildSig(base), what);
  const same = (patch, what) => ok(sceneRebuildSig(scene(patch)) === sceneRebuildSig(base), what);
  differs({ catStyles: { protein: { backbone: 'cartoon', surface: 'hide' } } },
    'éteindre la surface la REBÂTIT (elle disparaît vraiment)');
  differs({ catStyles: { protein: { backbone: 'cartoon', surface: 'transparent', surfaceOpacity: 0.9 } } },
    'son opacité aussi (le film morphe la transparence)');
  differs({ catLabels: { protein: { residues: true, residueType: false, atoms: false } } },
    'une étiquette 3D allumée par une pose');
  differs({ sstrucColors: { helix: 0xff0000 } }, 'la palette 2° structure (que le redessin des extra lisait)');
  differs({ molecules: { ...base.molecules, main: { ...base.molecules.main, transparency: 0.5 } } },
    'la transparence de la molécule principale');
  differs({ molecules: { ...base.molecules, extras: [{ ...base.molecules.extras[0], style: 'surface' }] } },
    'le style d’une molécule ajoutée');
  differs({ molecules: { ...base.molecules, extras: [] } }, 'une molécule ajoutée qui s’en va');
  /* ⚠⚠ LES CINQ RÉGLAGES DE L'ÉTAGE, EUX, NE LA CHANGENT PLUS — LE CORRECTIF DE CETTE SESSION :
     ils sont reposés EN PLACE par leurs propres effets (stage.setParameters / setQuality / le rig
     de lumière), donc ils ne demandent AUCUNE représentation. Leur présence dans la signature
     coûtait une reconstruction À CHAQUE IMAGE d'un film (l'image se vidait le temps que le
     worker recalcule une surface) ; c'est aussi ce qui permet de les faire GLISSER pendant un
     mouvement (le pendant de cette liste, FILM_GLIDE_KEYS, vit dans utils/viewerKeyframes.js).
     Le rapport : « In the movie, the transition between one state and the other is not smooth.
     there is a fraction of time where there is nothing. » */
  same({ background: '#112233' },
    '⚠ un FOND ne rebâtit RIEN (il est peint par le stage, jamais par une représentation)');
  same({ quality: false }, '⚠ la qualité non plus (stage.setQuality)');
  same({ fog: true }, '⚠ le brouillard non plus (fogNear / fogFar)');
  same({ clip: { on: true, near: 2, far: 60, dist: 3 } }, '⚠ ni le clipping (clipNear / clipFar / clipDist)');
  same({ shadows: { on: true, darkness: 0.4, az: 12, el: 40, color: '#ffcc00' } },
    '⚠ ni les ombres ni la couleur de la lampe (des uniformes du rig de lumière)');
  eq(sceneRebuildSig(null), '', 'une photographie absente n’a pas de signature (jamais de rebâtiment pour rien)');

  /* LE CÂBLAGE : la signature est comparée, mémorisée, et un geste de la barre la
     périme — le fichier appliqué ensuite rebâtit une fois, jamais l'inverse. */
  has('const rebuildSig = sceneRebuildSig(s);', 'le lecteur d’une photographie lit la signature…');
  has('if (rebuildSig !== sceneRebuildSigRef.current) bumpSectionEpoch();',
    '… et il ne compte comme un GESTE que si elle a changé');
  has('sceneRebuildSigRef.current = rebuildSig;', '… ce qu’il vient de dessiner est retenu');
  has("const sceneRebuildSigRef = useRef('');", 'la mémoire de ce qui est déjà dessiné existe');
  has("const bumpSectionEpoch = () => {\n  sceneRebuildSigRef.current = '';\n  poseStyleSigRef.current = '';\n  setSectionEpoch((n) => n + 1);\n};",
    'un geste de la barre PÉRIME cette mémoire (le dessin à la main ne peut pas être gardé pour un fichier)');
  gone("  if (touched) {\n    bumpSectionEpoch();",
    'l’ancien code — rebâtir à CHAQUE application — a disparu (le bug ne peut pas revenir)');

  /* LE REDESSIN D'UNE MOLÉCULE AJOUTÉE N'EST DEMANDÉ QUE SI SON LOOK A CHANGÉ (sa
     position, elle, glisse à chaque image et ne rebâtit rien). */
  has('let lookChanged = false;', 'le lecteur compare le look d’une molécule ajoutée avant de la redessiner');
  has('if (lookChanged) restyleExtraMol(entry.id);',
    '… et il ne recrée ses représentations que si quelque chose a vraiment changé (sa surface survit au film)');
  has('let moved = false;', '… tandis qu’une POSITION qui glisse est traitée à part');
  has('if (lookChanged || moved) hit += 1;',
    'elle rafraîchit la barre sans redessiner : un déplacement n’est jamais un rebuild');
  /* ET L'ÉCRITURE QUI RÉVEILLAIT CE REDESSIN GARDE SON IDENTITÉ quand rien n'a bougé. */
  has('return Object.keys(next).every((k) => Object.is(c[k], next[k])) ? c : next;',
    'la palette 2° structure n’est réécrite que si elle change (sinon les effets ne se réveillent pas à chaque image)');
}

console.log(`_viewer_film_match_test.mjs — ${passed} assertions OK (vignette du CSS · FOND DE LA FIGURE dans le film · beforeCapture par image · barre raccourcie · une surface survit au film)`);


