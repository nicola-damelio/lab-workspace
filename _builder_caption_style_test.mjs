/* =========================================================================
   _builder_caption_style_test.mjs — « in the image builder let me decide if the
   caption stays at the bottom of the image or it should not appear, and allow me
   to change its style (police, fond, bold, italics, centered, justified, color) ».

   CE QUI A CHANGÉ, ET CE QUI EST VÉRIFIÉ ICI :

     • LA PRÉSENCE. Le caption du bas est un réglage de la COMPOSITION
       (`captionShow`). Décoché, il ne s'affiche plus du tout — à l'écran comme
       dans les exports : le bandeau réservé sous le canvas tombe à ZÉRO
       (`captionH`), et tout ce qui se déduit de ce chiffre suit (boîte du
       canvas, son ratio, le zoom, le centrage du plein écran, la position des
       éditeurs posés sur la toile, la hauteur du PNG exporté).
     • LA MISE EN FORME. Police, taille (pt), couleur, fond (background), gras,
       italique et alignement (gauche / centré / droite / JUSTIFIÉ) sont
       réglables, dans les options du canvas ET dans la barre du plein écran
       (les mêmes contrôles, une seule définition).
     • LE WRAP. Le caption est découpé en lignes qui tiennent dans la largeur de
       la planche (`captionWrapLines`) : un long caption ne déborde plus des deux
       côtés, la hauteur du bandeau suit le nombre de lignes, et « justifié » a
       enfin un sens (les lignes pleines sont étirées par `textLength`, la
       dernière reste naturelle).
     • LA COMPATIBILITÉ. Les valeurs par défaut SONT la mise en forme historique
       du caption (12 pt, gras, centré, #1f2937, sans fond) : une planche
       enregistrée avant ces réglages s'ouvre sans changer d'allure, et le
       bandeau par défaut garde la hauteur historique (14 mm) à moins d'un mm.

   Le composant ne peut pas être importé (module JSX) : les helpers PURS sont
   mirés VERBATIM depuis src/components/ImageBuilder.jsx — keep both in sync —
   et la VALIDATION d'un style est testée sur le module RÉEL
   (utils/figureStyle.js), celui que le composant appelle.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);

const { normalizeFigureStyle, normalizeFigureColor } = await import('./src/utils/figureStyle.js');
const { FIGURE_FONT_CHOICES } = await import('./src/utils/chartStyle.js');
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
const times = (hay, needle) => String(hay).split(needle).length - 1;

/* ── Miroir VERBATIM de ImageBuilder.jsx (keep both in sync) ─────────────── */
const ptToMm = (pt) => pt * 0.352778;
const DEFAULT_CAPTION_PT = 12;
const CAPTION_MIN_PT = 4;
const CAPTION_MAX_PT = 48;
const CAPTION_MARGIN_MM = 3;
const CAPTION_PAD_MM = 4;
const CAPTION_LINE_MM = 1.28;
const CAPTION_CHAR_MM = 0.5;
const CAPTION_CHAR_MONO_MM = 0.6;
const CAPTION_MONO_RE = /mono|courier|consolas|menlo|monaco/i;
const CAPTION_ALIGN_CHOICES = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Centred' },
  { value: 'right', label: 'Right' },
  { value: 'justify', label: 'Justified' }
];
const CAPTION_ALIGNS = CAPTION_ALIGN_CHOICES.map((a) => a.value);
const DEFAULT_CAPTION_STYLE = {
  font: '', fontSize: DEFAULT_CAPTION_PT, color: '#1f2937', bold: true, italic: false, align: 'center', bg: ''
};
const normalizeCaptionStyle = (style) => {
  const s = style && typeof style === 'object' ? style : {};
  const pt = Number(s.fontSize);
  return {
    font: normalizeFigureStyle({ fontFamily: s.font }).fontFamily,
    fontSize: Number.isFinite(pt) && pt > 0
      ? Math.min(CAPTION_MAX_PT, Math.max(CAPTION_MIN_PT, Math.round(pt)))
      : DEFAULT_CAPTION_PT,
    color: normalizeFigureColor(s.color) || DEFAULT_CAPTION_STYLE.color,
    bold: s.bold === undefined ? DEFAULT_CAPTION_STYLE.bold : !!s.bold,
    italic: !!s.italic,
    align: CAPTION_ALIGNS.includes(String(s.align)) ? String(s.align) : DEFAULT_CAPTION_STYLE.align,
    bg: normalizeFigureColor(s.bg)
  };
};
const captionIsMono = (font) => CAPTION_MONO_RE.test(String(font == null ? '' : font));
const captionWrapLines = (text, style, canvasW) => {
  const t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  if (!t) return [];
  const pt = Number(style && style.fontSize) > 0 ? Number(style.fontSize) : DEFAULT_CAPTION_PT;
  const charMm = ptToMm(pt) * (captionIsMono(style && style.font) ? CAPTION_CHAR_MONO_MM : CAPTION_CHAR_MM);
  const wrapW = Math.max(8, Number(canvasW) - 2 * CAPTION_MARGIN_MM);
  const perLine = Math.max(8, Math.floor(wrapW / charMm));
  const lines = [];
  let cur = '';
  for (const word of t.split(' ')) {
    const next = cur ? `${cur} ${word}` : word;
    if (next.length <= perLine) { cur = next; continue; }
    if (cur) lines.push(cur);
    cur = word;
    while (cur.length > perLine) { lines.push(cur.slice(0, perLine)); cur = cur.slice(perLine); }
  }
  if (cur) lines.push(cur);
  return lines;
};
const captionBandGeometry = (text, style, canvasW) => {
  const st = style || DEFAULT_CAPTION_STYLE;
  const lines = captionWrapLines(text, st, canvasW);
  const fontMm = ptToMm(st.fontSize || DEFAULT_CAPTION_PT);
  const lineH = fontMm * CAPTION_LINE_MM;
  const blockH = lines.length * lineH;
  return {
    lines,
    lineH,
    fontMm,
    blockH,
    ascent: fontMm * 0.95,
    wrapW: Math.max(8, Number(canvasW) - 2 * CAPTION_MARGIN_MM),
    bandH: lines.length ? blockH + 2 * CAPTION_PAD_MM : 0
  };
};
const captionBandHeightMm = (geom, editing, emptyLineH) => (
  geom.bandH > 0 ? geom.bandH : (editing ? emptyLineH : 0)
);
// Ce que le COMPOSANT calcule à partir de ces helpers (captionStyleNow / captionH).
const captionHOf = (text, style, canvasW, show, editing) => {
  const geom = captionBandGeometry(show ? text : '', style, canvasW);
  const emptyH = ptToMm(style.fontSize) * CAPTION_LINE_MM + 2 * CAPTION_PAD_MM;
  return { geom, emptyH, captionH: captionBandHeightMm(geom, editing, emptyH) };
};
// La ligne de base de la ligne i (capBaseY dans le JSX) et la place d'un mot.
const capBaseY = (geom, canvasH, i) => canvasH + CAPTION_PAD_MM + i * geom.lineH + geom.ascent;
const perLineOf = (style, canvasW) => {
  const charMm = ptToMm(style.fontSize) * (captionIsMono(style.font) ? CAPTION_CHAR_MONO_MM : CAPTION_CHAR_MM);
  return Math.max(8, Math.floor(Math.max(8, canvasW - 2 * CAPTION_MARGIN_MM) / charMm));
};
// Un caption long, du genre de celui que la planche fusionne (sous-captions A, B, C…).
const MERGED = 'A: Synthesis of the precursor · B: 1H NMR spectrum (600 MHz, CDCl3) · '
  + 'C: Confocal images of the treated cells · D: Dose–response curve · '
  + 'E: Western blot of the same lysates · F: Kinetic traces at 25 °C';

