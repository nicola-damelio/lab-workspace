/* =========================================================================
   _builder_figtools_test.mjs — LES COMMANDES DE LA FIGURE (Image Builder) :
   fond transparent, ombre de l'image, échange d'image et copie d'un texte.

   Quatre demandes, quatre vérifications :

     1) « allow me to remove the background so that it is transparent » — le
        détourage est un vrai travail sur les PIXELS (utils/figureBackground.js),
        vérifié ici sur de minuscules images fabriquées à la main : ce qui
        disparaît, ce qui reste (le blanc À L'INTÉRIEUR d'un dessin), la
        tolérance, l'adoucissement du bord, puis le branchement à l'écran ;
     2) « allow to add a shadow (I am talking about the image and not about the
        panel of the object) » — la commande est branchée sur la figure ACTIVE
        (le dessin du filtre <feDropShadow> est déjà vérifié par
        _builder_figshadow_test.mjs) ;
     3) « allow to substitute the image with another one keeping the same
        position and size » — « ↔ Swap » ne change QUE les pixels de la figure :
        rectangle, échelle, recadrage, gomme et ombre restent ;
     4) « allow me to select a text inserted in the panel and to copy it close so
        that I can modify it and move it » — un texte se CHOISIT (sur le canvas
        ou par son numéro) et « ⧉ Copy » le duplique 3 mm plus bas-droite, la
        copie devenant le texte choisi.

   Le module PUR est importé (jamais recopié) : les chiffres de ce test sont
   ceux du code qui tourne.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);

const FB = await import('./src/utils/figureBackground.js');
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
// Le corps d'une fonction, de son début à un repère précis (ou N caractères) :
// vérifier ce qu'elle ÉCRIT et ce qu'elle ne touche PAS — un fragment cherché
// dans le fichier entier ne prouverait rien.
const fnBody = (start, end = 1200) => {
  const at = IB.indexOf(start);
  if (at < 0) return '';
  if (typeof end === 'string') {
    const stop = IB.indexOf(end, at + start.length);
    return IB.slice(at, stop < 0 ? at + 1200 : stop);
  }
  return IB.slice(at, at + end);
};

/* ── 1. LE DÉTOURAGE : CE QUI DISPARAÎT, CE QUI RESTE ─────────────────────── */
const WHITE = [255, 255, 255, 255];
const BLACK = [0, 0, 0, 255];
const NEAR_WHITE = [250, 250, 250, 255];   // le « blanc » d'un JPEG
const CLEAR = [0, 0, 0, 0];                // déjà transparent
/* Une image de test : chaque caractère est une couleur (blanc par défaut). */
const img = (rows, map = {}) => {
  const height = rows.length;
  const width = rows[0].length;
  const data = new Uint8ClampedArray(width * height * 4);
  rows.forEach((row, y) => [...row].forEach((c, x) => {
    data.set(map[c] || WHITE, (y * width + x) * 4);
  }));
  return { data, width, height };
};
const alphaAt = (o, x, y) => o.data[((y * o.width) + x) * 4 + 3];

eq(FB.BG_DEFAULT_TOL, 36, 'la tolérance par défaut laisse passer le bruit d’un JPEG sans manger un trait clair');
eq(FB.BG_TOL_MIN, 0, 'on peut demander la couleur EXACTE (tolérance 0)');
eq(FB.BG_TOL_MAX, 160, '…et monter jusqu’à 160 (sur ~442 de distance maximale)');
eq(FB.clampBgTol(9999), 160, 'la tolérance est bornée');
eq(FB.clampBgTol(-5), 0, '…des deux côtés');
eq(FB.clampBgTol('pouet'), FB.BG_DEFAULT_TOL, '…et une valeur absurde retombe sur la valeur par défaut');
eq(FB.hexToRgb('#ffffff'), [255, 255, 255], 'une couleur hexadécimale se relit');
eq(FB.hexToRgb('#abc'), [170, 187, 204], '…même écrite en trois chiffres');
eq(FB.hexToRgb('rouge'), null, '…et autre chose n’est pas une couleur');
eq(FB.rgbToHex([255, 0, 16]), '#ff0010', 'une couleur s’écrit en hexadécimal');
eq(FB.backgroundKeysOf('#ffffff').length, 1, 'une clé hexadécimale est acceptée');
eq(FB.backgroundKeysOf([255, 255, 255]), [[255, 255, 255]], 'un triplet RGB aussi');
eq(FB.backgroundKeysOf([{ r: 1, g: 2, b: 3 }]), [[1, 2, 3]], 'un objet { r, g, b } aussi');
eq(FB.backgroundKeysOf(['#ffffff', '#ffffff', '#000']).length, 2, 'une LISTE de couleurs (les quatre coins) est dédoublonnée');
eq(FB.backgroundKeysOf('pas une couleur'), [], 'une clé illisible ne détoure rien');
ok(Math.abs(FB.colorDistance([0, 0, 0], [255, 255, 255]) - 441.67) < 0.01, 'la distance est celle de RGB (max ~441.7)');

