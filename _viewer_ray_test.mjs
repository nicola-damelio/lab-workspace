/* =========================================================================
   _viewer_ray_test.mjs — le bouton « ✨ Ray » (image statique haute résolution).

   La demande d'origine : un bouton qui exporte une image statique « ray » de la
   scène, écrite SUR L'ORDINATEUR (PNG) et jamais dans la bibliothèque de figures.
   LES SUITES DE CETTE DEMANDE, elles aussi vérifiées ici :
     · « i comandi ray e i suoi associati (alpha, shadow) devono essere spostati
       nella sezione scene » → le bloc vit dans le groupe 🌫 Scene, et la barre
       d'outils EST devenue la SECTION 2 de la barre de commande ;
     · « se clicco su ray, anche per un piccolo peptide il rendering non finisce
       mai e non arrivo a vedere l'immagine » → le budget de sortie (16 Mpx), la
       règle de la passe antialias (4·factor² tuiles), le nombre de tuiles ANNONCÉ
       dans le titre du bouton, le budget propre aux ombres portées et le second
       message de progression (onStatus) ;
     · « il pulsante figure é ridondante » → 📷 Figure, son handler, son message
       et l'import de figuresLibrary ont disparu du viewer, sans laisser de code
       mort derrière eux.

   CE QUI EST VÉRIFIÉ ICI :

   1. LES FAITS, dans le paquet ngl 2.4.0 réellement installé — le « ray » est
      le supersampling DE NGL, donc quatre choses doivent être vraies dans le
      code livré :
        · le défaut livré est { trim:false, factor:1, antialias:false,
          transparent:false } → un `factor` NON passé donnerait une simple
          capture 1× : le module doit toujours l'écrire ;
        · la toile de sortie vaut `canvasPixels × factor` (le chemin antialias
          double le facteur interne puis divise la toile par 2 — 4·factor²
          tuiles moyennées) ;
        · makeImage résout une PROMESSE de Blob PNG (`toBlob(…, 'image/png')`),
          jamais une toile — c'est exactement l'erreur de l'ancien 📷 ;
        · pendant le rendu NGL met à l'échelle `linewidth` et les uniforms
          `size` du facteur, et il restaure l'échantillonnage et l'alpha de la
          toile à la fin (un fond transparent ne fuit pas dans le viewer).
   2. LES FONCTIONS PURES du module, EXÉCUTÉES ici : la taille réelle annoncée,
      la liste du sélecteur en pixels, le plafonnement (budget + limites GPU), le
      NOMBRE DE TUILES et la règle de la passe antialias, le plan du facteur
      choisi, le nom du fichier, la ligne de progression, et l'APPEL À NGL — une
      doublure de stage prouve que trim / factor / antialias / transparent et
      onProgress sont tous passés EXPLICITEMENT, et qu'une image au-dessus du
      budget des ombres revient quand même (sans ombre, et en le disant).
   3. LE CÂBLAGE, dans la source du viewer : le bouton et son sélecteur, l'état
      et la persistance propres à ✨ Ray, le PLAN du facteur choisi (pixels et
      tuiles, lisibles AVANT le clic) et l'ADDITIVITÉ — ✨ Ray n'écrit rien dans
      la bibliothèque de figures, et rien de la scène n'est reconstruit.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RAY_FACTORS, RAY_DEFAULT_FACTOR, RAY_MAX_PIXELS, RAY_MAX_FACTOR,
  RAY_ANTIALIAS_MAX_FACTOR, RAY_SHADOW_SKIP_NOTE, RAY_STALL_MS, rayStallNote,
  viewerPixelsOf, rayPixelsOf, clampRayFactor, rayFactorOptions, rayProgressText,
  rayTilesOf, rayAntialiasFor, rayPlanOf,
  captureRayImage, saveRayImage, rayFileName, rayStamp, downloadBlob, rayDimLimitOf,
  previewRayImage, previewUrlOf, releasePreviewUrl,
} from './src/utils/viewerRayImage.js';
// La référence de l’ombre : le masque de la caméra AU REPOS, construit à la main
// (voir §2quater — le rendu tuilé d’NGL laisse la caméra dans sa dernière tuile).
import {
  buildRayShadowMask, rayShadowInputsOf, mat4LookAt, mat4Multiply,
} from './src/utils/viewerRayShadows.js';

let passed = 0;
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};
const eq = (a, b, what) => {
  assert.deepEqual(a, b, `${what}\n  expected : ${JSON.stringify(b)}\n  got      : ${JSON.stringify(a)}`);
  passed += 1;
};

const VIEW = readFileSync(new URL('./src/components/NMRMoleculeViewer.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const NGL = readFileSync(new URL('./node_modules/ngl/dist/ngl.js', import.meta.url), 'utf8');
const has = (needle, what) => ok(VIEW.includes(needle), `${what}\n  not found : ${needle}`);
const gone = (needle, what) => ok(!VIEW.includes(needle), `${what}\n  still there : ${needle}`);
const nglHas = (needle, what) => ok(NGL.includes(needle), `${what}\n  not in the shipped ngl.js : ${needle}`);

/* ── 1. LES FAITS DANS LE NGL INSTALLÉ ─────────────────────────────────── */
nglHas('const kc={trim:!1,factor:1,antialias:!1,transparent:!1,onProgress:void 0}',
  'les défauts LIVRÉS de makeImage sont trim:false · factor:1 · antialias:false (donc factor doit être écrit à la main)');
