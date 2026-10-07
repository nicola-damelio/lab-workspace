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
  backgroundCss, backgroundSpecOf, bgDirectionOf, bgGradientOf, gradientLineFor,
  gradientSpecOf, normalizeBgAngle, normalizeBgColor, paintViewerBackground,
  readBgGradient, underlayBackdrop,
} from './src/utils/viewerBackground.js';
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

eq(bgGradientOf(null), { on: false, to: BG_GRADIENT_DEFAULT_TO, angle: BG_GRADIENT_DEFAULT_ANGLE },
  'sans rien, la rampe est ÉTEINTE, avec les deux valeurs d’origine');
eq(bgGradientOf({}).on, false, 'un objet vide ne l’allume pas');
eq(BG_GRADIENT_DEFAULT_ON, false, 'et le défaut du module dit la même chose');
eq(bgGradientOf({ on: 'yes' }).on, false, 'la vérité de `on` est STRICTE : la chaîne « yes » n’allume rien');
eq(bgGradientOf({ on: true, to: 'bleu', angle: 361 }), { on: true, to: BG_GRADIENT_DEFAULT_TO, angle: 1 },
  'à l’intérieur d’une rampe, la couleur et l’angle sont validés comme dehors');

eq(readBgGradient(null), bgGradientOf(null), 'rien à lire → la rampe d’origine');
eq(readBgGradient('{"on":true,"to":"#101010","angle":90}'), { on: true, to: '#101010', angle: 90 },
  'une chaîne JSON se relit (c’est ce que localStorage rend)');
eq(readBgGradient('pas du json'), bgGradientOf(null), 'un magasin illisible ne fait pas planter le viewer');
eq(readBgGradient({ on: true, to: '#202020', angle: 45 }), { on: true, to: '#202020', angle: 45 },
  'un OBJET (un ⚙️ setup, par exemple) se valide par le même lecteur');

/* ══ 2. LA SPÉCIFICATION DU FOND, ET LE CSS QU'ELLE PRODUIT ═══════════════ */
eq(backgroundSpecOf('#f8fafc', { on: true, to: '#112233', angle: 180 }),
  { on: true, from: '#f8fafc', to: '#112233', angle: 180 },
  'la spécification porte les DEUX couleurs et la direction');
eq(backgroundSpecOf('bleu', null),
  { on: false, from: BG_GRADIENT_DEFAULT_TO, to: BG_GRADIENT_DEFAULT_TO, angle: BG_GRADIENT_DEFAULT_ANGLE },
  'une couleur A illisible retombe sur le gris de la rampe (jamais du noir)');
eq(backgroundSpecOf('#f8fafc', null).on, false, 'sans rampe, la spécification est ÉTEINTE — donc le fond uni');
eq(backgroundSpecOf('#f8fafc', { on: true, to: '#112233', angle: 180 }).on, true, 'et elle s’allume avec la rampe');

eq(gradientSpecOf('#f8fafc'), null, 'une simple couleur n’est PAS une rampe (le film d’avant, au pixel près)');
eq(gradientSpecOf({ on: false, from: '#f8fafc', to: '#112233', angle: 180 }), null, 'une rampe éteinte non plus');
eq(gradientSpecOf({ on: true, from: '#f8fafc', to: '#112233', angle: 180 }),
  { from: '#f8fafc', to: '#112233', angle: 180 }, 'une rampe ALLUMÉE et valide, oui');
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
has('try { el.style.backgroundImage = backgroundCss(backgroundSpecOf(bgColor, bgGradient)); } catch { /* ignore */ }',
  '…en `backgroundImage`, par le CSS du module (chaîne vide = rampe éteinte)');
has('}, [bgColor, bgGradient]);', '…et il suit les deux réglages (la couleur A et la rampe)');
ok(VIEW.indexOf('try { stage.setParameters({ backgroundColor: bgColor }); } catch {}') < VIEW.indexOf('  applyBackgroundGradient();'),
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
has('{ const a = bgColor; setBgColor(bgGradient.to); patchBgGradient({ to: a }); }', '⇄ échange les deux extrémités');
has('aria-label="Background gradient second colour"', 'la couleur B est là');
has('{BG_DIRECTIONS.map((d) => (', 'les HUIT directions sont rendues depuis le module (jamais recopiées)');
has('onClick={() => patchBgGradient({ angle: d.angle })}', '…un clic pose son angle');
has('aria-pressed={bgGradient.angle === d.angle}', '…et la direction active se voit');
has('onChange={(e) => patchBgGradient({ angle: Number(e.target.value) })}', 'le curseur d’angle écrit le même champ');
has('aria-label="Gradient angle in degrees"', '…et il est nommé (lecteurs d’écran)');
has('onClick={() => patchBgGradient({ on: false, to: BG_GRADIENT_DEFAULT_TO, angle: BG_GRADIENT_DEFAULT_ANGLE })}',
  '↺ rend la rampe d’origine (et éteint le dégradé)');
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
has('backgroundSpecOf(bgColor, bgGradient), rayLiveOn ? rayShadowCanvasRef.current : null)',
  'le 🎬 de la trajectoire passe la MÊME spécification (couleur + rampe)');
has(': Number.NaN, backgroundSpecOf(bgColor, bgGradient), rayLiveOn ? rayShadowCanvasRef.current : null);',
  '…et le film de poses aussi (les deux films ont le même fond)');

/* h) LA STILL ✨ RAY */
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

console.log(`_viewer_background_test.mjs — ${passed} assertions OK (⬚ le fond du viewer : deux couleurs, une direction, un clic qui ouvre et ferme)`);




