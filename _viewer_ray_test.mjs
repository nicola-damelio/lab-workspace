/* =========================================================================
   _viewer_ray_test.mjs — le bouton « ✨ Ray » (image statique haute résolution).

   La demande : un bouton qui exporte une image statique « ray » de la scène,
   À CÔTÉ du 📷 Figure existant, SANS RIEN CHANGER à ce qui existe (les cinq
   suites, le rig de lumière, le 📷 lui-même). Le choix retenu pour la
   destination : l'image est ÉCRITE SUR L'ORDINATEUR (PNG), elle n'entre pas
   dans la bibliothèque de figures.

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
      la liste du sélecteur en pixels, le plafonnement (budget + limites GPU),
      le nom du fichier, la ligne de progression, et l'APPEL À NGL — une
      doublure de stage prouve que trim / factor / antialias / transparent et
      onProgress sont tous passés EXPLICITEMENT.
   3. LE CÂBLAGE, dans la source du viewer : le bouton et son sélecteur, l'état
      et la persistance propres à ✨ Ray, et surtout l'ADDITIVITÉ — le 📷
      publie toujours dans la bibliothèque, ✨ Ray n'y touche pas, et rien de
      la scène n'est reconstruit pour rendre l'image.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RAY_FACTORS, RAY_DEFAULT_FACTOR, RAY_MAX_PIXELS, RAY_MAX_FACTOR,
  viewerPixelsOf, rayPixelsOf, clampRayFactor, rayFactorOptions, rayProgressText,
  captureRayImage, saveRayImage, rayFileName, rayStamp, downloadBlob, rayDimLimitOf,
} from './src/utils/viewerRayImage.js';

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

eq(RAY_FACTORS, [2, 3, 4, 6], 'les facteurs offerts sont ceux de la liste du module (2× · 3× · 4× · 6×)');
ok(RAY_FACTORS.includes(RAY_DEFAULT_FACTOR), 'le facteur par défaut est l’un des facteurs offerts (le sélecteur ne peut pas être vide)');

eq(viewerPixelsOf(fakeStage(1600, 900)), { width: 1600, height: 900 },
  'la taille lue est celle des PIXELS de la toile (HiDPI compté une seule fois)');
eq(viewerPixelsOf({ viewer: { width: 800, height: 600 } }), { width: 800, height: 600 },
  'sans toile lisible on retombe sur viewer.width / viewer.height');
eq(viewerPixelsOf(null), { width: 0, height: 0 }, 'un stage absent ne casse rien (aucune structure chargée)');
eq(viewerPixelsOf({ viewer: { renderer: { domElement: { width: 0, height: 0 } }, width: 640, height: 480 } }),
  { width: 640, height: 480 }, 'une toile de taille nulle retombe sur la taille du viewer');

eq(rayPixelsOf(fakeStage(1600, 900), 3), { factor: 3, width: 4800, height: 2700, pixels: 4800 * 2700 },
  '3× annonce 4800×2700 px pour une toile 1600×900 — exactement ce que NGL produira');
eq(rayPixelsOf(fakeStage(), 1).width, 1600, '1× est accepté (une capture simple reste possible)');
eq(rayPixelsOf(fakeStage(), 42).factor, RAY_MAX_FACTOR, 'un facteur absurde est plafonné à RAY_MAX_FACTOR');
eq(rayPixelsOf(fakeStage(), 'zut').factor, RAY_DEFAULT_FACTOR, 'un facteur non numérique retombe sur le défaut');

eq(clampRayFactor(fakeStageWithGl(800, 450, 16384), 6), 6, 'sur une petite toile le facteur demandé est accordé tel quel (6× = 4800×2700 px)');
eq(clampRayFactor(fakeStageWithGl(1600, 900, 16384), 6), 5,
  'le budget de 40 Mpx mord : 1600×900 × 6 = 52 Mpx → 5× (36 Mpx), quelle que soit la GPU');
eq(clampRayFactor(fakeStage(1600, 900), 6), 5,
  'sans limites GPU lisibles le repli de 8192 s’applique : 1600×6 > 8192 → 5× (jamais un rendu voué à l’échec)');
ok(clampRayFactor(fakeStage(1920, 1080), 6) < 6,
  `le budget de ${RAY_MAX_PIXELS} px est respecté (1920×1080 × 6 dépasse 40 Mpx : NGL ne recevrait jamais cette taille)`);
eq(clampRayFactor(fakeStageWithGl(1600, 900, 4096), 4), 2,
  'la limite GPU est respectée : 1600×4 > 4096 → 2× (le rendu ne peut pas échouer pour cette raison)');
eq(clampRayFactor(fakeStageWithGl(1600, 900, 4096), 1), 1,
  '…mais jamais sous 1× : le plafonnement ne peut pas rendre l’image impossible');
eq(clampRayFactor(null, 6), 6, 'une toile non mesurable garde le facteur demandé (le rendu échouera avec un message clair)');
eq(clampRayFactor(fakeStage(512, 288), 99), RAY_MAX_FACTOR,
  'le plafond dur reste RAY_MAX_FACTOR quand la toile peut le supporter (512×8 = 4096 px)');
eq(rayDimLimitOf(fakeStageWithGl(1600, 900, 4096)), 4096, 'la limite GPU lue est la plus petite des trois (texture · renderbuffer · viewport)');
eq(rayDimLimitOf(fakeStage(1600, 900)), 8192, 'sans contexte WebGL lisible on retombe sur la limite de repli (jamais NaN)');

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
const spy = () => {};
const out = await captureRayImage(captureStage(), { factor: 3, transparent: true, onProgress: spy });
const sent = calls[calls.length - 1];
eq(sent.trim, false, 'trim est écrit EXPLICITEMENT (le défaut livré de NGL est déjà false, mais rien n’est laissé au hasard)');
eq(sent.factor, 3, 'le facteur est passé à NGL — sans lui la « ray » serait une capture 1×');
eq(sent.antialias, true, 'antialias est ACTIVÉ par défaut (c’est le moyennage 4·factor² tuiles : le lissage du « ray »)');
eq(sent.transparent, true, 'le fond transparent demandé par l’utilisateur arrive bien à NGL');
ok(sent.onProgress === spy, 'la progression est celle du viewer : la ligne de message suit les tuiles réellement rendues');
eq(out.width, 4800, 'la taille annoncée À NGL correspond aux pixels réellement produits');
eq(out.height, 2700, '…dans les deux dimensions');
eq(out.factor, 3, 'le facteur effectif est rendu à l’appelant (le message peut le dire)');
ok(!!out.blob && out.blob.type === 'image/png', 'le résultat est le Blob PNG de NGL, tel quel');
eq(out.transparent, true, '…et le module se souvient du fond transparent pour nommer le fichier');

calls.length = 0;
await captureRayImage(captureStage(800, 600), { factor: 2, antialias: false });
eq(calls[0].antialias, false, 'antialias:false est respecté quand un appelant le demande (aucune valeur imposée)');
eq(calls[0].factor, 2, '…et le facteur demandé passe tel quel sur une petite toile');

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

/* ── 2quater. L’ÉCRITURE DU FICHIER ────────────────────────────────────── */
eq(downloadBlob({ type: 'image/png' }, 'x.png'), false,
  'sans DOM l’écriture est simplement refusée (le module reste importable hors navigateur)');