nglHas('this.canvas.width=this._width*this._factor/2',
  'avec antialias la toile de sortie est (canvas × 2·factor / 2), soit canvas × factor — jamais plus grand');
nglHas('this.canvas.width=this._width*this._factor,this.canvas.height=this._height*this._factor',
  '…et sans antialias elle vaut exactement canvas × factor : la taille annoncée par le module est la bonne');
nglHas('t.linewidth*=i', 'NGL met à l’échelle l’épaisseur des traits pendant le rendu (les bâtons ne maigrissent pas)');
nglHas('a.setClearAlpha(s?0:1),u()', 'le fond transparent est demandé AVANT le rendu (s = transparent)');
nglHas('h(c.canvas).toBlob((function(n){a.setClearAlpha(l),u(!0),e.requestRender()',
  '…et NGL RESTAURE l’alpha et l’échantillonnage du viewer quand il a fini (rien ne fuit dans la scène)');
nglHas('}),"image/png")', 'la promesse résout un Blob PNG — jamais une toile (l’ancien 📷 attendait une toile)');
nglHas('n?t(n):i("error creating image")', '…et elle REJETTE si la toile n’a pas pu être encodée (le module attrape le message)');
nglHas('makeImage(e={}){return Oc(this,e)}', 'Stage.makeImage délègue bien à makeImage(viewer, params) — c’est le point d’entrée utilisé');
/* ⚠ LE PIÈGE DE LA CAMÉRA, celui qui rendait l’ombre « plate et détachée » : la
   « ray » est rendue TUILE PAR TUILE, chaque tuile dans son propre sous-frustum, et
   NGL laisse la caméra dans la dernière d’entre elles. */
nglHas('.camera.setViewOffset(', 'NGL pousse la caméra dans le sous-frustum de CHAQUE tuile (TiledRenderer._renderTile)');
nglHas('_finalize(){this._viewer.setSampling(this._viewerSampleLevel),this._viewer.camera.view=null',
  '…et à la fin il remet `camera.view` à null SANS updateProjectionMatrix : la matrice reste celle de la dernière tuile');
nglHas('this._width=this._viewer.width,this._height=this._viewer.height',
  'la tuile est rendue à `viewer.width × factor` : c’est CETTE taille que le module doit multiplier, pas le drawing buffer');

/* ── 2. LES FONCTIONS PURES DU MODULE ──────────────────────────────────── */
const fakeStage = (w = 1600, h = 900) => ({ viewer: { renderer: { domElement: { width: w, height: h } } } });
const fakeStageWithGl = (w, h, limit) => ({
  viewer: {
    renderer: {
      domElement: {
        width: w,
        height: h,
        getContext: () => ({
          getParameter: (p) => (p === 'MAX_VIEWPORT_DIMS' ? [limit, limit] : limit),
        }),
      },
    },
  },
});

/* ⚠ DES PIXELS ENTIERS (le rapport : « the resolution label has decimals ») : la
   taille lue est un rectangle CSS — `getBoundingClientRect` rend un demi-pixel dès
   qu'un panneau tombe de travers — et le libellé du sélecteur, le masque d'ombre, le
   nom du fichier et le message final héritaient tous de « 3× · 1234.5×698.25 px ».
   Le module arrondit à la SOURCE, une fois pour toutes. */
eq(viewerPixelsOf({ viewer: { width: 1234.5, height: 698.25 } }), { width: 1235, height: 698 },
  'une taille CSS fractionnaire est ARRONDIE : aucune décimale ne sort du module');
eq(rayFactorOptions({ viewer: { width: 1000.4, height: 500.4 } })[1].label, '3× · 3000×1500 px',
  '…donc les libellés de résolution sont des entiers (aucun « 2196.5 px » dans le sélecteur)');
eq(rayPlanOf({ viewer: { width: 1000.4, height: 500.4 } }, 3).realWidth, 3000,
  '…et la taille annoncée sous la souris est un entier, elle aussi');

eq(RAY_FACTORS, [2, 3, 4, 6], 'les facteurs offerts sont ceux de la liste du module (2× · 3× · 4× · 6×)');
ok(RAY_FACTORS.includes(RAY_DEFAULT_FACTOR), 'le facteur par défaut est l’un des facteurs offerts (le sélecteur ne peut pas être vide)');

eq(viewerPixelsOf(fakeStage(1600, 900)), { width: 1600, height: 900 },
  'la taille lue est celle des PIXELS de la toile (HiDPI compté une seule fois)');
eq(viewerPixelsOf({ viewer: { width: 800, height: 600 } }), { width: 800, height: 600 },
  'sans toile lisible on retombe sur viewer.width / viewer.height');
eq(viewerPixelsOf(null), { width: 0, height: 0 }, 'un stage absent ne casse rien (aucune structure chargée)');
eq(viewerPixelsOf({ viewer: { renderer: { domElement: { width: 0, height: 0 } }, width: 640, height: 480 } }),
  { width: 640, height: 480 }, 'une toile de taille nulle retombe sur la taille du viewer');