/* ══ 1. LE VOCABULAIRE ET LA COMPATIBILITÉ AVEC LES PLANCHES EXISTANTES ══ */
eq(CAPTION_ALIGN_CHOICES.map((a) => a.value), ['left', 'center', 'right', 'justify'],
  'les quatre alignements demandés : centré, justifié, et les deux bords');
ok(CAPTION_ALIGN_CHOICES.every((a) => a.label && a.label.length < 12),
  'chaque alignement a un nom court (le <select> des deux barres reste lisible)');
eq(normalizeCaptionStyle(undefined), DEFAULT_CAPTION_STYLE,
  'un caption JAMAIS stylé prend la mise en forme historique');
eq([DEFAULT_CAPTION_STYLE.font, DEFAULT_CAPTION_STYLE.fontSize, DEFAULT_CAPTION_STYLE.color,
  DEFAULT_CAPTION_STYLE.bold, DEFAULT_CAPTION_STYLE.italic, DEFAULT_CAPTION_STYLE.align, DEFAULT_CAPTION_STYLE.bg],
  ['', 12, '#1f2937', true, false, 'center', ''],
  '…c\'est-à-dire exactement celle que le composant dessinait en dur (12 pt, gras, centré, #1f2937, sans fond)');
eq(normalizeCaptionStyle(null), normalizeCaptionStyle(undefined),
  'null (un canvas sans la clé) est le même cas');
