/* =========================================================================
   _builder_upscale_test.mjs — « in the object window a tool to improve the
   resolution of unclear images ».

   CE QUE L'OUTIL FAIT, ET CE QU'IL NE FAIT PAS. Le programme n'a AUCUN service
   d'IA (aucune clé, aucun envoi — et envoyer la figure non publiée de
   quelqu'un à un tiers est une décision que personne n'a prise ici). L'outil ✨
   fait donc, SUR CE POSTE, la moitié déterministe de ce qu'un « upscaler AI »
   donne sur un graphe : un ré-échantillonnage vers le haut (fait par le
   navigateur, en pas de ×2 — voir ImageBuilder) puis un travail sur les PIXELS
   (utils/figureUpscale.js) : le bruit des zones plates est ramené vers leur
   propre flou, et un MASQUE FLOU À SEUIL rend leur contraste aux traits, aux
   axes et aux caractères.

   Vérifié ici sur le module RÉEL (utils/figureUpscale.js), sur de minuscules
   images fabriquées à la main :
     • les bornes (facteur, force), la taille de sortie (le rapport est
       conservé, le facteur redescend au lieu de figer l'onglet) ;
     • le flou : une image plate reste plate, un fond transparent ne saigne
       PAS de noir dans les pixels d'une figure détourée (prémultipliée) ;
     • l'amélioration : force 0 = aucun pixel touché, un bord gagne du
       contraste, une zone plate bruitée est lissée, l'ALPHA n'est jamais
       touché, une image minuscule ne casse rien ;
   puis, dans ImageBuilder.jsx, que tout cela est branché à l'écran (le bouton
   dans la colonne « Modify image », l'outil sous le bouton, Ctrl+Z, la trace
   `im.upscale`, la vignette persistée qui reste PETITE).
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);

const UP = await import('./src/utils/figureUpscale.js');
const IB = readFileSync('./src/components/ImageBuilder.jsx', 'utf8').replace(/\r\n/g, '\n');

let passed = 0;
const eq = (actual, expected, what) => {
  assert.deepEqual(actual, expected, `${what}\n  attendu : ${JSON.stringify(expected)}\n  obtenu  : ${JSON.stringify(actual)}`);
  passed += 1;
};
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const has = (hay, needle, what) => {
  assert.ok(String(hay).includes(needle), `${what}\n  fragment absent : ${needle}`);
  passed += 1;
};
const times = (hay, re) => (String(hay).match(re) || []).length;

// Une image RGBA fabriquée : `painter(x, y, data, off)` écrit les 4 octets.
const image = (w, h, painter) => {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) painter(x, y, d, (y * w + x) * 4);
  }
  return d;
};
const gray = (v, a = 255) => (x, y, d, o) => { d[o] = v; d[o + 1] = v; d[o + 2] = v; d[o + 3] = a; };
// L'écart entre le plus sombre et le plus clair du rouge (le contraste visible).
const spreadOf = (buf) => {
  const vals = [...buf].filter((_, i) => i % 4 === 0);
  return Math.max(...vals) - Math.min(...vals);
};

/* ══ 1. LES BORNES ET LE VOCABULAIRE DE L'OUTIL ═══════════════════════════ */
eq(UP.UPSCALE_FACTORS, [2, 3, 4], 'les agrandissements offerts');
eq(UP.UPSCALE_DEFAULT_FACTOR, 2, 'le facteur proposé par défaut');
eq(UP.UPSCALE_DEFAULT_STRENGTH, 60, 'la force proposée par défaut');
eq([UP.UPSCALE_MIN_STRENGTH, UP.UPSCALE_MAX_STRENGTH], [0, 100], 'la force est un pourcentage');
eq(UP.UPSCALE_KEY, 'upscale', 'la trace du réglage vit sous cette clé, et une seule');
ok(UP.UPSCALE_MAX_SIDE > 0 && UP.UPSCALE_MAX_PIXELS > 0, 'la sortie est bornée (côté ET nombre de pixels)');
eq(UP.clampUpscaleFactor('3'), 3, 'un facteur de la liste passe');
eq(UP.clampUpscaleFactor(2.6), 3, '…même écrit avec des décimales');
eq([UP.clampUpscaleFactor(5), UP.clampUpscaleFactor(0), UP.clampUpscaleFactor(null), UP.clampUpscaleFactor('x')],
  [2, 2, 2, 2], 'un facteur inconnu retombe sur le défaut (jamais 0, jamais NaN)');
eq([UP.clampUpscaleStrength(-10), UP.clampUpscaleStrength(999), UP.clampUpscaleStrength('70')], [0, 100, 70],
  'la force est bornée à 0…100');