/* ⚠ HIDPI : `Viewer.setSize` fait `renderer.setPixelRatio(window.devicePixelRatio)` et
   `setSize(width, height)`, donc `canvas.width` vaut `devicePixelRatio × viewer.width`
   — le DRAWING BUFFER. `makeImage` multiplie `viewer.width` (le TiledRenderer :
   `this._width = this._viewer.width`). Lire la toile donnait un masque 1,25× trop
   grand pour l’image et faisait ré-écrire la « ray » AGRANDIE par le facteur d’échelle
   de l’écran (floue, et plus grande que le facteur demandé). */
eq(viewerPixelsOf({ viewer: { width: 1600, height: 900, renderer: { domElement: { width: 2000, height: 1125 } } } }),
  { width: 1600, height: 900 },
  'sur un écran HiDPI (toile 2000×1125 = 1,25×) la taille lue est celle qu’NGL rendra vraiment (1600×900)');

eq(rayPixelsOf(fakeStage(1600, 900), 3), { factor: 3, width: 4800, height: 2700, pixels: 4800 * 2700 },
  '3× annonce 4800×2700 px pour une toile 1600×900 — exactement ce que NGL produira');
eq(rayPixelsOf(fakeStage(), 1).width, 1600, '1× est accepté (une capture simple reste possible)');
eq(rayPixelsOf(fakeStage(), 42).factor, RAY_MAX_FACTOR, 'un facteur absurde est plafonné à RAY_MAX_FACTOR');
eq(rayPixelsOf(fakeStage(), 'zut').factor, RAY_DEFAULT_FACTOR, 'un facteur non numérique retombe sur le défaut');

eq(clampRayFactor(fakeStageWithGl(800, 450, 16384), 6), 6, 'sur une petite toile le facteur demandé est accordé tel quel (6× = 4800×2700 px)');
eq(clampRayFactor(fakeStageWithGl(1600, 900, 16384), 6), 3,
  `le budget de ${RAY_MAX_PIXELS / 1e6} Mpx mord : 1600×900 × 6 = 52 Mpx → 5 (36) → 4 (23) → 3 (13 Mpx), quelle que soit la GPU`);
eq(clampRayFactor(fakeStage(1600, 900), 6), 3,
  'sans limites GPU lisibles le repli de 8192 s’applique : 1600×6 > 8192, et le budget ramène à 3× (jamais un rendu voué à l’échec)');
ok(clampRayFactor(fakeStage(1920, 1080), 6) < 6,
  `le budget de ${RAY_MAX_PIXELS} px est respecté (1920×1080 × 6 dépasse 16 Mpx : NGL ne recevrait jamais cette taille)`);
eq(clampRayFactor(fakeStage(1920, 1080), 6), 2,
  '…et sur une toile 1920×1080 il reste 2× (8 Mpx) : la taille qu’un « ray » peut vraiment finir');
eq(clampRayFactor(fakeStageWithGl(1600, 900, 4096), 4), 2,
  'la limite GPU est respectée : 1600×4 > 4096 → 2× (le rendu ne peut pas échouer pour cette raison)');
eq(clampRayFactor(fakeStageWithGl(1600, 900, 4096), 1), 1,
  '…mais jamais sous 1× : le plafonnement ne peut pas rendre l’image impossible');
eq(clampRayFactor(null, 6), 6, 'une toile non mesurable garde le facteur demandé (le rendu échouera avec un message clair)');
eq(clampRayFactor(fakeStage(512, 288), 99), RAY_MAX_FACTOR,
  'le plafond dur reste RAY_MAX_FACTOR quand la toile peut le supporter (512×8 = 4096 px, 9 Mpx)');
eq(rayDimLimitOf(fakeStageWithGl(1600, 900, 4096)), 4096, 'la limite GPU lue est la plus petite des trois (texture · renderbuffer · viewport)');
eq(rayDimLimitOf(fakeStage(1600, 900)), 8192, 'sans contexte WebGL lisible on retombe sur la limite de repli (jamais NaN)');

/* LES TUILES ET LA PASSE ANTIALIAS — le coût RÉEL d’un facteur, celui qui décide
   si un clic sur ✨ Ray revient (le rapport : « il rendering non finisce mai »). */
eq(rayTilesOf(2, false), 4, '2× sans passe antialias : 4 tuiles');
eq(rayTilesOf(2, true), 16, '2× AVEC la passe : 16 tuiles (le facteur de NGL est doublé, donc 4·factor²)');
eq(rayTilesOf(3, false), 9, '3× sans passe : 9 tuiles');
eq(rayTilesOf(3, true), 36, '3× avec la passe : 36 rendus — quatre fois le temps pour un lissage de plus');
eq(rayTilesOf(99, false), RAY_MAX_FACTOR * RAY_MAX_FACTOR, 'un facteur absurde est plafonné avant le calcul des tuiles');
eq(rayAntialiasFor(2), true, `jusqu’à ${RAY_ANTIALIAS_MAX_FACTOR}× la passe antialias est demandée (peu de tuiles)`);
eq(rayAntialiasFor(3), false, 'dès 3× elle ne l’est plus : la tuile EST déjà un sur-échantillonnage de la toile');
eq(rayAntialiasFor(6), false, '…et à 6× elle quadruplerait le rendu sans rien apporter');