eq(normalizeCaptionStyle('n\'importe quoi'), DEFAULT_CAPTION_STYLE,
  'une valeur qui n\'est pas un objet aussi (le store peut contenir ce qu\'il veut)');
eq(normalizeCaptionStyle({}).bold, true,
  'un style partiel garde le gras historique (seul un `bold: false` explicite le retire)');
eq(normalizeCaptionStyle({ bold: false }).bold, false, '…et le retire quand on le demande');
eq(normalizeCaptionStyle({}).italic, false, 'l\'italique, lui, n\'est jamais imposé');

/* ══ 2. LA VALIDATION (sur le module RÉEL utils/figureStyle.js) ═══════════ */
eq(normalizeCaptionStyle({ fontSize: 900 }).fontSize, CAPTION_MAX_PT,
  'une taille trop grande retombe sur la borne haute du champ (48 pt)');
eq(normalizeCaptionStyle({ fontSize: 2 }).fontSize, CAPTION_MIN_PT,
  'une taille minuscule retombe sur la borne basse (4 pt)');
eq(normalizeCaptionStyle({ fontSize: '20' }).fontSize, 20,
  'la valeur tapée dans le champ (une chaîne) est appliquée comme un nombre');
eq(normalizeCaptionStyle({ fontSize: 11.4 }).fontSize, 11, 'elle est arrondie (le champ est en points entiers)');
eq([normalizeCaptionStyle({ fontSize: 0 }).fontSize, normalizeCaptionStyle({ fontSize: -3 }).fontSize,
  normalizeCaptionStyle({ fontSize: 'abc' }).fontSize, normalizeCaptionStyle({ fontSize: NaN }).fontSize],
  [DEFAULT_CAPTION_PT, DEFAULT_CAPTION_PT, DEFAULT_CAPTION_PT, DEFAULT_CAPTION_PT],
  'un champ vidé / invalide garde la taille en cours (la taille historique)');
eq([normalizeCaptionStyle({ color: 'red' }).color, normalizeCaptionStyle({ color: 'rgb(1,2,3)' }).color,
  normalizeCaptionStyle({ color: '' }).color],
  ['#1f2937', '#1f2937', '#1f2937'],
  'une couleur qui n\'est pas un #rrggbb ne peut pas imposer sa valeur (le texte reste lisible)');
eq([normalizeCaptionStyle({ color: '#FF0000' }).color, normalizeCaptionStyle({ color: '#F00' }).color],
  ['#ff0000', '#ff0000'],
  'les deux écritures hexadécimales sont ramenées à UNE (rien ne diverge d\'un poste à l\'autre)');
eq([normalizeCaptionStyle({ bg: '#FFFFFF' }).bg, normalizeCaptionStyle({ bg: '#fff' }).bg,
  normalizeCaptionStyle({ bg: 'yellow' }).bg, normalizeCaptionStyle({ bg: 'none' }).bg],
  ['#ffffff', '#ffffff', '', ''],
  'le FOND suit la même règle — et tout ce qui n\'est pas une couleur veut dire « pas de fond »');
eq(normalizeCaptionStyle({ font: 'Georgia, "Times New Roman", serif' }).font, 'Georgia, "Times New Roman", serif',
  'une vraie pile de polices passe telle quelle');
eq([normalizeCaptionStyle({ font: 'x); color: red' }).font, normalizeCaptionStyle({ font: '<b>Nope</b>' }).font],
  ['', ''],
  'du CSS / du balisage injecté est refusé (la police de l\'app reste)');
ok(FIGURE_FONT_CHOICES.every((f) => normalizeCaptionStyle({ font: f.value }).font === f.value),
  'TOUTES les polices proposées dans les deux listes sont acceptées telles quelles');