/* Le fond CONNEXE aux bords : le blanc du cadre s’en va, le blanc INTÉRIEUR
   (une légende au milieu d’un graphe) reste. */
{
  const o = img(['00000', '01110', '01110', '00000'], { 1: BLACK });   // 20 px, 6 noirs
  const { removed, mask } = FB.removeBackgroundKey({ ...o, key: '#ffffff', tol: 0, mode: 'flood' });
  eq(removed, 14, 'le fond atteint depuis les bords disparaît (14 des 20 pixels)');
  eq(alphaAt(o, 0, 0), 0, '…le coin est transparent');
  eq(alphaAt(o, 2, 1), 255, '…et la figure, au milieu, est intacte');
  eq(mask.length, o.width * o.height, 'le masque couvre chaque pixel (il sert à adoucir le bord)');
}
{
  /* Un anneau noir fermé : le blanc à l’INTÉRIEUR n’est pas atteignable. */
  const o = img(['00000', '01110', '01010', '01110', '00000'], { 1: BLACK });
  const { removed } = FB.removeBackgroundKey({ ...o, key: '#ffffff', tol: 0, mode: 'flood' });
  eq(removed, 16, 'un remplissage part des bords : il ne rentre pas dans un anneau fermé (16 pixels dehors, 1 dedans)');
  eq(alphaAt(o, 2, 2), 255, '…le blanc enfermé dans le dessin est CONSERVÉ');
}
{
  /* Mode « everywhere » : la même image, tous les blancs s’en vont. */
  const o = img(['00000', '01110', '01010', '01110', '00000'], { 1: BLACK });
  const { removed } = FB.removeBackgroundKey({ ...o, key: '#ffffff', tol: 0, mode: 'all' });
  eq(removed, 17, '« everywhere » enlève la couleur PARTOUT (les 17 blancs)');
  eq(alphaAt(o, 2, 2), 0, '…y compris au milieu du dessin');
}
{
  /* Déjà transparent : on n’y touche pas et on ne le compte pas. */
  const o = img(['000', '010', '000'], { 1: BLACK, 0: CLEAR });
  const { removed } = FB.removeBackgroundKey({ ...o, key: '#ffffff', tol: 0, mode: 'flood' });
  eq(removed, 0, 'les pixels déjà transparents ne comptent pas comme enlevés');
  eq(alphaAt(o, 1, 1), 255, '…et la figure reste là');
}
{
  /* Tolérance : un « blanc » de JPEG est à 8.66 de distance du blanc exact. */
  const key = '#ffffff';
  const tight = img(['00', '00'], { 0: NEAR_WHITE });
  eq(FB.removeBackgroundKey({ ...tight, key, tol: 5, mode: 'all' }).removed, 0,
    'une tolérance trop serrée ne touche pas un fond légèrement grisé');
  const loose = img(['00', '00'], { 0: NEAR_WHITE });
  eq(FB.removeBackgroundKey({ ...loose, key, tol: 9, mode: 'all' }).removed, 4,
    '…une tolérance juste au-dessus l’enlève entièrement');
}
{
  /* Le BORD est adouci : le pixel conservé qui touche le fond et qui garde une
     trace de blanc devient partiellement transparent (aucun liseré clair). */
  const o = img(['0b', 'bb'], { 0: WHITE, b: NEAR_WHITE });
  const { mask } = FB.removeBackgroundKey({ ...o, key: '#ffffff', tol: 0, mode: 'flood' });
  eq(FB.softenBackgroundEdges({ ...o, key: '#ffffff', tol: 8, mask }), 2,
    'les deux pixels conservés qui touchent le fond sont adoucis');
  ok(alphaAt(o, 1, 0) > 0 && alphaAt(o, 1, 0) < 128, '…avec une transparence PARTIELLE (pas un bord net)');
  eq(alphaAt(o, 1, 1), 255, '…seulement SUR le bord : le reste du dessin est intact');
  const far = img(['00', 'cc'], { 0: WHITE, c: [200, 200, 200, 255] });
  const farMask = FB.removeBackgroundKey({ ...far, key: '#ffffff', tol: 0, mode: 'flood' }).mask;
  eq(FB.softenBackgroundEdges({ ...far, key: '#ffffff', tol: 8, mask: farMask }), 0,
    'un pixel franchement éloigné du fond n’est pas adouci');
  eq(FB.softenBackgroundEdges({ data: o.data, width: 0, height: 0, key: '#ffffff', tol: 8, mask }),
    0, 'une image vide n’adoucit rien (aucun plantage)');
  eq(FB.softenBackgroundEdges({ ...o, key: '#ffffff', tol: 0, mask }), 0,
    'une tolérance nulle n’adoucit rien (aucun bord à calculer)');
}
{
  /* Les quatre coins : la clé du réglage automatique. */
  const o = img(['ac', 'bd'], {
    a: [1, 1, 1, 255], b: [2, 2, 2, 255], c: [3, 3, 3, 255], d: [1, 1, 1, 255]
  });
  eq(FB.cornerColors(o), ['#010101', '#030303', '#020202'], 'les coins donnent les couleurs de fond, sans doublon');
  const clearCorners = img(['0c', 'bd'], {
    0: CLEAR, b: [2, 2, 2, 255], c: [3, 3, 3, 255], d: [4, 4, 4, 255]
  });
  eq(FB.cornerColors(clearCorners).length, 3, 'un coin déjà transparent ne propose rien');
  eq(FB.cornerColors({ data: new Uint8ClampedArray(0), width: 0, height: 0 }), [], 'une image vide n’a pas de coin');
}
eq(FB.bgRecordOf({ bg: { color: '#FFF', tol: 999, mode: 'zzz' } }),
  { color: '#ffffff', tol: 160, mode: 'flood' }, 'la trace du détourage est relue et bornée');
