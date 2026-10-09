/* =========================================================================
   _viewer_background_test.mjs — LE FOND DU VIEWER : UNE RAMPE DE DEUX COULEURS,
   SA DIRECTION, ET LE PANNEAU QU'UN CLIC SUR LE FOND OUVRE.

   LA DEMANDE DE CETTE SESSION : « in the background of the viewer allow gradients
   of two colors and their direction (clicking on background should display the
   options underneath and disappear when background is clicked again) ».

   POURQUOI CE FICHIER EXISTE. Le fond d'un fond NGL est un CSS — sa toile est
   vidée d'alpha zéro et la couleur vit en `style.backgroundColor` du canvas
   (setBackground, ngl 2.4) — donc une rampe peut être posée SANS toucher à la
   scène. C'est une chaîne de faits que rien d'autre ne tient ensemble :
     1. les MATHS de la rampe CSS (utils/viewerBackground, exécutées ici) ;
     2. la VALIDATION de ce que localStorage et les ⚙️ setups rendent ;
     3. le CÂBLAGE du viewer (lu dans la source) — le CSS du canvas, la toile de
        film 🎬🎞, le PNG du ✨ Ray, le panneau, le clic qui l'ouvre et le ferme.
   Les PIXELS, eux, sont mesurés par _viewer_background_pixels_test.cjs (vraie
   toile 2D + vrai NGL dans Chrome) : ce fichier ne fait pas semblant.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BG_DIRECTIONS, BG_GRADIENT_DEFAULT_ANGLE, BG_GRADIENT_DEFAULT_ON, BG_GRADIENT_DEFAULT_TO,
  BG_GRADIENT_DEFAULT_MID, BG_GRADIENT_DEFAULT_MID_ON, BG_GRADIENT_DEFAULT_LIGHT,
  BG_GRADIENT_PALE_TO, BG_SCENE_DEFAULT,
  backgroundCss, backgroundSpecOf, bgAngleFromLight, bgDirectionOf, bgGradientOf, gradientLineFor,
  gradientSpecOf, normalizeBgAngle, normalizeBgColor, paintViewerBackground,
  readBgGradient, refreshPaleBgGradient, underlayBackdrop,
} from './src/utils/viewerBackground.js';
/* ☀ LA LAMPE DU RIG — importée et EXÉCUTÉE ici : c'est son vecteur qui donne la
   direction de la rampe (bgAngleFromLight), jamais un angle recopié à la main. */
import { nglKeyLightDirection } from './src/utils/viewerLightRig.js';
import { filmBackdropColor, FILM_BACKDROP_DEFAULT } from './src/utils/viewerTrajectoryVideo.js';