eq([normalizeCaptionStyle({ align: 'JUSTIFY' }).align, normalizeCaptionStyle({ align: 'middle' }).align,
  normalizeCaptionStyle({ align: null }).align],
  ['center', 'center', 'center'],
  'un alignement inconnu retombe sur le centré (le caption historique)');
eq(captionIsMono('ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'), true,
  'une police à chasse fixe est reconnue (ses caractères sont plus larges)');
eq([captionIsMono('Georgia, serif'), captionIsMono(''), captionIsMono(null)], [false, false, false],
  '…et une police proportionnelle aussi');


/* ══ 3. LE WRAP — UN CAPTION LONG NE DÉBORDE PLUS DE LA PLANCHE ══════════ */
const LINE1 = 'A: Synthesis of the precursor';
const shortGeom = captionBandGeometry(LINE1, DEFAULT_CAPTION_STYLE, 180);
eq(shortGeom.lines, [LINE1], 'un caption court tient sur une seule ligne');
const mergedGeom = captionBandGeometry(MERGED, DEFAULT_CAPTION_STYLE, 180);
eq(mergedGeom.lines.length, 3, 'le caption long (201 caractères) se découpe en 3 lignes à 180 mm / 12 pt');
eq(mergedGeom.lines.map((l) => l.length), [81, 82, 36],
  '…et le découpage est DÉTERMINISTE (mêmes lignes, donc même hauteur de bandeau, donc même canvas)');
ok(mergedGeom.lines.every((l) => l.length <= perLineOf(DEFAULT_CAPTION_STYLE, 180)),
  'aucune ligne ne dépasse la largeur utile de la planche — c’est ce qui empêche le texte de sortir des deux côtés');
eq(mergedGeom.lines.join(' '), MERGED, 'le découpage ne perd ni ne répète un mot');
eq(mergedGeom.lines.every((l) => l === l.trim()), true, 'aucune ligne ne commence ni ne finit par un espace');
const MONO = normalizeCaptionStyle({ font: 'Courier New, Courier, monospace' });
ok(perLineOf(MONO, 180) < perLineOf(DEFAULT_CAPTION_STYLE, 180),
  'une police à chasse fixe réserve plus de place par caractère (elle se replie plus tôt)');
const mid = 'word '.repeat(15).trim(); // 74 caractères
eq(captionWrapLines(mid, DEFAULT_CAPTION_STYLE, 180).length, 1,
  '74 caractères tiennent sur une ligne en police proportionnelle');
eq(captionWrapLines(mid, MONO, 180).length, 2, '…et se replient en deux lignes en police à chasse fixe');
const giantLines = captionWrapLines('X'.repeat(300), DEFAULT_CAPTION_STYLE, 180);
eq([giantLines.length, giantLines.map((l) => l.length)], [4, [82, 82, 82, 54]],
  'un mot plus long qu’une ligne (une URL) est coupé au lieu de dépasser');
eq(giantLines.join(''), 'X'.repeat(300), '…et ne perd aucun caractère');
eq(captionWrapLines('   ', DEFAULT_CAPTION_STYLE, 180), [], 'un caption vide (ou blanc) n’a aucune ligne');
eq(captionWrapLines('A:  one \n two', DEFAULT_CAPTION_STYLE, 180), ['A: one two'],
  'les espaces multiples et les retours à la ligne sont écrasés avant le découpage');
eq(captionWrapLines('Court', DEFAULT_CAPTION_STYLE, 20), ['Court'],
  'une toile très étroite garde au moins quelques caractères par ligne (jamais une boucle infinie)');

/* ══ 4. LA PLACE RÉSERVÉE SOUS LE CANVAS (captionH) ═══════════════════════ */
eq(mergedGeom.bandH, mergedGeom.blockH + 2 * CAPTION_PAD_MM,
  'le bandeau = la hauteur des lignes + la respiration du haut et du bas');
ok(Math.abs(shortGeom.bandH - 14) < 1,
  'par défaut le bandeau garde la hauteur historique (14 mm) à moins d’un mm près');
ok(mergedGeom.bandH > shortGeom.bandH, 'trois lignes réservent plus de place qu’une seule');
ok(captionBandGeometry(LINE1, normalizeCaptionStyle({ fontSize: 24 }), 180).bandH > shortGeom.bandH,
  'une taille plus grande (24 pt) agrandit le bandeau : le texte ne peut plus mordre sur la figure');