eq(UP.clampUpscaleStrength('nope'), UP.UPSCALE_DEFAULT_STRENGTH, 'une force illisible garde le défaut');
eq(UP.upscaleFactorLabel(4), '4×', 'l’étiquette d’un facteur');
eq(UP.sharpenAmountOf(0), 0, 'force 0 → aucun masque');
eq(UP.sharpenAmountOf(100), 0.8, 'force 100 → le masque le plus fort, borné à 0.8 (pas d’auréole)');
ok(Math.abs(UP.sharpenAmountOf(50) - 0.4) < 1e-9, 'la force est linéaire');
eq([UP.blurRadiusOf(49), UP.blurRadiusOf(50)], [1, 2], 'le rayon du flou s’ouvre à la moitié de la force');
eq([UP.unsharpThresholdOf(0), UP.unsharpThresholdOf(100)], [12, 4],
  'le seuil BAISSE quand la force monte (une force faible ne doit pas amplifier le grain)');


/* ══ 2. LA TAILLE DE SORTIE — LE RAPPORT EST CONSERVÉ, LA MÉMOIRE AUSSI ══ */
eq(UP.upscaleTargetSize(400, 300, 4), { w: 1600, h: 1200, factor: 4, wanted: 4, bounded: false },
  '4× sur une petite figure : ×4 dans les deux directions');
{
  const t = UP.upscaleTargetSize(1000, 250, 3);
  ok(Math.abs((t.w / t.h) - 4) < 1e-9, 'le rapport de la figure est conservé exactement');
}
eq(UP.upscaleTargetSize(3000, 3000, 4), { w: 3000, h: 3000, factor: 1, wanted: 4, bounded: true },
  'une source déjà énorme n’est PLUS agrandie : elle est seulement améliorée (facteur 1)');
{
  const t = UP.upscaleTargetSize(400, 300, 4, 1000000);
  eq([t.factor, t.w, t.h, t.bounded], [2, 800, 600, true],
    'le facteur redescend cran par cran (4 → 3 → 2) jusqu’à tenir dans la borne de pixels');
}
eq(UP.upscaleTargetSize(20, 20, 4, 1e12, 50).w, 40, 'le côté le plus long est borné lui aussi');
eq(UP.upscaleTargetSize(0, 0, 2), { w: 2, h: 2, factor: 2, wanted: 2, bounded: false },
  'une taille nulle est lue comme « 1 pixel », jamais 0 × 0');

/* ══ 3. LA TRACE DU RÉGLAGE (im.upscale) ═════════════════════════════════ */
eq(UP.normalizeUpscaleRecord(null), null, 'aucun réglage → rien');
eq(UP.normalizeUpscaleRecord({}), { factor: 2, strength: 60, w: 0, h: 0 }, 'un réglage vide prend les défauts');
eq(UP.normalizeUpscaleRecord({ factor: 9, strength: 900, w: '1200', h: 900.4 }),
  { factor: 2, strength: 100, w: 1200, h: 900 }, 'les valeurs sont bornées et arrondies');
eq(UP.upscaleRecordOf({ [UP.UPSCALE_KEY]: { factor: 3, strength: 50, w: 1200, h: 900 } }).factor, 3,
  'la figure porte son réglage sous la clé du module');
eq(UP.upscaleRecordOf({}), null, '…et une figure qui n’en a pas n’en invente pas');
eq(UP.upscaleSummary({ factor: 3, strength: 50, w: 1200, h: 900 }), '3× (1200 × 900 px) · sharpened 50%',
  'le résumé dit le facteur, la taille ET la force');
eq(UP.upscaleSummary({ factor: 2, strength: 0, w: 800, h: 600 }), '2× (800 × 600 px)',
  '…et tait la force quand il n’y en a pas');

/* ══ 4. LE FLOU — PLAT RESTE PLAT, UN DÉTOURAGE NE SAIGNE PAS ════════════ */
{
  const flat = image(8, 8, gray(128));
  const out = UP.blurRgba(flat, 8, 8, 2, 2);
  eq([...out.slice(0, 16)], [...flat.slice(0, 16)], 'une image parfaitement plate ne bouge pas');
  eq(out.length, 8 * 8 * 4, 'la sortie a exactement la taille de l’entrée');
}
{
  /* Un pixel blanc OPAQUE entouré de pixels transparents NOIRS (le cas d'une
     figure détourée) : sans prémultiplication, le flou tirerait le blanc vers le
     noir et une auréole sombre apparaîtrait le long de la découpe. */
  const w = 3;
  const d = image(w, w, (x, y, data, o) => { data[o + 3] = 0; });
  const c = (1 * w + 1) * 4;
  d[c] = 255; d[c + 1] = 255; d[c + 2] = 255; d[c + 3] = 255;
  const out = UP.blurRgba(d, w, w, 1, 2);
  ok(out[c] >= 200, `le blanc du pixel opaque n’est pas assombri par le fond transparent (obtenu ${out[c]})`);
  ok(out[c + 3] > 0 && out[c + 3] < 255, 'l’alpha, lui, est bien diffusé (le bord devient doux)');
}
{
  const empty = image(4, 4, gray(0, 0));
  const out = UP.blurRgba(empty, 4, 4, 1, 2);
  const alpha = [...out].filter((_, i) => i % 4 === 3);
  eq(alpha, Array(16).fill(0), 'une image entièrement transparente le reste');
}
eq(UP.blurRgba(new Uint8ClampedArray(4), 8, 8, 1, 2).length, 8 * 8 * 4,
  'un tampon trop court ne casse rien (résultat noir)');