const plan = rayPlanOf(fakeStage(1600, 900), 6);
eq(plan.best, 3, 'le plan d’un 6× sur une 1600×900 dit le facteur RÉELLEMENT accordé');
eq([plan.realWidth, plan.realHeight], [4800, 2700], '…la taille que CE facteur produit');
eq(plan.allowed, false, '…que la taille annoncée n’est pas accordée telle quelle');
eq(plan.antialias, false, '…et que la passe antialias ne sera pas demandée');
eq(plan.tiles, 9, '…avec le nombre de tuiles qui en découle : le bouton peut le DIRE avant le clic');
const plan2 = rayPlanOf(fakeStage(1600, 900), 2);
eq([plan2.best, plan2.allowed, plan2.antialias, plan2.tiles], [2, true, true, 16],
  'un 2× accordé garde la passe antialias (16 tuiles annoncées)');
eq(rayPlanOf(null, 3).realWidth, 0, 'sans toile mesurable le plan ne fabrique aucune taille');

const labels = rayFactorOptions(fakeStage(1600, 900)).map((o) => o.label);
eq(labels, ['2× · 3200×1800 px', '3× · 4800×2700 px', '4× · 6400×3600 px', '6× · 9600×5400 px'],
  'le sélecteur écrit les PIXELS que chaque facteur produit sur CETTE toile');
eq(rayFactorOptions(null).map((o) => o.label), ['2×', '3×', '4×', '6×'],
  'sans toile mesurable il n’annonce aucune taille fausse');
const opts = rayFactorOptions(fakeStageWithGl(1600, 900, 4096));
ok(opts.every((o) => (o.allowed ? o.best === o.factor : o.best < o.factor)),
  'chaque entrée dit si la taille est accordée, et quel facteur NGL recevra sinon');
ok(opts.some((o) => !o.allowed), '…et une limite GPU basse produit vraiment une entrée réduite (le cas 4096 est couvert)');

eq(rayProgressText(5, 36), '✨ Rendering the ray still… 5/36 tiles', 'la progression parle en tuiles, comme NGL les rend');
eq(rayProgressText(99, 9), '✨ Rendering the ray still… 9/9 tiles', 'la tuile sur-comptée de NGL (total + 1) est bornée — jamais « 10/9 »');
eq(rayProgressText(0, 0), '✨ Rendering the ray still… 0/1 tiles', 'un total illisible ne divise pas par zéro');

/* ── 2bis. LE NOM DU FICHIER ───────────────────────────────────────────── */
const day = new Date(2026, 8, 24, 15, 7);
eq(rayFileName({ label: '2XYL-GFP à 300K.pdb', width: 4800, height: 2700, date: day }),
  'Ray_2XYL-GFP_a_300K.pdb_4800x2700_2026-09-24_1507.png',
  'le nom porte la molécule, la taille RÉELLE et l’horodatage (deux « ray » ne s’écrasent jamais)');
eq(rayFileName({ label: '', width: 1600, height: 900, transparent: true, date: day }),
  'Ray_structure_1600x900_transparent_2026-09-24_1507.png',
  'sans nom de fichier la base est « structure », et le fond transparent est DIT dans le nom');
eq(rayFileName({ label: 'a/b\\c:d*e?f"g<h>i|j  k', width: 1, height: 1, date: day }),
  'Ray_a_b_c_d_e_f_g_h_i_j_k_1x1_2026-09-24_1507.png',
  'tout caractère interdit dans un nom de fichier devient _ (aucun chemin ne peut être fabriqué)');
eq(rayFileName({ label: 'ABC', width: 100, height: 50, date: new Date('nope'), ext: 'png' }).endsWith('.png'),
  true, 'une date invalide retombe sur maintenant au lieu de casser le nom');
eq(rayStamp(day), '2026-09-24_1507', 'l’horodatage est trié et stable (année-mois-jour_heure-minute)');

/* ── 2ter. L’APPEL À NGL — une doublure de stage ───────────────────────── */
const calls = [];
const captureStage = (w = 1600, h = 900) => ({
  viewer: { renderer: { domElement: { width: w, height: h } } },
  makeImage: async (params) => { calls.push(params); return { type: 'image/png', size: 4 }; },
});
const spyCalls = [];
const spy = (...args) => { spyCalls.push(args); };
const out = await captureRayImage(captureStage(), { factor: 3, transparent: true, onProgress: spy });
const sent = calls[calls.length - 1];
eq(sent.trim, false, 'trim est écrit EXPLICITEMENT (le défaut livré de NGL est déjà false, mais rien n’est laissé au hasard)');
eq(sent.factor, 3, 'le facteur est passé à NGL — sans lui la « ray » serait une capture 1×');
eq(sent.antialias, false,
  'à 3× la passe antialias n’est PAS demandée : la tuile est déjà un sur-échantillonnage, et ses 36 rendus sont ce qui faisait croire à un rendu qui ne finit jamais');
eq(sent.transparent, true, 'le fond transparent demandé par l’utilisateur arrive bien à NGL');
ok(typeof sent.onProgress === 'function', 'NGL reçoit une fonction de progression : la ligne de message suit les tuiles réellement rendues');
/* ⚠ L'IDENTITÉ DE LA FONCTION N'EST PLUS LA BONNE QUESTION : le rendu est surveillé
   (RAY_STALL_MS, le rapport « start ray tracing … hangs ») et chaque tuile doit être
   VUE pour relancer le compte à rebours — `onProgress` est donc ENROBÉ. C'est son
   EFFET qui doit rester le même : la fonction du viewer est bien appelée, avec les
   arguments de NGL. */