const lastBase = capBaseY(mergedGeom, 0, mergedGeom.lines.length - 1);
ok(lastBase + mergedGeom.fontMm * 0.25 <= mergedGeom.bandH,
  'la dernière ligne (et son jambage) reste DANS le bandeau, donc dans la toile exportée');
ok(capBaseY(mergedGeom, 0, 0) - mergedGeom.ascent >= 0,
  'la première ligne part du haut du bandeau, jamais sur la figure');
ok(capBaseY(mergedGeom, 0, 0) - mergedGeom.ascent >= CAPTION_PAD_MM - 0.001,
  '…et un peu d’air la sépare toujours du bas de la figure');
// LA PRÉSENCE : décoché, plus aucune place n’est réservée (écran ET exports).
const hidden = captionHOf(MERGED, DEFAULT_CAPTION_STYLE, 180, false, false);
eq(hidden.captionH, 0, '« Show caption » décoché : le caption ne réserve PLUS AUCUNE place');
eq(hidden.geom.lines, [], '…et rien n’est peint (aucune ligne à dessiner, aucun fond)');
eq(captionHOf(MERGED, DEFAULT_CAPTION_STYLE, 180, true, false).captionH, mergedGeom.bandH,
  'affiché : le bandeau fait exactement la hauteur du texte');
eq(captionHOf('', DEFAULT_CAPTION_STYLE, 180, true, false).captionH, 0,
  'une planche sans caption n’a pas de bandeau (la figure garde toute la place)');
const writing = captionHOf('', DEFAULT_CAPTION_STYLE, 180, true, true);
ok(writing.captionH === writing.emptyH && writing.emptyH > 0,
  'pendant qu’on l’écrit, le bandeau garde la place d’une ligne (l’éditeur ne se pose pas sur le bord du canvas)');
eq(captionHOf(MERGED, DEFAULT_CAPTION_STYLE, 180, false, true).captionH, writing.emptyH,
  'cliquer le caption d’une planche qui ne l’affiche pas le RÉ-AFFICHE (voir openCaptionEditor)');

/* ══ 5. LE RENDU (source de ImageBuilder.jsx) ═════════════════════════════ */
const capStart = IB.indexOf('{captionH > 0 && (');
const capSliceEnd = IB.indexOf('data-selection-ui="true"', capStart);
const capSlice = IB.slice(capStart, capSliceEnd);
ok(capStart > 0 && capSliceEnd > capStart && capSlice.length > 800,
  'le caption est bien délimité dans renderSvg (après les flèches, avant le premier marqueur d’interface)');
ok(!capSlice.includes('data-selection-ui="true"'),
  'le caption ne porte AUCUN marqueur d’interface : il part dans TOUS les exports (PNG, canvas sauvé, insertion)');
ok(IB.indexOf('filter={sp ? `url(#${shadowFilterId(a.id)})` : undefined}') < capStart,
  'il est dessiné APRÈS les figures et les flèches (le caption reste lisible, jamais recouvert)');
has(capSlice, '>{capLine}</text>', 'il est dessiné LIGNE PAR LIGNE (le texte wrappé, pas la chaîne entière)');
has(capSlice, "const capJustify = captionStyle.align === 'justify' && i < capGeom.lines.length - 1;",
  'le JUSTIFIÉ étire toutes les lignes SAUF la dernière (comme un paragraphe justifié)');
has(capSlice, 'textLength={capJustify ? capGeom.wrapW : undefined}',
  '…en étirant la ligne de marge à marge (textLength sur la largeur utile)');
has(capSlice, "lengthAdjust={capJustify ? 'spacing' : undefined}",
  '…en jouant sur les espaces entre les mots plutôt qu’en écrasant les lettres');
has(capSlice, 'fontFamily={letterFontCss(captionStyle.font)}',
  'la POLICE est écrite explicitement (une pile de polices) : un export est rendu hors du CSS de la page');
