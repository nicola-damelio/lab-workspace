/* =========================================================================
   _pub_docx_export_test.mjs — L'EXPORT EN .DOCX DU DOCUMENT D'UN PROJET.

   La demande : « In the document of the project there must be a export to docx
   button. »

   Le module RÉEL est importé (src/utils/docxExport.js, sans React ni DOM) et le
   fichier est FABRIQUÉ ici, puis ROUVERT avec fflate : les cinq parties d'un
   .docx doivent être là, le texte du document y être, les balises équilibrées,
   un titre devenir Heading1, une légende rester une légende, un lien devenir une
   relation externe — et un `<script>` ne jamais passer.

   Les deux défauts signalés — « the export to docx does not reflect the style of
   the document, everything is different: police, alignement, font, color.
   furthermore images are missing » — sont vérifiés ici aussi :
     • LA MISE EN FORME DU DOCUMENT (§6) : le « Publication format » devient celle
       des runs — police, taille, alignement (w:jc), gras / italique / souligné
       (à trois états), couleur — partie par partie (titre, auteurs, intitulés,
       texte, figures et légendes, bibliographie). Sans format choisi, rien n'est
       inventé ;
     • LES IMAGES (§7) : les pixels ENTRENT dans le fichier (word/media/…, une
       relation, un type déclaré, un `<w:drawing>` à l'échelle de la page), et
       l'URL d'une image qu'on n'a pas su lire n'est jamais écrite.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { register } from 'node:module';

// Les sources de src/ s'importent sans extension (résolues par Vite) — même
// crochet que _pub_author_style_test.mjs.
register('./_esm_test_hook.mjs', import.meta.url);
const {
  DOCX_MIME, buildDocxBytes, docxFileName, htmlToDocxBody, imageSourcesIn,
  nodeText, parseHtmlTree, resolveDocxImages, reflowFigures, blockHeight, docxPageMetrics
} = await import('./src/utils/docxExport.js');

let passed = 0;
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const eq = (a, b, what) => {
  assert.deepEqual(a, b, `${what}\n  attendu : ${JSON.stringify(b)}\n  obtenu  : ${JSON.stringify(a)}`);
  passed += 1;
};
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

/* ══ 1. LE NOM DU FICHIER ══════════════════════════════════════════════════ */
eq(docxFileName('Aphid transmission'), 'Aphid transmission.docx', 'le nom du projet devient le nom du fichier');
eq(docxFileName('a/b:c*d?e"f<g>h|i'), 'a b c d e f g h i.docx',
  'les caractères interdits par Windows sont remplacés (aucun chemin ne peut sortir du dossier de téléchargement)');
eq(docxFileName(''), 'Project document.docx', 'sans nom, un nom par défaut');
ok(docxFileName('x'.repeat(200)).length <= 85, 'un nom très long est coupé');
ok(DOCX_MIME.includes('wordprocessingml.document'), 'le type MIME est celui de Word');

/* ══ 2. LE LECTEUR DE HTML ═════════════════════════════════════════════════ */
const tree = parseHtmlTree('<div><p>A<strong>B</strong></p><p>C</p></div>');
eq(tree.children.length, 1, 'un conteneur unique est lu');
eq(tree.children[0].children.map((c) => c.tag), ['p', 'p'], 'ses deux paragraphes sont là');
eq(nodeText(tree.children[0].children[0]), 'AB', 'le texte d’un paragraphe se lit à travers son gras');
eq(tree.children[0].children[0].children[1].tag, 'strong', '…et le gras reste un nœud à part');
const scriptTree = parseHtmlTree('<p>a<script>alert(1)</script>b</p>');
eq(nodeText(scriptTree.children[0]), 'ab',
  'un script est RETIRÉ avant tout rendu : son texte ne peut pas finir dans le .docx');
eq(parseHtmlTree('<p>&amp;#65; &lt;b&gt;</p>').children[0].children[0].text, '&#65; <b>',
  'les entités du HTML sont décodées une seule fois (&amp; d’abord, jamais deux)');