/* ══ 5. L'AMÉLIORATION DES PIXELS ════════════════════════════════════════ */
{
  const before = image(6, 6, gray(120));
  const same = image(6, 6, gray(120));
  const stats = UP.enhanceRgbaInPlace(before, 6, 6, { strength: 0 });
  eq([...before], [...same], 'force 0 : AUCUN pixel n’est touché (seul l’agrandissement a lieu)');
  eq([stats.sharpened, stats.denoised, stats.amount], [0, 0, 0], '…et les compteurs le disent');
}
{
  /* Un bord franc (noir à gauche, blanc à droite) : le masque doit rendre le
     contraste — le pixel sombre juste avant le bord s’assombrit, le pixel clair
     juste après s’éclaircit — sans toucher l’alpha. */
  const w = 12;
  const h = 12;
  const d = image(w, h, (x, y, data, o) => {
    const v = x < w / 2 ? 40 : 215;
    data[o] = v; data[o + 1] = v; data[o + 2] = v; data[o + 3] = 255;
  });
  const darkBefore = d[((h / 2) * w + (w / 2 - 1)) * 4];
  const lightBefore = d[((h / 2) * w + (w / 2)) * 4];
  const beforeSpread = spreadOf(d);
  const stats = UP.enhanceRgbaInPlace(d, w, h, { strength: 100 });
  const darkAfter = d[((h / 2) * w + (w / 2 - 1)) * 4];
  const lightAfter = d[((h / 2) * w + (w / 2)) * 4];
  ok(darkAfter <= darkBefore, `le côté sombre du bord ne s’éclaircit pas (${darkBefore} → ${darkAfter})`);
  ok(lightAfter >= lightBefore, `le côté clair ne s’assombrit pas (${lightBefore} → ${lightAfter})`);
  ok(spreadOf(d) > beforeSpread, `le contraste du bord augmente vraiment (${beforeSpread} → ${spreadOf(d)})`);
  ok(stats.sharpened > 0, 'les pixels travaillés sont comptés');
  eq(d[3], 255, 'l’alpha du fond opaque n’est pas touché');
}
{
  /* Une zone PLATE légèrement bruitée (± 2 autour du gris : sous le plancher de
     bruit de l’outil) : le bruit doit baisser au lieu d’être amplifié. */
  const w = 10;
  const h = 10;
  const d = image(w, h, (x, y, data, o) => {
    const v = 128 + ((x + y) % 2 === 0 ? 2 : -2);
    data[o] = v; data[o + 1] = v; data[o + 2] = v; data[o + 3] = 255;
  });
  const before = spreadOf(d);
  const stats = UP.enhanceRgbaInPlace(d, w, h, { strength: 100 });
  ok(stats.denoised > 0, 'une zone plate bruitée est bien lissée');
  ok(spreadOf(d) <= before, `…et son écart se resserre (${before} → ${spreadOf(d)})`);
}
{
  const tiny = image(1, 1, gray(200, 128));
  UP.enhanceRgbaInPlace(tiny, 1, 1, { strength: 100 });
  eq([tiny[0], tiny[1], tiny[2], tiny[3]], [200, 200, 200, 128], 'une image 1 × 1 traverse l’outil sans rien casser');
}
{
  const d = image(4, 4, gray(10, 255));
  const stats = UP.enhanceRgbaInPlace(new Uint8ClampedArray(3), 4, 4, { strength: 100 });
  eq(stats.sharpened, 0, 'un tampon trop court ne fait rien (plutôt que de planter)');
  ok(d[3] === 255, '…et l’image réelle n’est pas touchée au passage');
}


/* ══ 6. LE BRANCHEMENT DANS L'IMAGE BUILDER ══════════════════════════════ */
has(IB, 'const enhanceActiveFigure = async () => {', 'le geste « améliorer cette figure » existe');
has(IB, 'const upImgEl = (src) => new Promise((resolve) => {', 'la figure est relue à sa taille NATURELLE');
has(IB, 'if (typeof full === \'string\' && (full.startsWith(\'data:image/svg+xml\') || full.includes(\'<svg\'))) {',
  'une figure VECTORIELLE est reconnue et n’est pas « améliorée » (elle n’a pas de pixels)');