has(capSlice, "fontWeight={captionStyle.bold ? 'bold' : 'normal'}", 'le GRAS du caption est réglable');
has(capSlice, "fontStyle={captionStyle.italic ? 'italic' : 'normal'}", 'l’ITALIQUE du caption aussi');
has(capSlice, 'fill={captionStyle.color}', 'la COULEUR du texte aussi');
has(capSlice, 'fontSize={capGeom.fontMm}', 'la TAILLE vient de la géométrie du bandeau (une seule source)');
has(capSlice, 'textAnchor={capAnchor}', 'l’alignement horizontal passe par textAnchor');
has(capSlice, 'fill={captionStyle.bg}', 'le FOND est une vraie bande de couleur derrière le texte');
has(capSlice, 'width={capGeom.wrapW} height={capGeom.blockH}',
  '…aussi large que le texte, aussi haute que ses lignes (jamais une bande pleine largeur par accident)');
has(capSlice, 'title={capClickTitle}', 'un clic ouvre l’éditeur en place (l’infobulle le dit)');
has(capSlice, 'openCaptionEditor();', '…et passe par le MÊME point d’entrée que la ligne des options');
has(IB, 'const capGeom = captionBandGeometry(captionShow ? effectiveGlobalCaption : \'\', captionStyle, canvasW);',
  '« Show caption » décoché alimente la géométrie avec un texte VIDE (donc hauteur nulle, rien n’est peint)');
eq(times(IB, 'const captionH = captionBandHeightMm(capGeom, editingCaption, capEmptyH);'), 1,
  'la hauteur du bandeau est calculée UNE fois et sert partout (canvas, zoom, plein écran, exports)');
has(IB, 'canvas.height = Math.round((canvasH + captionH) * outScale);',
  'le PNG exporté suit cette hauteur (le caption n’est pas coupé, pas de bande blanche en trop)');
has(IB, '`0 0 ${canvasW} ${canvasH + captionH}`', 'le viewBox du SVG aussi (à l’écran comme à l’export)');
has(IB, 'const y = r.top + ((canvasH + CAPTION_PAD_MM) / (canvasH + captionH)) * r.height;',
  'l’éditeur en place se pose sur la PREMIÈRE ligne du caption (le bandeau n’a plus une hauteur fixe)');

/* ══ 6. LES CONTRÔLES — LES DEUX BARRES OFFRENT LE MÊME RÉGLAGE ═══════════ */
has(IB, '>Caption (bottom of the image)</span>', 'le groupe « Caption » est dans les options du canvas');
has(IB, '<input type="checkbox" checked={captionShow} onChange={e => setCaptionShow(e.target.checked)} /> Show caption',
  '…avec l’interrupteur de PRÉSENCE (« Show caption »)');
has(IB, '/> Background', '…et un interrupteur de FOND dédié (un fond, ou pas de fond du tout)');
has(IB, "value={captionStyle.bg || '#ffffff'} disabled={!captionStyle.bg}",
  '…dont la pipette est inerte tant que le fond est décoché (aucun réglage fantôme)');
has(IB, '/> Bold', 'le GRAS est une case à cocher du caption');
has(IB, '/> Italic', 'l’ITALIQUE aussi');
eq(times(IB, 'FIGURE_FONT_CHOICES.map((f) => ('), 4,
  'la police du caption se choisit dans LA MÊME liste que les lettres (deux barres × deux réglages)');
has(IB, 'Size (pt)', 'la TAILLE aussi (le bandeau la suit)');
has(IB, "value={captionStyle.align} onChange={e => setCaptionField('align', e.target.value)}",
  'l’ALIGNEMENT est une liste (gauche / centré / droite / justifié)');
has(IB, 'title="Alignment of the caption: left / centred / right, or justified',
  '…et son infobulle dit ce que « justifié » fait vraiment');
eq(times(IB, 'CAPTION_ALIGN_CHOICES.map((a) => ('), 2,
  'les quatre alignements sont offerts dans les DEUX barres');
eq(times(IB, 'value={captionStyle.font}') - times(IB, 'value={captionStyle.fontSize}'), 2,
  'la police du caption est lisible dans les deux barres (rien ne diverge entre elles)');
for (const [needle, label] of [
  ['checked={captionShow} onChange={e => setCaptionShow(e.target.checked)}', 'la présence'],
  ["setCaptionField('font', e.target.value)", 'la police'],
  ['setCaptionSize(e.target.value)', 'la taille'],
  ["setCaptionField('color', e.target.value)", 'la couleur'],
  ['toggleCaptionBg(e.target.checked)', 'le fond'],
  ["setCaptionField('bold', e.target.checked)", 'le gras'],
  ["setCaptionField('italic', e.target.checked)", 'l’italique'],
  ["setCaptionField('align', e.target.value)", 'l’alignement']
]) eq(times(IB, needle), 2, `${label} : UN seul réglage, deux endroits pour le changer`);
has(IB, 'Merges the object sub-captions (A: …, B: …)',
  'la ligne d’aperçu rappelle que le texte fusionne les sous-captions des panneaux');