eq(parseHtmlTree('<br><img src="x.png"><hr>').children.map((c) => c.tag), ['br', 'img', 'hr'],
  'les balises sans fermeture (br, img, hr) ne mangent pas la suite du document');

/* ══ 3. LE CORPS RENDU ═════════════════════════════════════════════════════ */
const DOC = [
  '<h1 class="pf-title">Antimicrobial peptides &amp; more</h1>',
  '<p class="pf-authors">Rossi M<sup>1,2</sup>, Bianchi A</p>',
  '<h2 class="pf-heading">Results and Discussion</h2>',
  '<p>The peptides were tested <em>in vitro</em>, see <a href="https://doi.org/10.1/x">the paper</a>'
    + ' and <a href="#ref-2">ref 2</a>.</p>',
  '<ul><li>first point</li><li>second point</li></ul>',
  '<ol><li>first step</li><li>second step</li></ol>',
  '<table><thead><tr><th>Strain</th><th>MIC</th></tr></thead>'
    + '<tbody><tr><td>A</td><td>2 µM</td></tr></tbody></table>',
  '<figure class="pf-figure"><img src="https://drive.example/f1.png" alt="Figure 1">'
    + '<figcaption class="pf-caption">Figure 1. Aphid transmission.</figcaption></figure>',
  '<ol class="pf-bib"><li>Rossi M. <i>J. Biol. Chem.</i> 2024.</li></ol>'
].join('');
const body = htmlToDocxBody(DOC);
const xml = body.xml;
ok(xml.includes('<w:t xml:space="preserve">Antimicrobial peptides &amp; more</w:t>'),
  'le texte du titre est échappé (&amp;) et arrive entier');
ok(/<w:pStyle w:val="Heading1"\/>/.test(xml) && /<w:pStyle w:val="Heading2"\/>/.test(xml),
  'un h1 devient Heading1, un h2 devient Heading2');
ok(xml.includes('<w:vertAlign w:val="superscript"/>'), 'un <sup> devient un exposant Word');
ok(/<w:t xml:space="preserve">1,2<\/w:t>/.test(xml), '…et garde son texte');
ok(/<w:i\/>/.test(xml), 'l’italique passe');
ok(xml.includes('<w:t xml:space="preserve">•  </w:t>') && xml.includes('<w:t xml:space="preserve">2.  </w:t>'),
  'les listes deviennent des puces et des numéros');
ok(xml.includes('<w:tbl>') && xml.includes('<w:tblBorders>') && (xml.match(/<w:tc>/g) || []).length === 4,
  'le tableau devient un vrai tableau Word (2 × 2 cellules)');
ok(xml.includes('<w:t xml:space="preserve">Figure 1. Aphid transmission.</w:t>')
  && /<w:rPr><w:i\/><w:color w:val="555555"\/><w:sz w:val="18"\/>/.test(xml),
  'la légende de figure reste une légende (italique, grise, petite)');
ok(!xml.includes('drive.example'),
  'sans ses pixels, une figure n’écrit pas son URL : un .docx n’en ouvre aucune');
eq(body.links.length, 1, 'un seul lien externe : le renvoi interne « #ref-2 » n’en crée pas');
eq(body.links[0].href, 'https://doi.org/10.1/x', '…avec sa cible');
ok(xml.includes(`<w:hyperlink r:id="${body.links[0].id}">`), '…et le texte du lien devient un lien Word');
eq((xml.match(/<w:p>/g) || []).length, (xml.match(/<\/w:p>/g) || []).length, 'les paragraphes sont équilibrés');
eq((xml.match(/<w:tbl>/g) || []).length, (xml.match(/<\/w:tbl>/g) || []).length, '…les tableaux aussi');
eq((xml.match(/<w:r>/g) || []).length, (xml.match(/<\/w:r>/g) || []).length, '…les runs aussi');

/* Ce que la feuille d'IMPRESSION cache (la classe « no-print » : les boutons et
   les aides qui ne vivent qu'à l'écran, voir projectDetailModule) ne part pas non
   plus dans le fichier Word. */