ok(downloadBlob(null, 'x.png') === false, 'un Blob absent n’essaie même pas de fabriquer une ancre');
calls.length = 0;
const saved = await saveRayImage(captureStage(1600, 900), { label: 'test', factor: 2, date: day });
eq(saved.fileName, 'Ray_test_3200x1800_2026-09-24_1507.png', 'saveRayImage nomme le fichier avec la taille RÉELLE et la date donnée');
eq(saved.saved, false, 'hors navigateur l’enregistrement échoue proprement (le viewer le dit dans son message)');
ok(!!saved.blob && saved.width === 3200, '…et l’image est bien rendue quand même (le résultat reste exploitable)');

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
has('saveRayImage(stage, {', 'il passe par la fonction unique du module (le seul chemin vers NGL)');
has('onProgress: (done, total) => {', 'la progression des tuiles remonte dans le message');
has('rayProgressText(done, total)', '…avec le format du module (testé plus haut)');

has('onClick={captureRay}', 'le bouton ✨ Ray est branché sur ce gestionnaire');
has("{rayBusy ? '✨ Rendering…' : '✨ Ray'}", 'son libellé dit quand il travaille');
has('disabled={rayBusy}', '…et il est réellement désactivé pendant le rendu');
has('⬚ alpha', 'la case du fond transparent est dans la barre, à côté du sélecteur');
has('label: file ? file.name : (pdbId || \'structure\')', 'le nom du fichier vient de la structure chargée (fichier, sinon PDB)');

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
  '✨ Ray n’écrit pas dans le message du 📷 : les deux boutons sont totalement indépendants');
ok(!rayBody.includes('addRepresentation') && !rayBody.includes('removeRepresentation'),
  'aucune représentation n’est ajoutée / retirée pour rendre l’image : la scène n’est pas touchée');
ok(!rayBody.includes('applyMaterialsToScene') && !rayBody.includes('requestRender'),
  'aucun matériau n’est réappliqué et aucun rendu n’est forcé dans le viewer');
ok(rayBody.includes('rayRunRef.current'), 'les rendus concurrents sont départagés par un jeton (le dernier message gagne)');

const shotBody = bodyOf('captureScene');
ok(shotBody.includes('publishLibraryFigure({'),
  'le 📷 Figure publie TOUJOURS dans la bibliothèque — son comportement n’a pas bougé');
has('📷 Figure', '…et son bouton existe toujours, tel quel');
has('onClick={captureScene}', '…branché sur le même gestionnaire qu’avant');

const iMsg = VIEW.indexOf('>{captureMsg}</span>');
const iRay = VIEW.indexOf('{rayMsg && (');
const iSetup = VIEW.indexOf('⚙️ SETUP — save / load the WHOLE');
ok(iMsg > 0 && iRay > iMsg && iSetup > iRay,
  'le bloc ✨ Ray est INSÉRÉ entre le 📷 et le ⚙️ Setup : rien n’a été déplacé, tout est ajouté');

const MODULE = readFileSync(new URL('./src/utils/viewerRayImage.js', import.meta.url), 'utf8');
ok(!/useState|useRef|React/.test(MODULE), 'le module de la « ray » ne dépend d’aucun état React : il est exécutable tel quel');
ok(MODULE.includes("typeof document === 'undefined'"),
  'la seule écriture (l’ancre de téléchargement) est gardée : le module s’importe hors navigateur');
ok(/stage\.makeImage\(\{/.test(MODULE), 'le rendu passe par Stage.makeImage — le point d’entrée vérifié dans ngl 2.4.0');

/* ── Bilan ─────────────────────────────────────────────────────────────── */
console.log(`_viewer_ray_test.mjs — ${passed} assertions OK`);