has(IB, 'onClick={openCaptionEditor}',
  '…et un clic dessus ouvre l’éditeur en place (même geste que sur le caption)');
has(IB, 'title="Caption at the bottom of the image — exactly the settings of the canvas options',
  'la barre du plein écran DIT que ce sont les mêmes réglages que les options du canvas');

/* ══ 7. LA PERSISTANCE — LE CAPTION VOYAGE AVEC LA COMPOSITION ════════════ */
eq(times(IB, 'const captionPayload = useCallback('), 1,
  'les deux clés du caption sont définies UNE fois (captionPayload)');
eq(times(IB, '...captionPayload()'), 3,
  '…et les trois porteurs les recopient : état de session, canvas publié, sauvegarde automatique');
has(IB, 'if (data.captionShow !== undefined) setCaptionShow(!!data.captionShow);',
  'l’état de session relit la PRÉSENCE');
has(IB, 'if (data.captionStyle) setCaptionStyle(normalizeCaptionStyle(data.captionStyle));',
  '…et valide le style retrouvé');
has(IB, 'if (cd.captionShow !== undefined) setCaptionShow(!!cd.captionShow);',
  'rouvrir un canvas enregistré relit la présence aussi');
has(IB, 'if (cd.captionStyle) setCaptionStyle(normalizeCaptionStyle(cd.captionStyle));',
  '…avec exactement la même validation');
eq(times(IB, 'captionShow !== undefined'), 2,
  'les DEUX relectures sont GARDÉES : une composition sans ces clés ne remet rien à zéro');
has(IB, 'captionPayload, storageKey]);',
  'l’écriture de session se refait dès que le caption change (la fabrique est une VRAIE dépendance)');
eq(times(IB, 'projectId, captionShow, captionStyle]);'), 2,
  'les deux passes de sauvegarde automatique aussi (rien ne se perd en quittant la page)');
eq(JSON.parse(JSON.stringify({ captionShow: false, captionStyle: normalizeCaptionStyle({ fontSize: 20, italic: true, align: 'justify' }) })),
  { captionShow: false, captionStyle: { font: '', fontSize: 20, color: '#1f2937', bold: true, italic: true, align: 'justify', bg: '' } },
  'le style survit à un aller-retour JSON (localStorage, sidecar du Drive, copie publiée)');
has(IB, '— not shown: “Caption” ▸ “Show caption” is off',
  'la fenêtre d’insertion DIT que le caption ne partira pas avec l’image (jamais en silence)');
has(IB, 'The caption is hidden (“Show caption” is off) — click to bring it back and write it.',
  'la ligne d’aperçu dit la même chose et ramène le caption d’un clic');

/* ══ 8. CE QUI NE DOIT PLUS ARRIVER ═══════════════════════════════════════ */
eq(times(IB, 'ptToMm(12)} fill="#1f2937"'), 0,
  'le caption n’est PLUS écrit en dur (12 pt / #1f2937 / gras / centré étaient dans le rendu)');
eq(times(IB, 'const captionH = (effectiveGlobalCaption.trim() || editingCaption) ? 14 : 0;'), 0,
  '…ni sa hauteur FIXE de 14 mm (elle suit maintenant le nombre de lignes et la taille)');
eq(times(IB, 'const capEmptyH = ptToMm(captionStyle.fontSize) * CAPTION_LINE_MM + 2 * CAPTION_PAD_MM;'), 1,
  'la place d’une ligne vide se calcule à partir du style, jamais d’une constante recopiée');
ok(times(IB, 'CAPTION_MAX_PT') >= 2 && times(IB, 'CAPTION_MIN_PT') >= 2,
  'les bornes de la taille sont définies une fois et réutilisées (définition + validation)');
eq(times(IB, 'setSelectedId(null); setEditingCaption(true);'), 1,
  'un seul point d’entrée pour écrire le caption (openCaptionEditor), plus de formule recopiée');

console.log(`_builder_caption_style_test.mjs — ${passed} assertions OK`);