const screenOnly = htmlToDocxBody('<p>text</p><span class="no-print">✏️ Edit this caption</span>'
  + '<p class="x no-print">helper</p><p>after</p>');
ok(!screenOnly.xml.includes('Edit this caption') && !screenOnly.xml.includes('helper'),
  'la classe « no-print » est retirée du .docx, comme à l’impression');
ok(screenOnly.xml.includes('text') && screenOnly.xml.includes('after'),
  '…et le texte du document, lui, reste entier');

/* ══ 4. LE PAQUET .DOCX, ROUVERT ═══════════════════════════════════════════ */
const bytes = buildDocxBytes(DOC);
ok(bytes instanceof Uint8Array && bytes.length > 500, `le fichier est un vrai ZIP (${bytes.length} octets)`);
const parts = unzipSync(bytes);
const names = Object.keys(parts).sort();
eq(names, ['[Content_Types].xml', '_rels/.rels', 'word/_rels/document.xml.rels', 'word/document.xml', 'word/styles.xml'],
  'les cinq parties qu’un lecteur de .docx attend sont là');
const doctype = strFromU8(parts['[Content_Types].xml']);
ok(doctype.includes('/word/document.xml') && doctype.includes('/word/styles.xml'),
  'le contenu déclare le document ET la feuille de styles');
const docPart = strFromU8(parts['word/document.xml']);
ok(docPart.startsWith('<?xml') && docPart.includes('<w:body>') && docPart.includes('<w:sectPr>'),
  'le document a son en-tête XML, son corps et sa feuille');
ok(docPart.includes('Antimicrobial peptides &amp; more'), 'le titre traverse le ZIP intact');
const rels = strFromU8(parts['word/_rels/document.xml.rels']);
ok(rels.includes('Target="styles.xml"'), 'la feuille de styles est reliée');
ok(rels.includes('Target="https://doi.org/10.1/x" TargetMode="External"'),
  'le lien de la référence est une relation EXTERNE (Word l’ouvre)');
ok(strFromU8(parts['_rels/.rels']).includes('Target="word/document.xml"'),
  'le paquet pointe sur le document principal');
ok(strFromU8(parts['word/styles.xml']).includes('styleId="Heading1"'), 'la feuille définit les titres');
/* LA LÉGENDE PORTE SON STYLE, dans le document ET dans la feuille : c'est ce que la
   remise en page reconnaît pour emmener une figure AVEC sa légende (voir §8). */
ok(/<w:pStyle w:val="Caption"\/>/.test(xml),
  'une <figcaption> devient un paragraphe de style « Caption » (la légende est NOMMÉE, pas devinée)');
ok(strFromU8(parts['word/styles.xml']).includes('styleId="Caption"'),
  '…et la feuille de styles définit ce style (Word le montre dans sa galerie)');
eq(buildDocxBytes(DOC).length, bytes.length, 'deux fabrications donnent le même fichier');

/* ══ 5. LE BRANCHEMENT : LE BOUTON EST DANS LA PAGE DU DOCUMENT ════════════ */
const PROJ = read('./src/components/AppModules/projectDetailModule.jsx');
const LIB = read('./src/utils/figuresLibrary.js');
const has = (needle, what) => ok(PROJ.includes(needle), `${what}\n  introuvable : ${needle}`);
has("from '../../utils/docxExport'", 'la page du projet importe l’export .docx');
has('const projectDocBodyHtml = () => {', 'le corps exporté est fabriqué UNE fois (impression et .docx le partagent)');
has('const exportProjectDocx = async () => {', '…et l’export a son geste');
has('downloadDocx(bodyHtml, project.name, { format: pubFormat, images })',
  'le geste écrit le fichier du projet — AVEC la mise en forme du document et les pixels des figures');
has('>📄 Export to Word', 'un bouton « 📄 Export to Word » est offert dans le document');
ok(PROJ.indexOf('downloadDocx(bodyHtml, project.name, { format: pubFormat, images })')
  > PROJ.indexOf('const exportProjectDocx = async () => {'),
  '…dans la fonction d’export (et non ailleurs)');