eq(FB.bgRecordOf({}), null, '…et une figure sans détourage n’en raconte pas');
eq(FB.bgRecordOf({ bg: { color: 'pas une couleur' } }), null, '…ni une donnée abîmée');
eq(FB.bgPixelSize(6000, 3000), { width: 1800, height: 900 }, 'les pixels lus sont bornés (une capture de 6000 px ne fige pas l’onglet)');
eq(FB.bgPixelSize(800, 600), { width: 800, height: 600 }, 'une petite image est lue telle quelle');

/* ── 2. LE DÉTOURAGE À L'ÉCRAN ─────────────────────────────────────────────── */
has(IB, 'const [bgTol, setBgTol] = useState(BG_DEFAULT_TOL);', 'la tolérance est un réglage de l’écran…');
has(IB, 'const [bgMode, setBgMode] = useState(\'flood\');', '…avec le choix de ce qui disparaît');
has(IB, 'const loadImagePixels = (src) => new Promise((resolve) => {', 'les pixels de la source sont lus dans un canvas');
has(IB, 'const { width, height } = bgPixelSize(img.naturalWidth, img.naturalHeight);',
  '…bornés (BG_MAX_SIDE), sinon une capture de 6000 px figerait l’onglet');
has(IB, 'const ctx = cv.getContext(\'2d\', { willReadFrequently: true });', '…et lus d’un seul coup (getImageData)');
has(IB, 'catch { resolve(null); }        // canvas « tainted » : image d\'un autre site',
  'une image d’un autre site n’est pas lisible : on le DIT au lieu de planter');
has(IB, 'const bgPixelsOf = async (src) => {', 'les pixels sont relus seulement quand la source change');
has(IB, 'const full = await resolveImageToDataUrl(src).catch(() => src);',
  '…et la source est ramenée en dataURL (une image du Drive se lit comme une capture)');
has(IB, 'const pickBackgroundAt = async (e) => {', 'cliquer le fond sur l’aperçu choisit la couleur');
has(IB, 'onClick={pickBackgroundAt}', '…et l’aperçu de la fenêtre est bien cliquable');
has(IB, 'const removeFigureBackground = async (auto = false) => {', 'un seul geste enlève le fond');
has(IB, 'const { removed, mask } = removeBackgroundKey({ ...pixels, key: keys, tol: bgTol, mode: bgMode });',
  '…avec la clé (ou les quatre coins) et la tolérance réglées à l’écran');
has(IB, 'const soft = softenBackgroundEdges({ ...pixels, key: keys, tol: bgTol, mask });',
  '…et le bord adouci (aucun liseré clair)');
has(IB, 'cv.getContext(\'2d\').putImageData(new ImageData(pixels.data, pixels.width, pixels.height), 0, 0);',
  'les pixels détourés sont ré-écrits dans un canvas');
has(IB, 'const out = cv.toDataURL(\'image/png\');', '…et exportés en PNG : c’est un VRAI fond transparent');
has(IB, 'imgSrc: out,', 'le PNG devient l’image de la figure…');
has(IB, 'imgThumb: out,                                   // la vignette persistée porte le détourage',
  '…ET sa vignette, sinon un rechargement ramènerait le fond');