sent.onProgress(2, 9, false);
eq(spyCalls, [[2, 9, false]], '…et c’est bien celle du viewer que NGL appelle (l’enrobage du chien de garde ne la remplace pas)');
eq([out.factor, out.antialias, out.tiles], [3, false, 9], 'le module rend à l’appelant le facteur, la passe et les TILES réellement rendues');
eq(out.width, 4800, 'la taille annoncée À NGL correspond aux pixels réellement produits');
eq(out.height, 2700, '…dans les deux dimensions');
ok(!!out.blob && out.blob.type === 'image/png', 'le résultat est le Blob PNG de NGL, tel quel');
eq(out.transparent, true, '…et le module se souvient du fond transparent pour nommer le fichier');

calls.length = 0;
await captureRayImage(captureStage(800, 600), { factor: 2, antialias: false });
eq(calls[0].antialias, false, 'antialias:false est respecté quand un appelant le demande (aucune valeur imposée)');
eq(calls[0].factor, 2, '…et le facteur demandé passe tel quel sur une petite toile');
calls.length = 0;
const small = await captureRayImage(captureStage(800, 600), { factor: 2 });
eq(calls[0].antialias, true, 'un 2× au repos garde la passe antialias : c’est la règle du module, visible dans le titre du bouton');
eq(small.tiles, 16, '…et le message peut dire les 16 tuiles qu’elle coûte');

/* LES OMBRES PORTÉES ONT LEUR PROPRE BUDGET : une image énorme n’est jamais
   décodée / parcourue / ré-encodée — elle revient SANS ombre, avec la raison. */
calls.length = 0;
const skipped = await captureRayImage(captureStage(1600, 900), {
  factor: 2, shadows: true, lightDir: [0, 0, 1], shadowMaxPixels: 100,
});
eq(skipped.shadowNote, RAY_SHADOW_SKIP_NOTE,
  'au-dessus du budget des ombres la « ray » revient quand même — et le message DIT pourquoi il n’y a pas d’ombre');
ok(!!skipped.blob, '…l’image de NGL est rendue telle quelle (aucune erreur, aucun blocage)');
calls.length = 0;
const additive = await captureRayImage(captureStage(800, 600), { factor: 2 });
eq(additive.shadowNote, '', 'sans option d’ombre, aucune note : l’ombre reste ADDITIVE');

await assert.rejects(() => captureRayImage(null, {}), /no NGL renderer/,
  'un viewer sans stage NGL est refusé avec un message lisible (jamais un plantage)');
await assert.rejects(() => captureRayImage({ viewer: {} }, {}), /no NGL renderer/,
  '…y compris quand le stage existe mais pas makeImage');
await assert.rejects(
  () => captureRayImage({ viewer: { renderer: { domElement: { width: 0, height: 0 } } }, makeImage: async () => null }, {}),
  /no size yet/,
  'une toile pas encore mise en page est refusée : aucune image vide n’est écrite');
await assert.rejects(
  () => captureRayImage({ viewer: { renderer: { domElement: { width: 10, height: 10 } } }, makeImage: async () => null }, {}),
  /no image/,
  'un NGL qui ne rend rien (promesse résolue à vide) est signalé, pas avalé');

/* ── 2quater. L’OMBRE DE LA « RAY » EST LUE AVANT LE RENDU ───────────────
   LE bug de « la tache détachée » : `makeImage` rend la « ray » tuile par tuile et
   pousse la caméra dans le sous-frustum de chaque tuile ; quand c’est fini, NGL
   remet `camera.view` à null mais NE recalcule PAS la matrice de projection. La
   caméra lue après le rendu est donc encore celle de la DERNIÈRE tuile, et le
   masque construit là-dessus est celui d’une fenêtre 1/n × 1/n de l’image, grossi
   n× et jeté dans le coin : la tache, dans toutes les directions de lampe.
   La doublure ci-dessous reproduit EXACTEMENT ce comportement (une caméra réelle,
   un vrai sous-frustum, `view` remis à null comme le fait `_finalize`) : le masque
   rendu par captureRayImage doit être celui de la caméra au repos. */