has('bodyHtml = reorderDocHtml(bodyHtml, docOrderWords(pubFormat), pubDocTitleKeywords(pubFormat));',
  'le .docx part avec l’ordre de sections et les intitulés choisis au panneau (le même corps que l’impression)');
ok((PROJ.match(/projectDocBodyHtml\(\)/g) || []).length >= 2,
  'l’impression et le .docx tirent le MÊME document (aucun des deux ne peut diverger)');
/* LES DEUX DÉFAUTS SIGNALÉS, côté page : la mise en forme part (le format du
   projet, le même que l'impression applique) et les images sont rapatriées AVANT
   la fabrication — un SVG dessiné en PNG au passage (voir rasterizeSvgImage). */
has('const images = await resolveDocxImages(bodyHtml, docxImageResolver);',
  'les figures sont rapatriées avant que le fichier ne soit fabriqué');
has('const docxImageResolver = async (src) => rasterizeSvgImage(await resolveImageToDataUrl(src));',
  '…par resolveImageToDataUrl (Drive, Nextcloud, URL), une image vectorielle passant en PNG');
ok(LIB.includes('export const rasterizeSvgImage = (src) => new Promise'),
  'une image vectorielle ne part pas telle quelle : elle est dessinée en PNG');
ok(LIB.includes('export const resolveImageToDataUrl = async (src, { fresh = false } = {}) => {'),
  '…et les pixels d’une figure du Drive se rapatrient avec la fonction prévue pour ça');

/* ══ 6. LA MISE EN FORME DU DOCUMENT (« Publication format ») ══════════════
   « the export to docx does not reflect the style of the document, everything is
   different: police, alignement, font, color. » Un format est donné au module —
   celui du projet, le même que l'impression applique (voir pubLayoutCss) — et
   chacune de ses parties doit se retrouver dans les runs du fichier. */
const FORMAT = {
  preset: 'custom',
  layout: {
    title: { font: 'Arial, Helvetica, sans-serif', size: 18, align: 'center', color: '#7b2d26' },
    authors: { size: 10, italic: true },
    heading: { font: '"Times New Roman", Times, serif', size: 13, align: 'left', bold: false },
    body: { font: 'Verdana, Geneva, sans-serif', size: 11.5, align: 'justify', color: '#123456' },
    figure: { size: 9, align: 'center', color: '#333333' },
    bibliography: { size: 8.5 }
  }
};
const fx = htmlToDocxBody(DOC, { format: FORMAT }).xml;
ok(fx.includes('<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>'),
  'la police choisie pour le titre devient celle de ses runs (Arial)');
ok(fx.includes('<w:color w:val="7B2D26"/>') && fx.includes('<w:sz w:val="36"/>'),
  '…sa couleur et sa taille aussi (18 pt = 36 demi-points, sans le # du CSS)');
ok(/<w:pStyle w:val="Heading1"\/><w:keepNext\/><w:jc w:val="center"\/>/.test(fx),
  'l’alignement du titre va au PARAGRAPHE (w:jc), comme dans la feuille du document');
ok(/<w:rFonts w:ascii="Times New Roman"[^>]*\/><w:b w:val="0"\/>/.test(fx)
  && /<w:pStyle w:val="Heading2"\/><w:keepNext\/><w:pBdr>/.test(fx),
  'un intitulé suit sa police, son « non gras » explicite (le programme l’écrit en gras) et son filet de section');
ok(/<w:jc w:val="both"\/>/.test(fx) && fx.includes('<w:color w:val="123456"/>') && fx.includes('<w:sz w:val="23"/>'),
  'le texte des sections est justifié (« justify » devient « both »), coloré et à sa taille (11,5 pt)');
ok(/<w:i\/><w:color w:val="333333"\/><w:sz w:val="18"\/>/.test(fx),
  'la légende de figure prend les réglages de la partie « figures »');