has(IB, 'const target = upscaleTargetSize(sw, sh, upFactor);', 'la taille de sortie vient du module (bornée, rapport conservé)');
has(IB, 'if (sw * sh > UPSCALE_MAX_PIXELS) {',
  'une figure DÉJÀ énorme est refusée avec sa raison (plutôt que de figer l’onglet)');
eq(times(IB, /imageSmoothingQuality = 'high';/g), 3,
  'chaque pas de l’agrandissement est ré-échantillonné en qualité « high » (pas d’escalier)');
has(IB, 'while (cw * 2 <= target.w && ch * 2 <= target.h) {',
  '…en pas de ×2 AU PLUS : un saut unique de ×4 laisserait un escalier');
has(IB, 'const stats = enhanceRgbaInPlace(frame.data, target.w, target.h, { strength: upStrength });',
  'les pixels sont travaillés par le module (bruit lissé + masque flou à seuil)');
has(IB, 'commitHistory();', '…avec UNE étape d’historique (Ctrl+Z remet l’image d’origine)');
has(IB, 'patchFigure(obj.id, idx, {', 'l’écriture passe par patchFigure (un seul chemin, comme le détourage)');
has(IB, 'imgThumb: thumb || out,', 'la figure garde les nouveaux pixels');
has(IB, 'const thumb = await downscaleImage(out, 480, \'image/png\', 0.92, true)',
  'mais sa VIGNETTE persistée reste petite (la composition ne transporte pas des mégaoctets)');
has(IB, '[UPSCALE_KEY]: {', 'la trace du réglage est écrite sous la clé que le module possède');
has(IB, 'const figUpRecord = cropPanelIdx >= 0 ? upscaleRecordOf(selectedImgs[cropPanelIdx]) : null;',
  'la fenêtre sait ce qui a déjà été fait à la figure ACTIVE');
has(IB, '✨ Enhance resolution', 'le bouton est dans la ligne des outils de l’image');
has(IB, 'setUpTool((v) => !v)', '…et il déplie l’outil JUSTE SOUS lui (replié par défaut)');
has(IB, "className={`font-bold px-1.5 py-0.5 rounded text-[10px] border shrink-0 ${cropPanelIdx < 0 ? 'bg-slate-100 border-slate-200 text-slate-300' : (figUpRecord ? 'bg-violet-600 text-white border-violet-700'",
  '…désactivé sans figure, marqué « ✓ » sur une figure déjà améliorée');
has(IB, "'✨ Enhance this figure'", 'le geste est à un clic');
has(IB, "'✨ Working…'", '…et il dit qu’il travaille (la passe est longue sur une grande figure)');
{
  const where = IB.indexOf("✨ Enhance resolution");
  ok(IB.indexOf("{panelTitle('Modify image')}") < where && where < IB.indexOf('🌓 Shadow of figure'),
    'la commande vit dans la colonne « Modify image », à côté du détourage et de l’ombre — jamais dans un repli');
}
{
  /* Le corps du geste : l'outil travaille les pixels par le module, sur la
     figure ACTIVE, sans rien d'autre — et il refuse proprement une figure trop
     petite ou un navigateur sans canvas. */
  const body = IB.slice(IB.indexOf('const enhanceActiveFigure'), IB.indexOf("/* ── ↔ ÉCHANGER L'IMAGE D'UNE FIGURE"));
  has(body, 'const { obj, idx, im } = bgActiveFig();', 'le geste vise la figure ACTIVE du panneau');
  has(body, "setUpMsg(bgUnreadableMsg());", 'des pixels illisibles (image d’un autre site) sont dits, pas subis');
  ok(!/rect:|scale: 1|dx:|dy:|crop:|erase: null/.test(body),
    'il ne touche QUE les pixels : place, taille, recadrage, gomme et détourage restent');
  ok(body.indexOf('commitHistory();') < body.indexOf('patchFigure(obj.id, idx, {'),
    'l’historique est posé AVANT l’écriture');
}
/* L'outil dit franchement ce qu'il est : sur ce poste, sans service d'IA. */
has(IB, '(no image is uploaded anywhere: this program has no AI service)', 'le bouton le dit sur son infobulle');
has(IB, '✨ Enhance resolution — on this computer', '…et le bloc de l’outil aussi');
has(IB, 'no AI service is called (there is none in this program)', '…avec la raison (aucun service dans le programme)');
has(IB, 'const [upBusy, setUpBusy] = useState(false);', 'l’état « en cours » est gardé par le composant');
has(IB, 'onChange={(e) => setUpStrength(clampUpscaleStrength(e.target.value))}', 'la force est un curseur borné');
has(IB, 'onClick={() => setUpFactor(clampUpscaleFactor(f))}', 'le facteur est choisi parmi 2× / 3× / 4×');

console.log(`_builder_upscale_test.mjs — ${passed} assertions OK`);