const ident16 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const projOf = (fp, n, f) => [
  fp, 0, 0, 0,
  0, fp, 0, 0,
  0, 0, (f + n) / (n - f), -1,
  0, 0, (2 * f * n) / (n - f), 0,
];
// La transformation NDC d’une tuile (i, j) d’une grille n × n : celle que
// setViewOffset installe (x' = n·x + n − 2i − 1, y' = n·y + 2j + 1 − n).
const tileNdcOf = (n, i, j) => [n, 0, 0, 0, 0, n, 0, 0, 0, 0, 1, 0, n - 2 * i - 1, 2 * j + 1 - n, 0, 1];
const cleanProj = projOf(1 / Math.tan((25 * Math.PI) / 180), 0.1, 100);
const lastTileProj = mat4Multiply(tileNdcOf(2, 1, 1), cleanProj);
const rayCam = {
  type: 'PerspectiveCamera',
  view: null,
  projectionMatrix: { elements: cleanProj },
  // La caméra est de CÔTÉ (l’axe de la lampe est +z) : les deux atomes tombent sur
  // deux pixels différents, et celui de derrière porte bien l’ombre de celui de
  // devant — sans quoi il n’y aurait aucun masque à comparer.
  matrixWorldInverse: { elements: mat4LookAt([14, 0, 0], [0, 0, 0], [0, 1, 0]) },
};
const rayAtoms = () => ({
  position: new Float32Array([0, 0, 1, 0, 0, -1]),
  radius: new Float32Array([1, 1]),
});
const tiledStage = () => ({
  viewer: { width: 200, height: 200, camera: rayCam },
  compList: [{
    structure: { atomCount: 2, getAtomData: rayAtoms },
    matrix: { elements: ident16 },
    reprList: [{
      name: 'spacefill',
      getType: () => 'spacefill',
      type: 'representation',
      repr: {
        type: 'spacefill', radiusType: 'vdw', radiusScale: 1, visible: true,
        structureView: { getAtomIndices: () => Uint32Array.from([0, 1]) },
      },
    }],
  }],
  makeImage: async () => {
    rayCam.projectionMatrix = { elements: lastTileProj };   // la dernière tuile
    rayCam.view = { fullWidth: 400, fullHeight: 400, offsetX: 100, offsetY: 100, width: 200, height: 200 };
    rayCam.view = null;                                     // …ce que fait _finalize()
    return { type: 'image/png', size: 4 };
  },
});
const tiledOut = await captureRayImage(tiledStage(), {
  factor: 2, antialias: false, shadows: true, lightDir: [0, 0, 1],
});
ok(!!tiledOut.shadow && !!tiledOut.shadow.mask,
  'une doublure qui laisse la caméra dans sa dernière tuile porte QUAND MÊME une ombre (le rig a été lu avant)');
// La référence : la caméra remise au repos, le masque construit à la main.
rayCam.projectionMatrix = { elements: cleanProj };
rayCam.view = null;
const refInputs = rayShadowInputsOf(tiledStage(), { lightDir: [0, 0, 1] });
const refMask = buildRayShadowMask({ ...refInputs, width: 400, height: 400 });
let texelDiff = 0;
for (let i = 0; i < refMask.mask.length; i += 1) {
  if (tiledOut.shadow.mask[i] !== refMask.mask[i]) texelDiff += 1;
}
eq(texelDiff, 0,
  'le masque est EXACTEMENT celui de la caméra au repos — c’est l’ORDRE de la lecture qui le garantit');
// …et la preuve que ce test regarde la bonne chose : la caméra restée dans sa
// tuile, elle, donne un masque tout autre (décalé et magnifié).
const staleCam = { ...refInputs.camera, clip: mat4Multiply(tileNdcOf(2, 1, 1), refInputs.camera.clip) };
const staleMask = buildRayShadowMask({ ...refInputs, camera: staleCam, width: 400, height: 400 });
ok(!staleMask.mask.every((v, i) => v === refMask.mask[i]),
  'la MÊME lecture faite après le rendu (caméra restée dans la tuile) donne un AUTRE masque — ce que la correction évite');
ok(staleMask.shadowed !== refMask.shadowed,
  '…un masque différent jusque dans son nombre de pixels à l’ombre (la tache détachée du rapport)');

/* ── 2quinquies. L’ÉCRITURE DU FICHIER ─────────────────────────────────── */
eq(downloadBlob({ type: 'image/png' }, 'x.png'), false,
  'sans DOM l’écriture est simplement refusée (le module reste importable hors navigateur)');
ok(downloadBlob(null, 'x.png') === false, 'un Blob absent n’essaie même pas de fabriquer une ancre');
calls.length = 0;
const saved = await saveRayImage(captureStage(1600, 900), { label: 'test', factor: 2, date: day });
eq(saved.fileName, 'Ray_test_3200x1800_2026-09-24_1507.png', 'saveRayImage nomme le fichier avec la taille RÉELLE et la date donnée');
eq(saved.saved, false, 'hors navigateur l’enregistrement échoue proprement (le viewer le dit dans son message)');
ok(!!saved.blob && saved.width === 3200, '…et l’image est bien rendue quand même (le résultat reste exploitable)');

/* ── 2quater. L’APERÇU — LE RENDU MONTRÉ AVANT LE FICHIER ─────────────────
   La demande de cette session : « Would it be possible to see on the screen the
   result of ray before deciding to generate the image? » `previewRayImage` rend
   EXACTEMENT comme `saveRayImage` (le même `captureRayImage` : même scène, même
   budget, mêmes ombres portées) mais N’ÉCRIT RIEN : le blob revient à l’appelant
   avec le nom que le 💾 de l’aperçu écrira. */
calls.length = 0;
const shown = await previewRayImage(captureStage(1200, 800), { label: 'aperçu', factor: 2, date: day });
eq(shown.fileName, 'Ray_apercu_2400x1600_2026-09-24_1507.png',
  'l’aperçu annonce DÉJÀ le nom du fichier que le 💾 écrira (taille réelle et date)');
ok(!!shown.blob && shown.width === 2400 && shown.height === 1600,
  '…et il porte bien l’image rendue, à sa taille réelle');
eq(calls.length, 1, 'un seul passage par NGL pour l’aperçu : l’enregistrement ne re-rend pas la scène');
eq(previewUrlOf(null), '', 'sans blob il n’y a pas d’URL d’aperçu (rien à montrer)');
eq(releasePreviewUrl(''), false, '…et rien à libérer quand il n’y en a pas');