ok(fx.includes('<w:sz w:val="17"/>'), 'la bibliographie a la sienne (8,5 pt)');
ok(/<w:i\/><w:sz w:val="20"\/>/.test(fx), 'la ligne des auteurs garde son italique et sa taille');
{
  const fparts = unzipSync(buildDocxBytes(DOC, { format: FORMAT }));
  const fstyles = strFromU8(fparts['word/styles.xml']);
  ok(fstyles.includes('<w:rFonts w:ascii="Verdana"') && fstyles.includes('<w:sz w:val="23"/>'),
    'la feuille du fichier prend la police et la taille du « texte des sections » pour ses défauts');
  ok(fstyles.includes('styleId="Heading1"'), '…et garde ses intitulés');
}
/* RIEN N'EST INVENTÉ SANS FORMAT CHOISI : le document d'un projet qui n'a jamais
   touché au panneau s'exporte exactement comme avant. */
const plainXml = htmlToDocxBody(DOC).xml;
eq((plainXml.match(/<w:jc /g) || []).length, 0, 'sans format, aucun alignement n’est inventé');
ok(!plainXml.includes('<w:sz w:val="23"/>'), '…ni aucune taille choisie');
ok(/<w:rPr><w:b\/>/.test(plainXml), '…et le titre reste gras, comme le programme l’écrit');
/* Une valeur écrite à la main (un format trafiqué) ne peut pas casser le XML :
   la couleur doit être un #rrggbb, et la police perd ses guillemets — au pire
   elle n’est pas reconnue. */
ok(!htmlToDocxBody(DOC, { format: { layout: { body: { color: 'red; } * { color: magenta' } } } })
  .xml.includes('magenta'), 'une couleur qui n’est pas un #rrggbb n’entre pas dans le fichier');

/* ══ 7. LES IMAGES (« furthermore images are missing ») ════════════════════
   Un .docx ne va rien chercher sur le réseau : les pixels sont une PARTIE du
   fichier. Le module ne les invente pas — la page les lui donne (voir
   resolveDocxImages) ; ici, ils sont fabriqués pour la vérification.

   Un en-tête PNG suffit : le module ne DÉCODE pas l'image, il lit sa taille
   (IHDR) — c'est Word qui la décodera, sur les octets du vrai document. */
const pngDataUrl = (w, h) => {
  const b = new Uint8Array(33);
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].forEach((v, i) => { b[i] = v; });
  b[11] = 13;                                             // longueur du bloc IHDR
  'IHDR'.split('').forEach((c, i) => { b[12 + i] = c.charCodeAt(0); });
  [16, 20].forEach((at, k) => {
    const v = k === 0 ? w : h;
    b[at] = (v >>> 24) & 255; b[at + 1] = (v >>> 16) & 255; b[at + 2] = (v >>> 8) & 255; b[at + 3] = v & 255;
  });
  return `data:image/png;base64,${Buffer.from(b).toString('base64')}`;
};
const FIG = '<figure class="pf-figure"><img src="https://drive.example/f1.png" alt="Figure 1">'
  + '<figcaption class="pf-caption">Figure 1. Aphid transmission.</figcaption></figure>';
const pic = pngDataUrl(1600, 900);
const IMAGES = { 'https://drive.example/f1.png': pic };
const withPic = unzipSync(buildDocxBytes(FIG, {
  format: { layout: { figure: { align: 'center', width: 60 } } },
  images: IMAGES
}));
eq(Object.keys(withPic).sort(),
  ['[Content_Types].xml', '_rels/.rels', 'word/_rels/document.xml.rels', 'word/document.xml',
    'word/media/image1.png', 'word/styles.xml'],
  'les pixels sont une PARTIE du fichier (word/media/image1.png)');
const picDoc = strFromU8(withPic['word/document.xml']);
ok(picDoc.includes('<w:drawing>') && picDoc.includes('<pic:blipFill><a:blip r:embed='),
  '…et une vraie image Word (un w:drawing relié à sa partie)');