has(IB, 'bg: { color: keyHex(keys[0]), tol: bgTol, mode: bgMode }', '…avec la trace du réglage sur la figure');
{
  const body = fnBody('const removeFigureBackground = async (auto = false) => {',
    "/* ── ↔ ÉCHANGER L'IMAGE D'UNE FIGURE");
  has(body, 'patchFigure(obj.id, idx, {', 'l’écriture passe par patchFigure (un seul chemin, comme writeFigureRect)');
  has(body, 'commitHistory();', '…précédée d’UNE étape d’historique (Ctrl+Z remet l’image d’origine)');
  ok(!/rect:|scale:|dx:|dy:|crop:|erase:|shadow:/.test(body),
    '…et elle ne touche QUE les pixels : place, taille, recadrage, gomme et ombre restent');
  has(body, 'bgPixelsRef.current = { src: out, pixels };',
    'les pixels du nouveau fichier sont gardés : la clé suivante ne relit pas l’image');
}
has(IB, 'const figBgRecord = cropPanelIdx >= 0 ? bgRecordOf(selectedImgs[cropPanelIdx]) : null;',
  'la fenêtre relit la trace du détourage de la figure ACTIVE');
has(IB, 'const figBgSrc = cropPanelIdx >= 0 ? bgFigSrcOf(selectedImgs[cropPanelIdx]) : \'\';',
  '…et montre les pixels de CETTE figure dans l’aperçu');
has(IB, '🎨 Transparent background', 'le bloc « Transparent background » est dans la fenêtre');
has(IB, 'Tolerance {clampBgTol(bgTol)}', '…il dit la tolérance en clair');
has(IB, '<option value="flood">touching the borders</option>', '…et propose le fond touchant les bords (le cas normal)');
has(IB, '<option value="all">everywhere</option>', '…comme le fond partout (celui qui n’est pas d’un seul morceau)');
has(IB, 'onClick={() => removeFigureBackground(false)}', 'le bouton « Remove background »');
has(IB, 'Auto: the four corners', '…et le réglage automatique par les quatre coins');
has(IB, '🎨 cut out · {figBgRecord.color}', 'la fenêtre rappelle ce que ces pixels portent');
has(IB, 'Click the background on the picture, then “🎨 Remove background”. Place, size, crop, erasures and shadow are untouched',
  'et dit ce qui n’est PAS touché, en clair');
ok(IB.indexOf('{panelMore && (') > 0 && IB.indexOf('{panelMore && (') < IB.lastIndexOf('🎨 Transparent background'),
  'le BLOC détaillé du détourage vit dans le repli « ▾ More options » (son bouton, lui, ouvre la colonne « Modify image »)');
ok(IB.indexOf('{cropPanelIdx >= 0 && (') < IB.lastIndexOf('🎨 Transparent background'),
  '…et le bloc ne s’affiche que pour une figure ACTIVE');

/* ── 3. L'OMBRE DE LA FIGURE (l'IMAGE, pas le cadre) ──────────────────────── */
has(IB, 'const toggleActiveFigureShadow = () => {', 'l’ombre de la figure se donne / s’enlève sur la figure ACTIVE…');
has(IB, "🌓 {figShadowOn ? 'Figure shadow ✓' : 'Figure shadow'}", '…d’un bouton qui dit si elle en a une');
has(IB, 'the picture, not the panel frame', '…et dont l’infobulle dit que c’est l’IMAGE (pas le cadre)');
ok(IB.indexOf('onClick={toggleActiveFigureShadow}') < IB.indexOf('{panelMore && ('),
  'le bouton est atteignable SANS ouvrir le repli (il ouvre la colonne « Modify image »)');

/* ── 4. ÉCHANGER L'IMAGE EN GARDANT PLACE ET TAILLE ──────────────────────── */
has(IB, 'const handleSwapImage = async (item) => {', '« ↔ Swap » a sa propre commande');
has(IB, 'const idx = obj ? activeFigIdx(obj) : -1;', '…qui vise la figure ACTIVE');
has(IB, '↔ Swap</button>', 'elle est proposée dans le dialogue de la bibliothèque');
has(IB, 'onClick={() => { setPickMode(\'swap\'); setShowLibrary(true); }} disabled={cropPanelIdx < 0}',
  '…et sur la ligne des figures, à côté de « 🖼 Import » / « ➕ Add figure »');
has(IB, 'else if (pickMode === \'swap\') handleSwapImage(first);',
  'un fichier importé depuis le PC suit le mode choisi, lui aussi');