/* ── 2 bis. LE CHIEN DE GARDE : UN RENDU QUI NE RÉPOND PLUS ────────────────
   Le rapport : « start ray tracing … hangs ». `makeImage` est une promesse que RIEN
   n'oblige à se résoudre (contexte WebGL perdu, pilote qui ne rend jamais son GPU) et
   NGL n'offre AUCUNE annulation. Ce que le module garantit, c'est de ne pas attendre
   POUR TOUJOURS : le silence se mesure depuis la DERNIÈRE NOUVELLE, donc un rendu qui
   avance — même lentement — n'est jamais coupé. */
const silentStage = () => ({
  viewer: { renderer: { domElement: { width: 400, height: 300 } } },
  makeImage: () => new Promise(() => {}),          // jamais résolue : le rendu se tait
});
const t0 = Date.now();
let stallError = null;
try {
  await captureRayImage(silentStage(), { factor: 2, stallMs: 40 });
} catch (err) { stallError = err; }
ok(!!stallError && stallError.message === rayStallNote(40),
  'un rendu qui ne donne plus aucun signe de vie est ABANDONNÉ avec une raison lisible (le bouton ne reste pas sur « Rendering… »)');
ok(Date.now() - t0 < 5000, '…au bout du silence demandé, jamais d’une attente infinie');
ok(RAY_STALL_MS >= 10000, 'le silence par défaut est large : un gros rendu qui avance n’est jamais coupé (45 s)');
let chattyTiles = 0;
const chattyStage = {
  viewer: { renderer: { domElement: { width: 400, height: 300 } } },
  makeImage: async (params) => {
    for (let i = 0; i < 4; i += 1) {                 // quatre tuiles, plus lentes que le délai
      params.onProgress(i, 4);
      await new Promise((r) => setTimeout(r, 25));
      chattyTiles += 1;
    }
    return { type: 'image/png', size: 1 };
  },
};
const chatty = await captureRayImage(chattyStage, { factor: 2, stallMs: 60, onProgress: () => {} });
eq([chattyTiles, chatty.width, chatty.tiles], [4, 800, 16],
  'un rendu qui donne de ses nouvelles N’EST PAS abandonné : chaque tuile relance le compte à rebours');

/* ── 3. LE CÂBLAGE DANS LE VIEWER ──────────────────────────────────────── */
has("} from '../utils/viewerRayImage';", 'le viewer importe le module de la « ray » (et rien d’autre de nouveau)');
gone("from 'molstar'", 'aucun second moteur 3D n’est embarqué : la « ray » est rendue par NGL, la scène elle-même');

has('const [rayFactor, setRayFactor] = useState(() => {', '✨ Ray a SON PROPRE état de facteur');
has("localStorage.getItem('labViewerRayFactor')", '…persisté comme les autres préférences du viewer');
has("localStorage.getItem('labViewerRayTransparent')", '…ainsi que le choix du fond transparent');
has('const [rayBusy, setRayBusy] = useState(false);', 'un état « en cours » existe (le bouton ne peut pas être cliqué deux fois)');
has('const [raySizes, setRaySizes] = useState(() => rayFactorOptions(null));',
  'la liste des résolutions est de l’état : les pixels affichés sont ceux de CETTE toile');
has("window.addEventListener('resize', refresh);", '…et elle est rafraîchie quand la toile change de taille');
has('const captureRay = async () => {', 'le gestionnaire de la « ray » est son propre gestionnaire');
has('previewRayImage(stage, {', 'il passe par la fonction unique du module (le seul chemin vers NGL) — le rendu SANS écriture');
has('onProgress: (done, total) => {', 'la progression des tuiles remonte dans le message');
has('rayProgressText(done, total)', '…avec le format du module (testé plus haut)');

has('onClick={captureRay}', 'le bouton ✨ Ray est branché sur ce gestionnaire');
has("{rayBusy ? '✨ Rendering…' : '✨ Ray'}", 'son libellé dit quand il travaille');
has('disabled={rayBusy}', '…et il est réellement désactivé pendant le rendu');
has('⬚ alpha', 'la case du fond transparent est dans la barre, à côté du sélecteur');
has('label: file ? file.name : (pdbId || \'structure\')', 'le nom du fichier vient de la structure chargée (fichier, sinon PDB)');

/* L’APERÇU — la demande : « Would it be possible to see on the screen the result of
   ray before deciding to generate the image? » Le rendu est MONTRÉ (l’objet URL de
   l’état, l’`<img>` de la modale) et RIEN n’est écrit ; le 💾 de l’aperçu écrit le
   fichier que l’aperçu montre, et sa fermeture n’écrit rien du tout. */
has('const [rayPreview, setRayPreview] = useState(null);', 'un état d’aperçu de la « ray » existe');
has('rayPreviewUrlRef', '…son objet URL est tenu par une référence (libéré à la fermeture, au nouvel aperçu et au démontage)');
has('releasePreviewUrl(rayPreviewUrlRef.current)', '…et il est vraiment libéré (l’image ne reste pas en mémoire)');
has('<img src={rayPreview.url}', 'le PNG du rendu est MONTRÉ à l’écran, avant tout fichier');
has('const saveRayPreviewFile = (preview) => {', 'le 💾 de l’aperçu écrit LE fichier montré (downloadBlob, comme avant)');
has('onClick={() => saveRayPreviewFile(rayPreview)}', '…et il est branché sur cet aperçu précis');
has('✕ Close — write nothing', 'la fermeture de l’aperçu n’écrit RIEN');