ok(!picDoc.includes('drive.example'), 'l’URL, elle, ne s’écrit nulle part : Word ne l’ouvrirait pas');
ok(picDoc.includes('<w:t xml:space="preserve">Figure 1. Aphid transmission.</w:t>'),
  'la légende accompagne l’image, comme dans le document');
ok(/<w:jc w:val="center"\/>/.test(picDoc), 'la figure est centrée quand le format le demande');
ok(strFromU8(withPic['[Content_Types].xml']).includes('<Default Extension="png" ContentType="image/png"/>'),
  'le paquet déclare le type de l’image (sans quoi Word refuse le fichier)');
ok(strFromU8(withPic['word/_rels/document.xml.rels']).includes('/image" Target="media/image1.png"'),
  '…et la relie au document');
/* LA TAILLE : 1600 px de large ne tiennent pas sur une page A4 — l’image est
   réduite à la colonne de texte, puis à la largeur choisie (60 %), et son
   rapport (16:9) est gardé. */
const extent = /<wp:extent cx="(\d+)" cy="(\d+)"\/>/.exec(picDoc);
eq(extent && Number(extent[1]), 3675974,
  'la largeur de l’image est celle du format (60 % de la colonne de texte)');
ok(extent && Math.abs(Number(extent[1]) / Number(extent[2]) - 1600 / 900) < 0.001,
  '…et son rapport est celui de la figure (16:9)');
{
  const full = /<wp:extent cx="(\d+)" cy="(\d+)"\/>/.exec(
    htmlToDocxBody(`<img src="f.png">`, { images: { 'f.png': pic } }).xml
  );
  eq(full && Number(full[1]), 6126624, 'sans largeur choisie, une figure large prend toute la colonne');
}
/* SANS PIXELS, RIEN N’EST INVENTÉ — et l’URL ne part pas non plus. */
const noPixels = unzipSync(buildDocxBytes(FIG));
eq(Object.keys(noPixels).sort(),
  ['[Content_Types].xml', '_rels/.rels', 'word/_rels/document.xml.rels', 'word/document.xml', 'word/styles.xml'],
  'une figure dont on n’a pas les pixels n’ajoute aucune partie au fichier');
ok(strFromU8(noPixels['word/document.xml']).includes('Figure 1. Aphid transmission.'),
  '…sa légende, elle, reste dans le document');
eq(htmlToDocxBody('<img src="data:image/svg+xml;base64,PHN2Zy8+">').media.length, 0,
  'un SVG ne part pas tel quel dans un .docx (la page le dessine en PNG avant — voir rasterizeSvgImage)');
eq(htmlToDocxBody(`<img src="a.png"><img src="a.png">`, { images: { 'a.png': pic } }).media.length, 1,
  'deux fois la même image ne fait qu’UNE partie dans le fichier');
/* LA PAGE VA CHERCHER LES PIXELS AVANT : la liste des images du document, et la
   table que l'export passe au module. */
eq(imageSourcesIn(`<p>x</p>${FIG}<img src="a.png"><img src="a.png">`),
  ['https://drive.example/f1.png', 'a.png'],
  'les images d’un document sont listées dans l’ordre, une seule fois chacune');
eq(imageSourcesIn('<img src="">'), [], 'une image sans source ne demande rien');
const asked = [];
const table = await resolveDocxImages(`<img src="a.png"><img src="${pic}">`, async (src) => {
  asked.push(src);
  return src === 'a.png' ? 'data:image/gif;base64,R0lGODlh' : '';
});
eq(asked, ['a.png'], 'seules les images qui n’ont PAS déjà leurs pixels sont demandées');
eq(Object.keys(table).sort(), ['a.png', pic].sort(), '…et la table rend celles qui ont été obtenues');

