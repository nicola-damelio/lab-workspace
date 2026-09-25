/* =========================================================================
   _pub_docx_export_test.mjs — L'EXPORT EN .DOCX DU DOCUMENT D'UN PROJET.

   La demande : « In the document of the project there must be a export to docx
   button. »

   Le module RÉEL est importé (src/utils/docxExport.js, sans React ni DOM) et le
   fichier est FABRIQUÉ ici, puis ROUVERT avec fflate : les cinq parties d'un
   .docx doivent être là, le texte du document y être, les balises équilibrées,
   un titre devenir Heading1, une légende rester une légende, un lien devenir une
   relation externe — et un `<script>` ne jamais passer.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { register } from 'node:module';

// Les sources de src/ s'importent sans extension (résolues par Vite) — même
// crochet que _pub_author_style_test.mjs.
register('./_esm_test_hook.mjs', import.meta.url);
const {
  DOCX_MIME, buildDocxBytes, docxFileName, htmlToDocxBody, nodeText, parseHtmlTree
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
ok(!xml.includes('drive.example'), 'les pixels d’une figure ne sont PAS embarqués (leur URL non plus)');
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
const has = (needle, what) => ok(PROJ.includes(needle), `${what}\n  introuvable : ${needle}`);
has("from '../../utils/docxExport'", 'la page du projet importe l’export .docx');
has('const projectDocBodyHtml = () => {', 'le corps exporté est fabriqué UNE fois (impression et .docx le partagent)');
has('const exportProjectDocx = () => {', '…et l’export a son geste');
has('downloadDocx(bodyHtml, project.name)', 'le geste écrit le fichier du projet');
has('>📄 Export to Word', 'un bouton « 📄 Export to Word » est offert dans le document');
ok(PROJ.indexOf('downloadDocx(bodyHtml, project.name)') > PROJ.indexOf('const exportProjectDocx = () => {'),
  '…dans la fonction d’export (et non ailleurs)');
has('bodyHtml = reorderDocHtml(bodyHtml, docOrderWords(pubFormat), pubDocTitleKeywords(pubFormat));',
  'le .docx part avec l’ordre de sections et les intitulés choisis au panneau (le même corps que l’impression)');
ok((PROJ.match(/projectDocBodyHtml\(\)/g) || []).length >= 2,
  'l’impression et le .docx tirent le MÊME document (aucun des deux ne peut diverger)');

console.log(`_pub_docx_export_test.mjs — ${passed} assertions OK (export .docx du document)`);

