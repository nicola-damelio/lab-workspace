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
  nodeText, parseHtmlTree, resolveDocxImages
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

console.log(`_pub_docx_export_test.mjs — ${passed} assertions OK (export .docx du document)`);