has(IB, 'pickMode === \'swap\' ? handleSwapImage(item) : handlePickImage(item)',
  'cliquer une vignette en mode « Swap » échange l’image au lieu de recommencer le panneau');
{
  const body = fnBody('const handleSwapImage = async (item) => {', '// Valid crop window of a figure');
  has(body, 'patchFigure(obj.id, idx, {', 'l’échange écrit sur la figure, par le même chemin que le reste');
  has(body, 'imgSrc: src,', '…il change les pixels');
  has(body, 'bg: null', '…et oublie le détourage : il décrivait les ANCIENS pixels');
  has(body, 'crop: null,', '…ainsi que la fenêtre de recadrage (elle ne décrit pas la nouvelle image)');
  has(body, 'dx: 0, dy: 0, scale: 1,', '…le décalage et le zoom de l’ancienne image');
  has(body, 'erase: null,', '…et les traits de gomme, exprimés dans SES coordonnées');
  ok(!/(^|\s)(rect|shadow):/m.test(body),
    '…mais JAMAIS le CADRE (rect) ni l’ombre : l’image se SUBSTITUE dans la même boîte, aux mêmes dimensions');
  has(body, 'commitHistory();', '…et Ctrl+Z remet l’ancienne image');
}

/* ── 5. CHOISIR UN TEXTE ET LE COPIER JUSTE À CÔTÉ ───────────────────────── */
has(IB, 'const TEXT_COPY_STEP = 3;', 'la copie se pose 3 mm plus bas-droite (décalage nommé)');
has(IB, 'const duplicateText = (txId) => {', '« ⧉ Copy » a sa commande');
{
  const body = fnBody('const duplicateText = (txId) => {', "// Le texte CHOISI d'un panneau");
  has(body, 'commitHistory();', 'une copie = une étape d’historique');
  has(body, '...src,', 'la copie garde tout du texte d’origine (taille, couleur, gras, italique)');
  has(body, '+ TEXT_COPY_STEP', '…et se décale du pas annoncé');
  has(body, 'setActiveText({ objId: obj.id, txId: id });',
    '…puis devient le texte CHOISI : prêt à être modifié et déplacé');
  ok(/Math\.max\(1, Math\.min\(\(obj\.w \* cellW\) - 1/.test(body),
    '…et reste dans le panneau (jamais copié hors du cadre)');
}
has(IB, 'onClick={() => duplicateText(tx.id)}', 'le bouton est sur la ligne du texte');
has(IB, '>⧉ Copy</button>', '…et s’appelle « ⧉ Copy »');
has(IB, 'const activeTextOf = (obj) => {', 'le texte CHOISI se relit depuis le panneau');
has(IB, 'onClick={isSelected ? (e) => { e.stopPropagation(); setActiveText({ objId: obj.id, txId: tx.id }); } : undefined}',
  'cliquer un texte SUR LE CANVAS le choisit');
has(IB, 'onMouseDown={isSelected && !isEditing ? (e) => startTextDrag(e, obj.id, tx.id) : undefined}',
  '…sans lui retirer son glisser-déposer');
has(IB, '{isSelected && activeTextOf(obj) && (() => {', 'le texte choisi est encadré à l’écran');
{
  const box = fnBody('{isSelected && activeTextOf(obj) && (() => {', 700);
  has(box, 'data-selection-ui="true"', '…par un cadre de SÉLECTION : il ne sort jamais dans un export');
  has(box, 'strokeDasharray', '…en pointillés, pour ne pas être pris pour un cadre du panneau');
}
ok(IB.indexOf('{/* — end of the shadowed panel content — */}') < IB.indexOf('THE TEXT CHOSEN IN THIS PANEL'),
  'le cadre est dessiné HORS du groupe qui porte l’ombre du panneau (une marque ne projette pas d’ombre)');
has(IB, "activeText && activeText.txId === tx.id ? 'border-sky-400 ring-1 ring-sky-300 bg-sky-50'",
  'la ligne du texte choisi s’allume dans la fenêtre');
has(IB, 'title="Select THIS text — it is boxed on the canvas and its row lights up',
  '…et son numéro sert à le choisir');
has(IB, 'setActiveText((prev) => (prev && prev.objId !== selectedId ? null : prev));',
  'changer de panneau oublie le texte choisi (son id n’y a plus de sens)');
has(IB, 'setActiveText((prev) => (prev && prev.txId === txId ? null : prev));',
  'supprimer un texte oublie la sélection s’il était choisi');

console.log(`_builder_figtools_test.mjs — ${passed} assertions OK`);