/* L’ADDITIVITÉ — le point le plus important de la demande. */
const bodyOf = (name) => {
  const start = VIEW.indexOf(`const ${name} = `);
  assert.ok(start >= 0, `${name} introuvable dans la source`);
  let depth = 0;
  for (let i = start; i < VIEW.length; i += 1) {
    const c = VIEW[i];
    if (c === '{' || c === '(' || c === '[') depth += 1;
    else if (c === '}' || c === ')' || c === ']') depth -= 1;
    else if (c === ';' && depth === 0) return VIEW.slice(start, i + 1);
  }
  throw new Error(`${name} : instruction non terminée`);
};
const rayBody = bodyOf('captureRay');
ok(!rayBody.includes('publishLibraryFigure'),
  '✨ Ray N’ÉCRIT PAS dans la bibliothèque de figures (choix retenu : un fichier sur l’ordinateur)');
ok(!rayBody.includes('setCaptureMsg'),
  '✨ Ray n’écrit pas dans le message du 📷, qui n’existe plus');
ok(!rayBody.includes('addRepresentation') && !rayBody.includes('removeRepresentation'),
  'aucune représentation n’est ajoutée / retirée pour rendre l’image : la scène n’est pas touchée');
ok(!rayBody.includes('applyMaterialsToScene') && !rayBody.includes('requestRender'),
  'aucun matériau n’est réappliqué et aucun rendu n’est forcé dans le viewer');
ok(rayBody.includes('rayRunRef.current'), 'les rendus concurrents sont départagés par un jeton (le dernier message gagne)');
ok(rayBody.includes('onStatus: (text) => {'),
  'la SECONDE moitié du travail (ombres portées + PNG) parle aussi : c’est ce silence qui ressemblait à un rendu bloqué');
ok(rayBody.includes('RAY_SLOW_HINT_MS'),
  '…et après 20 s la ligne de progression DIT que ce × est lourd sur cet écran (le rapport « il rendering non finisce mai »)');
/* …ET L’ÉCRITURE N’EST PLUS DANS LE RENDU : le clic MONTRE la still (showRayPreview),
   c’est le 💾 de l’aperçu qui écrit le fichier — « before deciding to generate the
   image ». Aucun téléchargement ne part donc sans le geste de l’utilisateur. */
ok(!rayBody.includes('downloadBlob('),
  'le rendu lui-même N’ÉCRIT RIEN : l’écriture est un geste de plus, après le regard');
ok(rayBody.includes('showRayPreview(out)'), '…le résultat part vers l’APERÇU, qui le met à l’écran');

/* LE 📷 FIGURE A ÉTÉ RETIRÉ (la demande : « il pulsante figure é redundant ») —
   le handler, son message et l’import de la bibliothèque de figures ont disparu
   AVEC le bouton : aucune fonction morte ne reste derrière. */
gone('📷 Figure — the high', 'plus de bloc de bouton 📷 Figure');
gone('const captureScene = async () => {', 'plus de gestionnaire de capture 📷');
gone('const [captureMsg, setCaptureMsg] = useState', '…ni de message de capture');
gone("from '../utils/figuresLibrary'", '…ni l’import de la bibliothèque de figures (plus rien ne l’utilise)');
ok(!VIEW.includes('📷 Figure\n'), 'le libellé du bouton est bien parti de l’interface');

/* LE BLOC ✨ RAY VIT DANS LE GROUPE 🌫 SCENE DE « 2 · TOOLBAR » (la demande :
   « i comandi ray e i suoi associati (alpha, shadow) devono essere spostati nella
   sezione scene »). Les indices sont pris sur la ligne de la scène, pas sur la
   documentation d’en-tête du fichier, qui cite les mêmes mots. */
const iScene = VIEW.indexOf('🌫 Scene</span>');
const iRay = VIEW.indexOf('{rayMsg && (');
const iModify = VIEW.indexOf('✏️ Modify</span>');
ok(iScene > 0 && iRay > iScene && iModify > iRay,
  'le bloc ✨ Ray est DANS le groupe 🌫 Scene (avant le groupe ✏️ Modify) — la sezione 2 contient bien scene · modify · analysis');
ok(VIEW.includes('<VSection title="2 · Toolbar"'), '…et la barre d’outils est devenue la SECTION 2 de la barre de commande');

const MODULE = readFileSync(new URL('./src/utils/viewerRayImage.js', import.meta.url), 'utf8');
ok(!/useState|useRef|React/.test(MODULE), 'le module de la « ray » ne dépend d’aucun état React : il est exécutable tel quel');
ok(MODULE.includes("typeof document === 'undefined'"),
  'la seule écriture (l’ancre de téléchargement) est gardée : le module s’importe hors navigateur');
ok(/stage\.makeImage\(\{/.test(MODULE), 'le rendu passe par Stage.makeImage — le point d’entrée vérifié dans ngl 2.4.0');

/* ── Bilan ─────────────────────────────────────────────────────────────── */
console.log(`_viewer_ray_test.mjs — ${passed} assertions OK`);