/* ══ 8. LA REMISE EN PAGE DES FIGURES (« large empty spaces ») ═════════════
   « when you export to word, you should reimpaginate and move the figures to avoid
   large empty spaces in the page. » Un .docx n'a pas de pagination : c'est Word qui
   pagine à l'ouverture, et une figure qui ne tient pas au bas d'une page y laisse un
   vide de la hauteur qu'elle aurait occupée. L'ordre des blocs est donc réécrit —
   JAMAIS un saut de page — quand une figure ne tient pas dans la place qui reste :
   le texte qui suit remplit la page, la figure tombe plus loin, avec sa légende. */
const metrics = docxPageMetrics(null);
eq([metrics.line, metrics.height, metrics.charsPerLine > 40],
  [253, 14570, true],
  'les mesures d’une page A4 (marges de 2 cm) et d’une ligne de 11 pt / 1,15 sont celles du .docx');
const wPara = (txt) => `<w:p><w:r><w:t xml:space="preserve">${txt}</w:t></w:r></w:p>`;
const wFigure = '<w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:drawing><wp:inline>'
  + '<wp:extent cx="6126624" cy="4000000"/></wp:inline></w:drawing></w:r></w:p>';
const wCaption = '<w:p><w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">Figure 1. Legende.</w:t></w:r></w:p>';
const longText = `A${'a'.repeat(4200)}`;
const tailText = 'BTAIL';
const page = wPara(longText) + wFigure + wCaption + wPara(tailText);
const flowed = reflowFigures(page, null);
ok(flowed.indexOf('<w:drawing') > flowed.indexOf(tailText),
  'la figure qui ne tient pas au bas de la page est DÉPLACÉE après le texte suivant (le texte remplit la page)');
ok(flowed.indexOf('Figure 1. Legende.') > flowed.indexOf('<w:drawing'),
  '…et sa LÉGENDE voyage avec elle (elles sont un seul objet)');
ok(flowed.indexOf(longText) < flowed.indexOf(tailText),
  'le texte, lui, garde son ordre : seul le bloc de la figure change de place');
eq((flowed.match(/<w:p>[\s\S]*?<\/w:p>/g) || []).map((b) => b.replace(/<[^>]*>/g, '')).sort(),
  (page.match(/<w:p>[\s\S]*?<\/w:p>/g) || []).map((b) => b.replace(/<[^>]*>/g, '')).sort(),
  'ce sont les MÊMES paragraphes (mêmes textes), seulement dans un autre ordre : rien n’est perdu, rien n’est inventé');
ok(!flowed.includes('w:br w:type="page"') && !/w:br\b/.test(flowed),
  'AUCUN saut de page n’est écrit : Word repagine librement, une page blanche est impossible');
eq(reflowFigures(wPara('Court') + wFigure + wCaption, null), wPara('Court') + wFigure + wCaption,
  'une figure qui tient dans la page ne bouge pas d’un caractère');
eq(reflowFigures(wPara('sans figure'), null), wPara('sans figure'),
  'un corps sans figure ressort exactement tel quel (la remise en page ne peut rien casser)');
/* UN INTITULÉ DE SECTION N'EST PAS UNE LÉGENDE. Sans cette règle, le premier
   paragraphe COURT qui suit une figure était pris pour sa légende : un `<h2>` aussi
   — et le titre de la section suivante repartait alors avec la figure, SOUS son
   premier paragraphe. La légende, elle, est reconnue à son style (`Caption`), donc
   sans jamais deviner, et elle voyage même quand du texte la suit. */
const wHead = '<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr>'
  + '<w:r><w:t xml:space="preserve">Results</w:t></w:r></w:p>';
const wCaptionStyled = '<w:p><w:pPr><w:pStyle w:val="Caption"/></w:pPr>'
  + '<w:r><w:t xml:space="preserve">Figure 1. Legende.</w:t></w:r></w:p>';
const headingAfter = reflowFigures(wPara(longText) + wFigure + wHead + wPara(tailText), null);
ok(headingAfter.indexOf('Results') < headingAfter.indexOf('<w:drawing'),
  'un intitulé de section ne voyage JAMAIS avec la figure (il reste devant elle)');
ok(headingAfter.indexOf('<w:drawing') > headingAfter.indexOf(tailText),
  '…et la figure, elle, est bien déplacée après le texte qui suit (la page reste remplie)');