let passed = 0;
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};
const eq = (a, b, what) => {
  assert.deepEqual(a, b, `${what}\n  attendu : ${JSON.stringify(b)}\n  obtenu  : ${JSON.stringify(a)}`);
  passed += 1;
};
const near = (a, b, what, eps = 1e-9) => {
  assert.ok(Math.abs(a - b) <= eps, `${what} (${a} ≠ ${b})`);
  passed += 1;
};
const VIEW = readFileSync(new URL('./src/components/NMRMoleculeViewer.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const has = (needle, what) => ok(VIEW.includes(needle), `${what}\n  introuvable : ${needle}`);
const gone = (needle, what) => ok(!VIEW.includes(needle), `${what}\n  encore présent : ${needle}`);
const countOf = (re) => (VIEW.match(re) || []).length;

/* ══ 1. LES DEUX COULEURS ET L'ANGLE, VALIDÉS ═════════════════════════════ */
eq(normalizeBgColor('#AABBCC'), '#aabbcc', 'une couleur valide est normalisée en minuscules (un canvas s’en moque, un test non)');
eq(normalizeBgColor('  #112233  '), '#112233', 'les espaces autour sont ignorés');
eq(normalizeBgColor('red'), '', 'une couleur NOMMÉE n’est pas un #rrggbb : aucun secours demandé → chaîne vide');
eq(normalizeBgColor('red', '#123456'), '#123456', 'un secours VALIDE sert quand la couleur ne l’est pas');
eq(normalizeBgColor(null, 'bleu'), '', 'un secours invalide ne donne pas une couleur inventée');
eq(normalizeBgColor('#fff'), '', 'trois chiffres ne suffisent pas (le viewer écrit toujours six)');

eq(normalizeBgAngle(180), 180, 'un angle droit est gardé tel quel');
eq(normalizeBgAngle(360), 0, '360° EST 0° (l’angle vit dans [0, 360[)');
eq(normalizeBgAngle(-90), 270, 'un angle négatif est ramené dans le tour');
eq(normalizeBgAngle('450'), 90, 'une chaîne numérique est lue, puis ramenée');
eq(normalizeBgAngle('rouge'), BG_GRADIENT_DEFAULT_ANGLE, 'un angle qui n’en est pas un → celui de la rampe d’origine');
eq(normalizeBgAngle(Infinity, 45), 45, 'un infini → le secours demandé');

eq(bgGradientOf(null), { on: false, to: BG_GRADIENT_DEFAULT_TO, angle: BG_GRADIENT_DEFAULT_ANGLE, mid: BG_GRADIENT_DEFAULT_MID, midOn: false, light: true },
  'sans rien, la rampe est ÉTEINTE, avec les deux valeurs d’origine — et sa direction SUIT LA LAMPE');
eq(bgGradientOf({}).on, false, 'un objet vide ne l’allume pas');
eq(BG_GRADIENT_DEFAULT_ON, false, 'et le défaut du module dit la même chose');
eq(bgGradientOf({ on: 'yes' }).on, false, 'la vérité de `on` est STRICTE : la chaîne « yes » n’allume rien');
eq(bgGradientOf({ on: true, to: 'bleu', angle: 361 }), { on: true, to: BG_GRADIENT_DEFAULT_TO, angle: 1, mid: BG_GRADIENT_DEFAULT_MID, midOn: false, light: true },
  'à l’intérieur d’une rampe, la couleur et l’angle sont validés comme dehors');
/* ☀ LE MODE ☀ EST UN DÉFAUT, PAS UNE OBLIGATION : absent (un magasin ou un fichier
   d’hier) il suit la lampe ; `false` — ce qu’écrivent les huit flèches et le
   curseur — rend la direction au magasin. Aucune autre valeur ne compte. */
eq(BG_GRADIENT_DEFAULT_LIGHT, true, 'la direction de la lampe est le défaut du module');
eq(bgGradientOf({}).light, true, 'un magasin muet suit la lampe');
eq(bgGradientOf({ light: true }).light, true, '…et le dire explicitement ne change rien');
eq(bgGradientOf({ light: false }).light, false, '⚠ un refus EXPLICITE est respecté (la direction est à l’utilisateur)');
eq(bgGradientOf({ light: 'bleu' }).light, true, 'une valeur qui n’est pas un refus ne prend pas la direction : le défaut gagne');

eq(readBgGradient(null), bgGradientOf(null), 'rien à lire → la rampe d’origine');
eq(readBgGradient('{"on":true,"to":"#101010","angle":90}'), { on: true, to: '#101010', angle: 90, mid: BG_GRADIENT_DEFAULT_MID, midOn: false, light: true },
  'une chaîne JSON se relit (c’est ce que localStorage rend)');
eq(readBgGradient('pas du json'), bgGradientOf(null), 'un magasin illisible ne fait pas planter le viewer');
eq(readBgGradient({ on: true, to: '#202020', angle: 45 }), { on: true, to: '#202020', angle: 45, mid: BG_GRADIENT_DEFAULT_MID, midOn: false, light: true },
  'un OBJET (un ⚙️ setup, par exemple) se valide par le même lecteur');

/* ⚠ LE DÉFAUT PÂLE D'HIER (slate-300) — la mesure du rapport « only uniform
   background » : à côté d'une couleur de scène #f8fafc, cette rampe-là se lisait
   comme un fond UNI. Un magasin qui la porte ENCORE est reconnu et reçoit le
   défaut du jour ; une couleur CHOISIE n'est jamais touchée. */
eq(BG_GRADIENT_PALE_TO, '#cbd5e1', 'le défaut pâle d’hier est gardé NOMMÉ (rien d’autre ne le reconnaîtrait)');
ok(BG_GRADIENT_DEFAULT_TO !== BG_GRADIENT_PALE_TO, '…et le défaut du jour n’est plus celui-là');
eq(readBgGradient('{"on":true,"to":"#cbd5e1","angle":180}').to, BG_GRADIENT_DEFAULT_TO,
  'un magasin resté au défaut pâle reçoit le défaut du jour (la rampe se VOIT enfin)');
eq(readBgGradient('{"on":true,"to":"#101010","angle":90}').to, '#101010',
  '…et une couleur CHOISIE passe inchangée (aucune surprise)');
eq(readBgGradient({ on: true, to: '#cbd5e1' }).to, BG_GRADIENT_DEFAULT_TO,
  'la règle vaut pour un OBJET comme pour une chaîne (⚙️ setup d’hier)');
eq(refreshPaleBgGradient(bgGradientOf({ on: true, to: '#123456' })).to, '#123456',
  'le rafraîchisseur lui-même ne touche QUE le défaut pâle — il rend l’objet tel quel sinon');

/* ══ 1bis. ☀ LA RAMPE DANS LA DIRECTION DE LA LAMPE (exécuté) ══════════════
   La demande de cette session : « add the gradient in the direction of the light ».
   `bgAngleFromLight` reçoit le vecteur du RIG (utils/viewerLightRig, le même que
   l'ombre portée et que le ✨ Ray) et rend l'angle CSS de la rampe : A du côté
   ÉCLAIRÉ, B du côté que la lampe a quitté — c'est-à-dire la direction où l'ombre
   tombe. La convention du rig (ngl 2.4 : x > 0 = gauche de l'écran, y > 0 = haut)
   est ce qui rend chaque cas vérifiable ; ils sont tous écrits en clair ici. */
const angleOf = (az, el) => bgAngleFromLight(nglKeyLightDirection(az, el));
eq(angleOf(25, 28), 142,
  'la lampe par défaut (25° / 28°, en haut à gauche) donne 142° — du haut-gauche vers le bas-droit');
eq(angleOf(90, 0), 90, 'lampe à l’horizon, à GAUCHE : la rampe va de la gauche vers la droite');
eq(angleOf(270, 0), 270, '…et de la droite vers la gauche quand la lampe passe de l’autre côté');
eq(angleOf(0, 28), 180, 'lampe derrière la caméra mais AU-DESSUS : la rampe descend — exactement l’angle d’avant');
eq(angleOf(0, -28), 0, 'lampe derrière et EN DESSOUS : la rampe monte');
eq(angleOf(180, 0), BG_GRADIENT_DEFAULT_ANGLE,
  'lampe pile derrière la caméra (azimut 180 / élévation 0) : aucune direction à projeter → l’angle d’avant');
eq(bgAngleFromLight(null), BG_GRADIENT_DEFAULT_ANGLE, 'sans vecteur du tout, l’angle d’avant');
eq(bgAngleFromLight({ x: 0, y: 0, z: 1 }), BG_GRADIENT_DEFAULT_ANGLE, '…et pour un vecteur sans projection, aussi');
ok(angleOf(45, 60) > 90 && angleOf(45, 60) < 180,
  'une lampe en haut à gauche donne toujours une diagonale qui fuit vers le bas et la droite');
/* LE SENS EST CELUI DE L'OMBRE : la lampe en haut à gauche éclaire le coin
   haut-gauche (c'est là que A commence), et l'ombre, elle, tombe de l'autre côté. */
const lamp25 = nglKeyLightDirection(25, 28);
ok(lamp25.x > 0 && lamp25.y > 0, 'le rig dit bien : lampe à gauche (x > 0) et au-dessus (y > 0)');
ok(angleOf(25, 28) > 90 && angleOf(25, 28) < 180, '…d’où une rampe A en haut à gauche, vers le bas-droit');
eq(bgAngleFromLight({ x: -lamp25.x, y: -lamp25.y }), (angleOf(25, 28) + 180) % 360,
  'une lampe OPPOSÉE donne la rampe opposée (180° plus loin, au degré près)');
/* La rampe d'une lampe n'est pas forcément un des huit boutons : le panneau dit
   alors ses degrés (c'est la ligne de lecture, plus bas). */
eq(bgDirectionOf(angleOf(25, 28)), null, '142° n’est pas un des huit angles nommés');
eq(bgDirectionOf(angleOf(90, 0))?.key, 'right', '…alors qu’une lampe plein gauche tombe pile sur « → »');

/* ══ 2. LA SPÉCIFICATION DU FOND, ET LE CSS QU'ELLE PRODUIT ═══════════════ */
eq(backgroundSpecOf('#f8fafc', { on: true, to: '#112233', angle: 180 }),
  { on: true, from: '#f8fafc', to: '#112233', angle: 180, mid: BG_GRADIENT_DEFAULT_MID, midOn: false },
  'la spécification porte les DEUX couleurs et la direction');
eq(backgroundSpecOf('bleu', null),
  { on: false, from: BG_SCENE_DEFAULT, to: BG_GRADIENT_DEFAULT_TO, angle: BG_GRADIENT_DEFAULT_ANGLE, mid: BG_GRADIENT_DEFAULT_MID, midOn: false },
  'une couleur A illisible retombe sur la couleur de SCÈNE (jamais du noir, et JAMAIS sur B — voir §10)');
ok(BG_SCENE_DEFAULT !== BG_GRADIENT_DEFAULT_TO,
  '…et ce secours-là n’est PAS celui de B : un `from` retombé sur B donnerait A = B dès qu’une couleur de scène est illisible');
eq(backgroundSpecOf('#f8fafc', null).on, false, 'sans rampe, la spécification est ÉTEINTE — donc le fond uni');
eq(backgroundSpecOf('#f8fafc', { on: true, to: '#112233', angle: 180 }).on, true, 'et elle s’allume avec la rampe');

eq(gradientSpecOf('#f8fafc'), null, 'une simple couleur n’est PAS une rampe (le film d’avant, au pixel près)');
eq(gradientSpecOf({ on: false, from: '#f8fafc', to: '#112233', angle: 180 }), null, 'une rampe éteinte non plus');
eq(gradientSpecOf({ on: true, from: '#f8fafc', to: '#112233', angle: 180 }),
  { from: '#f8fafc', to: '#112233', angle: 180, mid: '', midOn: false }, 'une rampe ALLUMÉE et valide, oui');
eq(gradientSpecOf({ on: true, from: 'blanc', to: '#112233' }), null, 'une couleur invalide annule la rampe entière');

eq(backgroundCss({ on: false, from: '#f8fafc', to: '#112233', angle: 180 }), '',
  'éteinte : la chaîne VIDE — le canvas rend alors la couleur qu’NGL vient d’y poser');
eq(backgroundCss({ on: true, from: '#f8fafc', to: '#112233', angle: 180 }),
  'linear-gradient(180deg, #f8fafc 0%, #112233 100%)',
  'allumée : la rampe CSS, de A (0 %) à B (100 %) — les deux couleurs du panneau sont celles des deux bords');
eq(backgroundCss({ on: true, from: '#f8fafc', to: '#112233', angle: 90 }),
  'linear-gradient(90deg, #f8fafc 0%, #112233 100%)', 'l’angle traverse le CSS tel quel');

/* ══ 3. LA DIRECTION NOMMÉE — les huit boutons du panneau ═════════════════ */
eq(BG_DIRECTIONS.length, 8, 'huit directions : les quatre droites et les quatre diagonales');
eq(BG_DIRECTIONS.map((d) => d.angle).sort((a, b) => a - b), [0, 45, 90, 135, 180, 225, 270, 315],
  'leurs huit angles sont ceux de la convention CSS, tous distincts');
ok(BG_DIRECTIONS.every((d) => d.glyph && d.what && d.key), 'chaque direction porte son glyphe, sa phrase et sa clé');
eq(bgDirectionOf(180).key, 'down', '180° est NOMMÉE (du haut vers le bas)');
eq(bgDirectionOf(0).key, 'up', '0° aussi (du bas vers le haut)');
eq(bgDirectionOf(90).key, 'right', '90° : de la gauche vers la droite');
eq(bgDirectionOf(135).key, 'down-right', '135° : la diagonale descendante');
eq(bgDirectionOf(183), null, 'un angle LIBRE n’a pas de nom (le panneau écrit alors ses degrés)');

/* ══ 4. LES MATHS DE LA LIGNE DE RAMPE (la spécification CSS) ═════════════ */
const down = gradientLineFor(180, 100, 200);
near(down.x0, 50); near(down.x1, 50); near(down.y0, 0); near(down.y1, 200);
near(down.length, 200, '↓ : la ligne va du bord HAUT au bord BAS, sur toute la hauteur');
const right = gradientLineFor(90, 100, 200);
near(right.x0, 0); near(right.y0, 100); near(right.x1, 100); near(right.y1, 100);
near(right.length, 100, '→ : de gauche à droite, sur toute la largeur');
const up = gradientLineFor(0, 100, 200);
near(up.y0, 200); near(up.y1, 0, '↑ : elle part du BAS (l’axe Y d’un canvas descend, 0° va vers le haut)');
const left = gradientLineFor(270, 100, 200);
near(left.x0, 100); near(left.x1, 0, '← : elle part de la droite');
const diag = gradientLineFor(135, 100, 200);
near(diag.length, (100 + 200) * Math.SQRT1_2, '↘ : la longueur d’une diagonale est |W·sin| + |H·cos|');
near(diag.x0, 50 - diag.length / 2 * Math.SQRT1_2); near(diag.y0, 100 - diag.length / 2 * Math.SQRT1_2);
/* ⚠ LA LIGNE EST PLUS LONGUE QUE LA BOÎTE, ET C'EST LA RÈGLE CSS : elle passe
   par le CENTRE et sa longueur est |W·sin| + |H·cos| — sur 100×200 à 135° elle
   déborde donc de 25 px de chaque côté (−25 → 125 en X). C'est ce qui fait que
   les DEUX couleurs atteignent vraiment les deux bords (à 45° sur une boîte
   carrée, elle touche exactement les coins). */
near(diag.x0, -25); near(diag.y0, 25);
near(diag.x1, 125); near(diag.y1, 175, '…et elle finit symétriquement de l’autre côté du centre');
const squareDiag = gradientLineFor(45, 100, 100);
near(squareDiag.x0, 0); near(squareDiag.y0, 100);
near(squareDiag.x1, 100); near(squareDiag.y1, 0, 'sur une boîte CARRÉE, une diagonale à 45° touche les deux coins');
/* ⚠ UNE BOÎTE NULLE NE DIVISE RIEN PAR ZÉRO : la ligne est un point, et sa
   direction reste celle de l'angle (les deux composantes d'un tour sont
   1.22e-16 et non 0 — c'est ainsi que `Math.sin` calcule 180°, et un canvas
   s'en moque : une ligne d'une longueur nulle peint la même chose). */
const empty = gradientLineFor(180, 0, 0);
near(empty.x0, 0); near(empty.y0, 0); near(empty.x1, 0); near(empty.y1, 0); near(empty.length, 0);
near(empty.dx, 0, '…une ligne de longueur nulle', 1e-15);
near(empty.dy, 1, '…dont la direction est celle de l’angle');

/* ══ 5. PEINDRE LA RAMPE DANS UNE TOILE 2D (le film 🎬🎞) ═════════════════ */
const stubCtx = () => {
  const calls = { fills: [], stops: [], line: null };
  return {
    calls,
    createLinearGradient: (x0, y0, x1, y1) => {
      calls.line = { x0, y0, x1, y1 };
      return { addColorStop: (at, colour) => calls.stops.push([at, colour]) };
    },
    fillRect: (...args) => calls.fills.push(args),
    set fillStyle(v) { calls.fillStyle = v; },
    get fillStyle() { return calls.fillStyle; },
  };
};
const ctx = stubCtx();
const spec = { on: true, from: '#f8fafc', to: '#112233', angle: 180 };
ok(paintViewerBackground(ctx, 100, 200, spec), 'une rampe allumée EST peinte');
eq(ctx.calls.stops, [[0, '#f8fafc'], [1, '#112233']], '…ses deux arrêts sont A à 0 % et B à 100 %');
eq(ctx.calls.fills, [[0, 0, 100, 200]], '…et elle remplit TOUTE la boîte (le film n’a pas d’alpha)');
near(ctx.calls.line.x0, 50); near(ctx.calls.line.y1, 200, '…le long de la ligne de l’angle');
const quiet = stubCtx();
ok(!paintViewerBackground(quiet, 100, 200, '#f8fafc'), 'une simple couleur ne peint RIEN (le fond uni d’avant)');
eq(quiet.calls.fills, [], '…aucun rectangle, aucun arrêt : la toile garde exactement ce que le film attendait');
ok(!paintViewerBackground(quiet, 100, 200, { on: true, from: '#f8fafc', to: 'bleu', angle: 180 }),
  'une rampe invalide non plus (jamais une couleur inventée)');
ok(!paintViewerBackground(null, 100, 200, spec), 'un contexte absent ne lève jamais (il ne peint rien)');
ok(!paintViewerBackground(stubCtx(), 0, 0, spec), 'et une boîte nulle non plus (rien à peindre)');

/* ══ 6. LE ✨ RAY SOUS LEQUEL LA RAMPE EST POSÉE ══════════════════════════ */
eq(await underlayBackdrop('un blob', spec), null,
  'sans DOM (sous node), la composition rend null : l’appelant garde la still telle quelle');
eq(await underlayBackdrop('un blob', '#f8fafc'), null, 'et sans rampe, elle n’a rien à faire');
eq(await underlayBackdrop(null, spec), null, 'un PNG absent non plus');

/* ══ 7. LE FILM LIT LA SPÉCIFICATION (et l’ancienne couleur, telle quelle) ═ */
eq(filmBackdropColor({ on: true, from: '#f8fafc', to: '#112233', angle: 180 }), '#f8fafc',
  'la spécification du fond vaut sa PREMIÈRE couleur pour la couche unie sous la rampe');
eq(filmBackdropColor({ on: true, from: 'bleu', to: '#112233' }), FILM_BACKDROP_DEFAULT,
  'une A invalide retombe sur le fond par défaut du viewer, jamais sur du noir');
eq(filmBackdropColor('#AABBCC'), '#aabbcc', 'une chaîne est lue EXACTEMENT comme avant (aucune régression)');
eq(filmBackdropColor('red', '#123456'), '#123456', '…secours compris');

/* ══ 8. LE CÂBLAGE DU VIEWER ══════════════════════════════════════════════ */
/* a) L'IMPORT, L'ÉTAT ET LE MAGASIN */
has("} from '../utils/viewerBackground';", 'le viewer importe le module du fond');
has("const BG_GRADIENT_KEY = 'labViewerBgGradient';", 'la clé de la rampe est nommée UNE fois');
has('const [bgGradient, setBgGradient] = useState(() => {', 'l’état de la rampe existe');
has('try { return readBgGradient(localStorage.getItem(BG_GRADIENT_KEY)); } catch { return readBgGradient(null); }',
  '…et il est RELU au chargement, par le VALIDATEUR du module');
has('const [bgPanelOpen, setBgPanelOpen] = useState(false);',
  'le panneau est FERMÉ par défaut (la demande : c’est le clic sur le fond qui l’ouvre)');
has('const patchBgGradient = (patch) => setBgGradient((g) => bgGradientOf({ ...g, ...patch }));',
  'chaque contrôle du panneau passe par UNE écriture validée');
has('localStorage.setItem(BG_GRADIENT_KEY, JSON.stringify(bgGradient))',
  'la rampe est persistante, comme la couleur qu’elle prolonge');

/* b) LE FOND VIVANT — le CSS du canvas */
has('const applyBackgroundGradient = useCallback(() => {', 'la rampe est posée par son propre geste');
has('const el = stage && stage.viewer && stage.viewer.renderer ? stage.viewer.renderer.domElement : null;',
  '…sur le canvas d’NGL (là où NGL a posé sa couleur, à travers lequel on la voit)');
has('const wanted = backgroundCss(bgSpecLive());',
  '…le CSS du module, calculé UNE fois (chaîne vide = rampe éteinte)');
has('el.style.backgroundImage = wanted;', '…et posé en `backgroundImage` sur le canvas d’NGL');
has("const took = el.style.backgroundImage || '';",
  '…puis RELU aussitôt : le panneau dira ce que le canvas a PRIS, jamais ce qu’on a voulu lui donner (voir §10)');
has('const bgSpecLive = () => backgroundSpecOf(bgColor, bgGradient.light',
  '…depuis la SPÉCIFICATION VIVANTE : l’angle du magasin, ou celui de la LAMPE quand la rampe la suit');
has('const bgLightAngleRef = useRef(null);', '☀ l’angle vivant de la rampe vit dans une RÉFÉRENCE (et pas dans l’état)');
has('bgLightAngleRef.current = bgAngleFromLight(nglKeyLightDirection(shadowAz, shadowEl));',
  '…remplie par le RIG lui-même (la lampe des ◐ ombres), projetée par le module du fond');
has('const bgAngleLive = bgGradient.light && bgLightAngleRef.current != null ? bgLightAngleRef.current : bgGradient.angle;',
  '…et la valeur de RENDU (ligne du panneau, curseur d’angle) en descend');
has('}, [bgColor, bgGradient]);', '…et il suit les deux réglages (la couleur A et la rampe)');
has('if (!bgGradient.light) return;\n  applyBackgroundGradient();',
  '☀ BOUGER LA LAMPE REpaint la rampe : le suivi vient de la lampe, jamais d’une écriture du magasin');
has('}, [shadowAz, shadowEl, bgGradient.light, applyBackgroundGradient]);',
  '…et c’est bien l’Azimuth / l’Élévation qui le déclenche');
ok(VIEW.indexOf('try { stage.setParameters({ backgroundColor: bgColor }); } catch {}') < VIEW.indexOf('  applyBackgroundGradient();\n  try { stage.setQuality('),
  'la rampe est posée APRÈS la couleur d’NGL (jamais avant : NGL la recouvrirait)');
has('}, [bgColor, qualityHigh, status, applyFog, applyBackgroundGradient]);',
  '…et l’effet du fond la repose à chaque changement');
gone('renderer.setClearColor(', 'le viewer ne touche JAMAIS au clear d’NGL : la rampe est du CSS, pas une scène');

/* c) LE CLIC SUR LE FOND */
has('if (!pickingProxy || !pickingProxy.atom) {', 'un clic SANS atome entre dans le geste du fond');
has('if (pairPickRef.current || torsionPickRef.current || measureModeRef.current || renameModeRef.current) return;',
  '…sauf pendant un piquage : là, les clics appartiennent au piquage');
has('setBgPanelOpen((v) => !v);', 'un clic ouvre le panneau, le SUIVANT le referme (le même état)');
ok(VIEW.indexOf('setBgPanelOpen((v) => !v);') > VIEW.indexOf('if (!pickingProxy || !pickingProxy.atom) {'),
  '…et c’est bien dans la branche du fond (jamais sur un clic d’atome)');
ok(VIEW.indexOf('setBgPanelOpen((v) => !v);') < VIEW.indexOf('const atom = pickingProxy.atom;'),
  '…avant la sélection d’atome : un clic sur le fond ne sélectionne donc personne');

/* d) LE PANNEAU */
eq(countOf(/id="viewer-background"/g), 1, 'un seul panneau du fond dans tout le viewer');
has('{bgPanelOpen && (', 'il n’existe que lorsqu’il est ouvert (fermé, il ne coûte aucun pixel)');
has('aria-label="Background of the 3D scene — one colour, or a gradient of two colours with its direction"', 'il se nomme');
has('onClick={() => patchBgGradient({ on: !bgGradient.on })}', 'l’interrupteur de la rampe est là');
has('aria-pressed={bgGradient.on}', '…et il annonce son état');
has('aria-label="Background colour (first colour of the ramp)"', 'la couleur A — la couleur de la scène — est là');
has('onChange={(e) => setBgColor(e.target.value)}', '…et c’est le MÊME état que le 🎨 de §2 Scene (jamais deux fonds)');
has('{ const a = bgColor; setBgColor(bgGradient.to); patchBgGradient({ on: true, to: a }); }', '⇄ échange les deux extrémités — et ALLUME la rampe');
has('aria-label="Background gradient second colour"', 'la couleur B est là');
has('{BG_DIRECTIONS.map((d) => (', 'les HUIT directions sont rendues depuis le module (jamais recopiées)');
has('onClick={() => patchBgGradient({ on: true, angle: d.angle, light: false })}', '…un clic pose son angle ET allume la rampe…');
has('aria-pressed={bgGradient.on && !bgGradient.light && bgGradient.angle === d.angle}', '…et la direction active se voit (aucune flèche allumée quand c’est la LAMPE qui dirige, ni quand la rampe est éteinte — voir §10)');
has('onChange={(e) => patchBgGradient({ on: true, angle: Number(e.target.value), light: false })}', 'le curseur d’angle écrit le même champ (et allume la rampe)');
has('aria-label="Gradient angle in degrees"', '…et il est nommé (lecteurs d’écran)');
has('value={bgAngleLive}', '…et il MONTRE l’angle vivant (celui de la lampe quand ☀ est allumé)');
has('onClick={() => patchBgGradient({ on: true, light: true, angle: bgAngleLive })}',
  '☀ Light : la rampe part du côté éclairé et SUIT la lampe');
has('aria-pressed={bgGradient.on && bgGradient.light && !bgRampFlat}', '…et il annonce son état — et seulement quand la rampe est PEINTE (voir §10)');
ok(VIEW.indexOf("role=\"group\" aria-label=\"Gradient direction\"") < VIEW.indexOf('☀ Light'),
  '…le bouton ☀ est DANS la rangée des directions (une dixième entrée, pas un réglage à part)');
has('onClick={() => patchBgGradient({ on: false, to: BG_GRADIENT_DEFAULT_TO, angle: BG_GRADIENT_DEFAULT_ANGLE, mid: BG_GRADIENT_DEFAULT_MID, midOn: BG_GRADIENT_DEFAULT_MID_ON, light: BG_GRADIENT_DEFAULT_LIGHT })}',
  '↺ rend la rampe d’origine — direction de la lampe comprise — et éteint le dégradé');
has('onClick={() => setBgPanelOpen(false)}', '⇤ referme le panneau sans rien changer d’autre');
has('bgDirectionOf(bgGradient.angle)?.what', 'la ligne de lecture NOMME la direction (ou dit ses degrés)');

/* e) LA BARRE (§2 · Toolbar → 🌫 Scene) */
has('aria-expanded={bgPanelOpen}', 'le ⬚ de §2 Scene annonce l’état du panneau');
has('aria-controls="viewer-background"', '…et désigne le panneau qu’il commande');
has('⬚ Background options', '…et sa bulle dit les deux états (ouvert / fermé)');

/* f) LES ⚙️ SETUPS, LES PHOTOGRAPHIES ET LES THÈMES */
has('backgroundGradient: bgGradient,', 'une figure enregistrée emporte la rampe');
has("if (s.backgroundGradient && typeof s.backgroundGradient === 'object') setBgGradient(bgGradientOf(s.backgroundGradient));",
  '…et le lecteur la revalide (un fichier SANS rampe ne change donc rien au fond)');
has("'fog', 'shadows', 'clip', 'background', 'backgroundGradient', 'quality', 'large', 'generalLook', 'palettes',",
  'les ⚙️ thèmes cumulatifs et les photographies l’emportent aussi (pour que l’image revienne entière)');

/* g) LES DEUX FILMS 🎬🎞 */
has('paintViewerBackground(ctx, w, h, background);', 'la toile de film peint la rampe');
ok(VIEW.indexOf('ctx.fillStyle = backdrop;') < VIEW.indexOf('paintViewerBackground(ctx, w, h, background);'),
  '…APRÈS la couleur unie (comme `backgroundImage` sur `backgroundColor` en CSS)');
ok(VIEW.indexOf('paintViewerBackground(ctx, w, h, background);') < VIEW.indexOf('ctx.drawImage(source, 0, 0, w, h);'),
  '…et AVANT la scène (le film reste la scène SUR le fond)');
has('bgSpecLive(), rayLiveOn ? rayShadowCanvasRef.current : null)',
  'le 🎬 de la trajectoire passe la MÊME spécification VIVANTE (couleur + rampe, angle de la lampe compris)');
has(': Number.NaN, bgSpecLive(), rayLiveOn ? rayShadowCanvasRef.current : null);',
  '…et le film de poses aussi (les deux films ont donc le fond de l’ÉCRAN, au degré près)');

/* h) LA STILL ✨ RAY */
has('const backdrop = bgSpecLive();',
  'la still du ✨ Ray prend la MÊME spécification VIVANTE que l’écran (l’angle de la lampe compris) — sinon la figure ne serait pas « coin par coin » ce qu’on voit');
has('const gradientStill = !!backdrop.on && !rayTransparent;',
  'la still n’est rendue transparente QUE par la rampe (jamais contre le choix ⬚ alpha de l’utilisateur)');
has('transparent: rayTransparent || gradientStill,', '…et elle l’est alors vraiment, pour que la rampe passe SOUS elle');
has('const still = gradientStill ? await rayStillWithBackdrop(out, backdrop, stillLabel) : out;',
  '…avant d’être composée, puis montrée : ce qui est à l’écran EST le fichier');
has('const rayStillWithBackdrop = async (out, backdrop, label) => {', 'la composition de la still est nommée');
has('const png = await underlayBackdrop(out.blob, backdrop);', '…et elle est faite par le module (destination-over)');
has('if (!png) return out;', 'un navigateur sans toile 2D garde la still TELLE QUELLE (un rendu ne se perd jamais)');
has('fileName: rayFileName({ label, width: out.width, height: out.height, transparent: false })',
  '…et le nom du fichier dit la vérité : le fond n’est plus transparent, il est la rampe');
has("${still.transparent ? ' · transparent' : ''}${gradientStill ? ' · gradient background' : ''}",
  'le rapport du rendu dit le fond dégradé, comme il dit le fond transparent');

/* ══ LE MILIEU — la TROISIÈME couleur, et son INTERRUPTEUR ═══════════════════
   Le milieu a existé (« if there were three colours it would be even more
   interesting »), puis a été RETIRÉ : « it stopped working when I clicked the
   third color … support only two colors ». Ce qui reste vrai, et que cette
   section vérifie : le champ `mid` se lit SANS ERREUR (un magasin, un ⚙️ setup
   ou une figure enregistrés par une version à trois couleurs ne cassent rien),
   mais son interrupteur est TOUJOURS FAUX — forcé à UN SEUL endroit
   (`bgGradientOf`), donc aucun lecteur ne peut rallumer le 3e arrêt. */
eq(BG_GRADIENT_DEFAULT_MID_ON, false, 'le milieu n’est JAMAIS imposé : la rampe s’ouvre à deux couleurs');
eq(bgGradientOf(null).mid, BG_GRADIENT_DEFAULT_MID, 'sans rien, le milieu a sa couleur d’origine (prête, mais éteinte)');
eq(bgGradientOf(null).midOn, false, '…et son interrupteur est ÉTEINT');
eq(bgGradientOf({ on: true, to: '#0000ff', angle: 180, mid: '#00ff00', midOn: true }),
  { on: true, to: '#0000ff', angle: 180, mid: '#00ff00', midOn: false, light: true },
  'un milieu DEMANDÉ est relu sans erreur, mais son interrupteur reste ÉTEINT : aucun magasin ne rallume le 3e arrêt');
eq(bgGradientOf({ on: true, mid: 'vert', midOn: 'yes' }).midOn, false, 'la vérité de `midOn` est STRICTE (comme celle de `on`)');
eq(bgGradientOf({ on: true, mid: 'vert' }).mid, BG_GRADIENT_DEFAULT_MID, 'un milieu illisible retombe sur le défaut du module (jamais du noir)');
eq(gradientSpecOf({ on: true, from: '#ff0000', to: '#0000ff', angle: 180, mid: '#00ff00', midOn: true }),
  { from: '#ff0000', to: '#0000ff', angle: 180, mid: '#00ff00', midOn: true },
  'la spécification d’une rampe à trois couleurs porte son milieu');
eq(gradientSpecOf({ on: true, from: '#ff0000', to: '#0000ff', angle: 180, mid: '#00ff00', midOn: false }).midOn, false,
  'un milieu PRÉSENT mais non demandé est ignoré (la rampe reste à deux couleurs)');
eq(backgroundCss({ on: true, from: '#ff0000', to: '#0000ff', angle: 180, mid: '#00ff00', midOn: true }),
  'linear-gradient(180deg, #ff0000 0%, #00ff00 50%, #0000ff 100%)',
  'le PEINTRE sait encore trois arrêts quand une SPÉCIFICATION les lui donne (A 0 %, C 50 %, B 100 %) — aucune lecture de magasin n’en produit une : voir juste en dessous');
eq(backgroundCss({ on: true, from: '#ff0000', to: '#0000ff', angle: 180, mid: '#00ff00', midOn: false }),
  'linear-gradient(180deg, #ff0000 0%, #0000ff 100%)',
  'milieu éteint : EXACTEMENT la rampe à deux couleurs d’avant (aucun 3e arrêt)');

/* ⛔ LE PANNEAU N'OFFRE PLUS DE TROISIÈME COULEUR — la demande : « it stopped
   working when I clicked the third color … support only two colors ». La rampe
   du fond a donc EXACTEMENT DEUX arrêts (A → B) : le contrôle du milieu est
   retiré du panneau ET le modèle ne peut plus le rallumer — un magasin qui
   demande encore un 3e arrêt (version précédente, ⚙️ setup, figure enregistrée)
   se relit sans erreur mais SANS milieu. */
gone('patchBgGradient({ on: true, midOn:', 'le bouton « C 50 % » a disparu du panneau');
gone('value={bgGradient.mid}', '…et le swatch (C) de la 3e couleur avec lui');
gone('aria-label="Background gradient middle colour"', '…aucun contrôle du milieu ne subsiste');
eq(bgGradientOf({ on: true, to: '#123456', mid: '#00ff00', midOn: true }).midOn, false,
  'un magasin qui DEMANDE le milieu est relu avec midOn FAUX : le 3e arrêt ne peut plus être peint');
eq(bgGradientOf({ on: true, to: '#123456', mid: '#00ff00', midOn: true }).mid, '#00ff00',
  '…le champ `mid` reste lu (aucune lecture en erreur), il n’est simplement plus utilisé');
eq(backgroundCss(backgroundSpecOf('#f8fafc', bgGradientOf({ on: true, to: '#94a3b8', mid: '#00ff00', midOn: true }))),
  'linear-gradient(180deg, #f8fafc 0%, #94a3b8 100%)',
  '…donc le canvas reçoit UNE rampe à deux arrêts, jamais trois');

/* ══ 9. LE PANNEAU NE PEUT PLUS SEMBLER INERTE ═════════════════════════════
   Le rapport de cette session, mot pour mot : « The gradient options for the
   background of the viewer window appear in the viewer but they do not work. the
   background remains of the same color. » La rampe s'ouvre ÉTEINTE (le défaut
   voulu), et ses contrôles écrivaient bien leur champ — mais rien ne se peignait
   tant qu'elle était éteinte : B, C, les huit flèches, le curseur et ⇄ étaient donc
   sans effet visible. Chacun ALLUME désormais la rampe du même geste ; ↺ et
   l'interrupteur, eux, l'éteignent toujours. */
has('onChange={(e) => patchBgGradient({ on: true, to: e.target.value })}',
  'la couleur B ALLUME la rampe en la choisissant (plus de contrôle inerte)');
gone('onChange={(e) => patchBgGradient({ on: true, mid: e.target.value })}', '…et plus aucune couleur du milieu (3e arrêt retiré)');
has('Every control here acts on the ramp, so touching B, an arrow, the angle, ☀ or ⇄ turns it ON',
  'la ligne du bas DIT que rien de ce panneau n’est inerte');
has('⬚ Gradient is OFF: the scene is painted with the ONE colour A',
  '…et elle dit l’ÉTAT quand la rampe est éteinte (jamais un panneau muet)');
has('bgGradient.on ? (', 'la ligne de lecture part de l’ÉTAT de la rampe (allumée / éteinte) — et se sépare en TROIS, voir §10');
has('bgGradient.light ? `in the direction of the light (${bgAngleLive}°)` :',
  '☀ allumé, la ligne DIT que la direction est celle de la lampe (avec ses degrés)');
eq(countOf(/patchBgGradient\(\{ on: true,/g), 5,
  'les CINQ contrôles de la rampe (B · 8 directions · ☀ Light · curseur · ⇄) l’allument — pas un de plus (le bouton du milieu et son swatch ont été retirés : deux couleurs seulement)');
gone('patchBgGradient({ angle: d.angle })', '…et aucune flèche ne reste muette');
gone('patchBgGradient({ to: e.target.value })', '…ni la couleur B');
gone('patchBgGradient({ midOn: !bgGradient.midOn })', '…ni le bouton du milieu');

/* ══ 10. UNE RAMPE D'UNE SEULE COULEUR N'EST PAS UNE RAMPE ══════════════════
   LE RAPPORT DE CETTE SESSION, mot pour mot : « I see the new button light but
   the gradient does not work in any direction », puis la lecture du panneau
   lui-même : « it says "the ramp runs..." and the colour is A everywhere ».
   C'est la forme que ce panneau ne savait PAS dire : la rampe est ALLUMÉE et ses
   deux arrêts sont la MÊME couleur — elle peint donc le fond uni de A, dans
   TOUTES les directions, ce qui se lit « le dégradé ne marche pas », alors que
   le panneau, lui, annonçait une rampe. Deux corrections, une seule règle :
     · le MODULE refuse une rampe dont les DEUX BOUTS sont égaux, que le milieu
       soit demandé ou non (les pixels ne changent pas d'un iota — et pour
       A · C · A ils ne changeaient qu'au MILIEU de la vue, c'est-à-dire sur la
       molécule : « a small effect on the molecule (very slight) but not on the
       background », le second rapport de cette session) ;
     · le PANNEAU le dit, avec la couleur des deux bouts, et dit quoi faire ;
     · et le CANVAS est relu après l'écriture : le panneau dit ce qu'il a PRIS,
       jamais ce qu'on a voulu lui donner. */
eq(gradientSpecOf({ on: true, from: '#94a3b8', to: '#94a3b8', angle: 142 }), null,
  'A et B égaux : la rampe est REFUSÉE — elle peindrait le fond uni de A (« the colour is A everywhere »)');
eq(backgroundCss({ on: true, from: '#94a3b8', to: '#94a3b8', angle: 142 }), '',
  '…donc AUCUNE chaîne : le canvas rend la couleur d’NGL telle quelle, le fond uni d’avant');
ok(!paintViewerBackground(quiet, 100, 100, { on: true, from: '#101010', to: '#101010' }),
  '…et un film 🎬 n’est pas peint davantage (mêmes pixels, et pas de travail pour rien)');
eq(gradientSpecOf({ on: true, from: '#94a3b8', to: '#94a3b8', angle: 142, mid: '#93c5fd', midOn: true }), null,
  '…et le MILIEU ne rachète PAS des bouts égaux : A · C · A laisse le fond intact aux deux bouts et ne change que le MILIEU de la vue — « a small effect on the molecule (very slight) but not on the background »');
eq(backgroundCss({ on: true, from: '#94a3b8', to: '#94a3b8', angle: 142, mid: '#93c5fd', midOn: true }), '',
  '…donc pas de chaîne non plus quand C est allumé : c’est B qu’il faut changer, et le panneau le dit');
eq(gradientSpecOf({ on: true, from: '#94a3b8', to: '#94a3b8', angle: 142, mid: '#94a3b8', midOn: true }), null,
  '…mais trois arrêts TOUS égaux ne sont pas une rampe non plus');
eq(readBgGradient('{"on":true,"to":"#94a3b8"}').on, true,
  'le magasin, lui, garde la rampe ALLUMÉE : c’est au PANNEAU de dire qu’elle ne peint rien, pas au magasin de se réécrire');
/* LE PANNEAU DIT LES TROIS ÉTATS — et aucun bouton ne s’allume plus pour rien. */
has('const bgRampFlat = bgGradient.on && !gradientSpecOf(bgSpecLive());',
  'le viewer DEMANDE au module si la rampe est une rampe (le panneau ne décide pas lui-même)');
has('bgRampFlat ? (', '…la ligne du bas a donc TROIS états : éteinte, allumée-mais-d’une-seule-couleur, allumée');
has('The ramp is ON but its ends are the SAME colour', '…le troisième état est DIT, et pas tu');
has('Give B another colour', '…avec le geste qui répare (un constat sans remède aurait laissé le rapport entier)');
has('const [bgRampTaken, setBgRampTaken] = useState', 'le canvas est RELU : le panneau dit ce qu’il a PRIS, jamais ce qu’on a voulu lui donner');
has("const took = el.style.backgroundImage || '';", '…par une relecture de la propriété juste après l’écriture');
has("aria-pressed={bgGradient.on && bgGradient.light && !bgRampFlat}",
  '☀ ne s’allume plus quand la rampe est éteinte (ou plate) — « I see the new button light » était cette promesse-là');
has('aria-pressed={bgGradient.on && !bgGradient.light && bgGradient.angle === d.angle}',
  '…les huit flèches non plus : un bouton allumé veut dire « c’est peint »');
gone('aria-pressed={bgGradient.on && bgGradient.midOn}', '…ni « C 50 % » (il n’existe plus : deux couleurs seulement)');
gone('aria-pressed={bgGradient.light}', '…et l’ancienne promesse du bouton ☀ a disparu du source');
gone('aria-pressed={bgGradient.midOn}', '…comme celle du milieu');
gone('${!bgGradient.light && bgGradient.angle === d.angle ?',
  '…et aucune flèche ne s’allume plus sur le seul `light` du magasin');

/* ══ 11. LE RAPPORT D'AUJOURD'HUI, ÉPROUVÉ : LE FOND UNI N'ÉTEINT PAS LA RAMPE ══
   « il y a un conflit entre le bouton qui impose le fond uni et le carré qui crée
   le dégradé ; le premier écrase le second ». C'est mesuré ici, des deux côtés :
     · LES DEUX CONTRÔLES N'ÉCRIVENT PAS LA MÊME CHOSE — la couleur A est le
       `backgroundColor` du canvas (posé par NGL, `stage.setParameters`) et la
       rampe est sa `backgroundImage` (posée par `applyBackgroundGradient`), et une
       image de fond se peint PAR-DESSUS la couleur (c'est l'empilement même du
       CSS, celui que les films reproduisent). Changer A change le PREMIER arrêt de
       la rampe : il ne peut pas la retirer ;
     · SEULS DEUX GESTES ÉTEIGNENT LA RAMPE — l'interrupteur ⬚ Gradient et le ↺
       du panneau. Eux seuls écrivent `on: false`, et c'est leur sens.
   Ce qui peut DONNER l'impression du contraire est dit par le panneau lui-même :
   une rampe ALLUMÉE dont A et B sont la même couleur (§10 : la ligne du bas le dit
   et nomme le geste qui répare), ou un style / ⚙️ setup / thème REJOUÉ qui porte
   `on: false` — il remet alors le fond uni, comme il remet la brume et les ombres :
   c'est un FICHIER qu'on rejoue, pas un bouton qui écrase. */
eq(backgroundSpecOf('#123456', bgGradientOf({ on: true, to: '#94a3b8', angle: 90 })).from, '#123456',
  'A EST le premier arrêt de la rampe (le fond uni ne s’ajoute pas : il la commence)');
eq(backgroundCss(backgroundSpecOf('#123456', bgGradientOf({ on: true, to: '#94a3b8', angle: 90 }))),
  'linear-gradient(90deg, #123456 0%, #94a3b8 100%)',
  '…donc changer A REPEINT la rampe (de la nouvelle A vers B), il ne l’éteint pas');
eq(backgroundCss(backgroundSpecOf('#94a3b8', bgGradientOf({ on: true, to: '#94a3b8', angle: 90 }))), '',
  '…le seul cas où elle ne peint rien avec A = B (elle est plate) — et le panneau le DIT (§10)');
has('el.style.backgroundImage = wanted;', 'la rampe est une `backgroundImage` du canvas d’NGL');
has('stage.setParameters({ backgroundColor: bgColor })',
  '…et le fond uni est le `backgroundColor` du MÊME canvas, posé par NGL (deux propriétés, aucun écrasement)');
eq(countOf(/el\.style\.backgroundImage = wanted;/g), 1,
  'UNE seule écriture de la rampe dans tout le viewer (aucun autre contrôle ne peut la retirer)');
eq(countOf(/patchBgGradient\(\{ on: false/g), 1, 'UN seul contrôle écrit `on: false` : le ↺ du panneau');
eq(countOf(/patchBgGradient\(\{ on: !bgGradient\.on/g), 1,
  '…et l’interrupteur ⬚ Gradient est le seul à basculer : deux gestes, pas trois');
eq(countOf(/patchBgGradient\(\{ on: true/g), 5,
  'les CINQ gestes qui ALLUMENT (B · les huit flèches · l’angle · ☀ · ⇄) allument, jamais n’éteignent');
has('onClick={() => patchBgGradient({ on: false, to: BG_GRADIENT_DEFAULT_TO,',
  'le ↺ remet la rampe d’origine ET l’éteint (c’est son sens, et sa bulle le dit)');
has('onClick={() => setBgColor(BG_DEFAULT)}',
  'le ↺ du 🎨 de §2 Scene, lui, ne touche QUE la couleur : la rampe reste allumée et part de la nouvelle A');
has("if (s.backgroundGradient && typeof s.backgroundGradient === 'object') setBgGradient(bgGradientOf(s.backgroundGradient));",
  'un style / ⚙️ setup / thème rejoué repose la rampe qu’il porte (revalidée par le module)');
eq(backgroundCss(backgroundSpecOf('#123456', bgGradientOf({ on: false, to: '#94a3b8' }))), '',
  '…et s’il la porte ÉTEINTE, le fond uni revient : c’est le FICHIER rejoué, jamais un bouton qui écrase');

console.log(`_viewer_background_test.mjs — ${passed} assertions OK (⬚ le fond du viewer : DEUX couleurs, une direction, un clic qui ouvre et ferme)`);