const styledCaption = reflowFigures(wPara(longText) + wFigure + wCaptionStyled + wPara(tailText), null);
ok(styledCaption.indexOf('<w:drawing') > styledCaption.indexOf(tailText)
  && styledCaption.indexOf('Figure 1. Legende.') > styledCaption.indexOf('<w:drawing')
  && styledCaption.indexOf(tailText) < styledCaption.indexOf('Figure 1. Legende.'),
  'la légende reconnue à son style voyage avec sa figure, même quand du texte suit');
eq([...(styledCaption.match(/<w:pStyle w:val="Caption"\/>/g) || [])].length, 1,
  '…sans toucher au style de la légende (un seul paragraphe « Caption »)');
/* PLUSIEURS FIGURES dans un document long : chacune emmène SA légende, elles ne se
   croisent jamais, et aucune ne disparaît — c'est le cas d'un vrai manuscrit. */
const wCaption2 = '<w:p><w:pPr><w:pStyle w:val="Caption"/></w:pPr>'
  + '<w:r><w:t xml:space="preserve">Figure 2. Legende.</w:t></w:r></w:p>';
const twoFigures = reflowFigures(
  wPara(longText) + wFigure + wCaptionStyled + wPara(longText) + wFigure + wCaption2 + wPara(tailText), null
);
eq([...twoFigures.matchAll(/<w:drawing>|Figure \d\. Legende\./g)].map((m) => m[0]),
  ['<w:drawing>', 'Figure 1. Legende.', '<w:drawing>', 'Figure 2. Legende.'],
  'chaque figure garde SA légende collée et l’ordre du document est conservé');
eq(twoFigures.replace(/<[^>]*>/g, ''),
  longText + longText + tailText + 'Figure 1. Legende.' + 'Figure 2. Legende.',
  'le TEXTE ne change pas d’un caractère : il remplit les pages devant, les deux figures se suivent');
/* LA HAUTEUR D'UNE FIGURE EST PLAFONNÉE À LA COLONNE DE TEXTE : une image portrait
   plus haute qu'une page ne pourrait tenir NULLE PART — Word la pousserait seule sur
   la suivante, avec un grand vide derrière elle. */
const tall = /<wp:extent cx="(\d+)" cy="(\d+)"\/>/.exec(
  htmlToDocxBody('<img src="tall.png">', { images: { 'tall.png': pngDataUrl(800, 4000) } }).xml
);
eq(Number(tall && tall[2]), 8326755,
  'une figure portrait est ramenée à 90 % de la hauteur de la colonne (elle tient toujours sur une page)');
ok(Number(tall && tall[1]) < 6126624, '…et sa largeur suit, le rapport de l’image est gardé');
ok(blockHeight(`<w:p><w:r><w:t>${'x'.repeat(100)}</w:t></w:r></w:p>`, metrics) > metrics.line,
  'la hauteur estimée d’un paragraphe suit son nombre de lignes (l’estimation qui décide du placement)');
/* …ET DEPUIS LE DOCUMENT LUI-MÊME : le chemin réel (HTML → XML → remise en page)
   doit donner le même déplacement que le corps fabriqué à la main ci-dessus. */
const manyParas = Array.from({ length: 12 }, (_, i) => `<p class="pf-body">Paragraph ${i}. ${'m'.repeat(600)}</p>`).join('');
const wholeDoc = htmlToDocxBody(`${manyParas}${FIG}<p class="pf-body">After the figure.</p>`, { images: IMAGES }).xml;
ok(wholeDoc.indexOf('<w:drawing') > wholeDoc.indexOf('After the figure.'),
  'le document entier passe par la remise en page : la figure descend après le texte qui la suit');
ok(wholeDoc.indexOf('Paragraph 0.') < wholeDoc.indexOf('Paragraph 11.'),
  '…et l’ordre du texte, lui, ne bouge pas');

console.log(`_pub_docx_export_test.mjs — ${passed} assertions OK (export .docx du document)`);

