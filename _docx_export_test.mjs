/* =========================================================================
   _docx_export_test.mjs — LE DOCUMENT FINAL EN WORD (« ⬇️ Word (.docx) »).

   La demande, mot pour mot : « add a export to docx button to the final
   document ». Ce qui est mesuré ici, sur le module RÉEL
   (src/utils/docxExport.js) :

     §1 le document HTML → ses BLOCS : titres, paragraphes, gras/italique/
        exposants, liens (externes ET renvois internes), listes, tableaux,
        figures — et ce qui ne doit JAMAIS partir (`.no-print`, scripts) ;
     §2 le PAQUET .docx : c'est un vrai ZIP (fflate le relit), avec les parties
        que Word exige, des XML bien formés, et le même fichier deux fois de
        suite (l'écriture ne dépend pas de l'horloge) ;
     §3 ce que le XML DIT : le texte, sa mise en forme, les signets + renvois
        des citations « [12] », les images dans `word/media/`, les tableaux,
        les puces, l'échappement des « & » et des « < » ;
     §4 les PIXELS DES FIGURES : data:URL, adresse Drive (fetch simulé), image
        illisible (la figure garde son texte et le compte rendu le dit), SVG
        converti en PNG (rasterize simulé) ;
     §5 le CÂBLAGE du bouton dans le document final
        (src/components/AppModules/projectDetailModule.jsx) : le bouton existe,
        il part du MÊME corps HTML que « 🖨️ Print / Save as PDF ».

   Comme le module est pur (aucun DOM, aucun réseau implicite : `fetchImpl`,
   `measure` et `rasterize` sont injectables), tout se vérifie ici, hors
   navigateur.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { unzipSync, strFromU8 } from 'fflate';

// Les sources de src/ s'importent sans extension (résolues par Vite) — même
// crochet que _pub_doc_sections_test.mjs.
register('./_esm_test_hook.mjs', import.meta.url);

const DX = await import('./src/utils/docxExport.js');
const { dataUrlToBytes } = await import('./src/utils/dataUrlBytes.js');
const PROJ = readFileSync('./src/components/AppModules/projectDetailModule.jsx', 'utf8');

let passed = 0;
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const eq = (actual, expected, what) => {
  assert.deepEqual(actual, expected, `${what}\n  attendu : ${JSON.stringify(expected)}\n  obtenu  : ${JSON.stringify(actual)}`);
  passed += 1;
};

/* Des OCTETS d'image : l'écriture ne décode jamais les pixels (elle les range
   tels quels dans `word/media/`), donc une vraie photo n'apprendrait rien de
   plus ici. */
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
const DATA_PNG = `data:image/png;base64,${TINY_PNG}`;
const SVG_DATA = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="#fff"/></svg>'
);
const DRIVE_URL = 'https://lh3.googleusercontent.com/d/FIG1';
/* Ce que les octets encodés dans la data:URL valent vraiment : le paquet doit
   les contenir TELS QUELS. */
const DX_DATA_BYTES = dataUrlToBytes(DATA_PNG).length;

/* ---- le document final, tel que la page le construit (extrait fidèle) ------ */
const DOC = [
  '<div class="mb-6">',
  '  <h1 class="pf-title text-2xl font-black">Kinetics of the ABC transporter</h1>',
  '  <p class="pf-authors text-sm">Rossi<sup>1,2</sup>, Bianchi<sup>2</sup></p>',
  '</div>',
  '<div class="mb-6"><h2 class="pf-heading">Introduction</h2>',
  '  <p class="text-sm text-justify">Transport was measured at <b>37 °C</b> in buffer A &amp; B,',
  '     pH 7.4 (<i>n</i> = 3), as described earlier.<a href="#ref-12" class="cite-ref">[12]</a></p>',
  '</div>',
  '<div class="mb-6"><h2 class="pf-heading">Materials and Methods</h2>',
  '  <ul class="list-disc pl-4"><li>Buffer: 20 mM Tris, 100 mM NaCl</li>',
  '    <li>Strain: <i>E. coli</i> BL21<ul><li>grown at 30 °C</li></ul></li>',
  '  </ul>',
  '  <ol><li>Centrifuge</li><li>Resuspend</li></ol>',
  '  <table><thead><tr><th>Sample</th><th>t (s)</th></tr></thead>',
  '    <tbody><tr><td>A</td><td>10</td></tr><tr><td>B</td><td>20</td></tr></tbody></table>',
  '  <p>See <a href="https://doi.org/10.1000/xyz">our protocol</a>.</p>',
  '  <figure class="pf-figure"><img src="' + DATA_PNG + '" alt="uptake curve"/>',
  '    <figcaption class="pf-caption">Figure 1: uptake over time.</figcaption></figure>',
  '  <p class="no-print text-[10px]">Only the ⭐-starred items are imported here.</p>',
  '</div>',
  '<div class="mb-6"><h2 class="pf-heading">References (2)</h2>',
  '  <ol class="pf-bib"><li id="ref-12">Rossi A. <i>et al.</i> J. Biol. Chem. 2018.</li>',
  '  <li id="ref-13">Bianchi B. FEBS J. 2020.</li></ol>',
  '</div>',
  '<script>window.alert("jamais dans le Word")</scr' + 'ipt>'
].join('\n');

const blocks = DX.parseDocHtml(DOC);

/* ── 1. LE DOCUMENT → SES BLOCS ───────────────────────────────────────────── */
const types = blocks.map((b) => b.type);
eq(types.slice(0, 4), ['heading', 'para', 'heading', 'para'],
  '§1 le document commence par titre, auteurs, Introduction, son paragraphe');
ok(!JSON.stringify(blocks).includes('Only the ⭐-starred'),
  '§1 « .no-print » (aide de l’application) ne devient pas un bloc : absent du Word');
ok(!JSON.stringify(blocks).includes('jamais dans le Word'),
  '§1 le contenu d’un <script> ne part pas dans le document Word');

eq(blocks[0].level, 1, '§1 le <h1> du document devient un titre de niveau 1');
const authors = blocks[1];
const supRun = authors.runs.find((r) => r.text === '1,2');
ok(supRun && supRun.sup === true, '§1 « Rossi¹,² » : les marqueurs d’affiliation restent DES EXPOSANTS');

const intro = blocks[3];
ok(intro.runs.some((r) => r.text === '37 °C' && r.bold === true), '§1 le gras du texte est gardé');
ok(intro.runs.some((r) => r.text === 'n' && r.italic === true), '§1 l’italique est gardé');
ok(intro.runs.map((r) => r.text || '').join('').includes('buffer A & B'),
  '§1 « &amp; » redevient « & » (le texte est lu, pas recopié à l’aveugle)');
ok(intro.runs.filter((r) => (r.text || '').includes('as described earlier')).length === 1,
  '§1 des morceaux voisins de MÊME mise en forme ne font qu’un seul run');

const cite = intro.runs.find((r) => r.anchor);
ok(cite && cite.anchor === DX.bookmarkName('ref-12'),
  '§1 « [12] » reste un renvoi : son ancre devient un signet Word');
eq(DX.bookmarkName('ref-12'), 'b_ref12', '§1 le nom d’un signet Word est valide');
eq(cite.color, '2563EB', '§1 la citation garde le bleu de la feuille imprimée');
ok(cite.bold === true, '§1 …et son gras');

const methodsIndex = blocks.findIndex((b) => b.type === 'heading' && /Materials and Methods/.test(b.runs[0].text));
const methodBlocks = blocks.slice(methodsIndex + 1, blocks.findIndex((b) => b.type === 'heading' && /References/.test(b.runs[0].text)));
eq(methodBlocks.map((b) => b.type), ['list', 'list', 'list', 'list', 'list', 'table', 'para', 'figure'],
  '§1 la section Methods suit l’ordre du document : puces, numéros, tableau, paragraphe, figure');
const bullets = methodBlocks.filter((b) => b.type === 'list');
eq(bullets.map((b) => b.marker), ['•', '•', '•', '1.', '2.'],
  '§1 les puces et les numéros sont ÉCRITS (le même repère dans Word, LibreOffice et Google Docs)');
eq(bullets[2].depth, 1, '§1 une liste imbriquée dans un <li> est en retrait d’un cran');
const table = methodBlocks.find((b) => b.type === 'table');
eq(table.rows.length, 3, '§1 le tableau garde la ligne d’en-tête ET les deux lignes de données');
eq(table.rows[0].cells.map((c) => c.header), [true, true], '§1 les <th> restent des en-têtes (grisés et gras)');
eq(table.rows[0].cells[0].runs[0].text, 'Sample', '§1 …avec leur texte');
eq(table.rows.slice(1).map((r) => r.cells.map((c) => c.runs[0].text)), [['A', '10'], ['B', '20']],
  '§1 …et les valeurs des cellules suivent le tableau (ligne par ligne, colonne par colonne)');
const linkRun = methodBlocks.find((b) => b.type === 'para').runs.find((r) => r.href);
eq(linkRun.href, 'https://doi.org/10.1000/xyz', '§1 un lien du texte garde son adresse');

const figure = methodBlocks.find((b) => b.type === 'figure');
eq(figure.images.map((i) => i.src), [DATA_PNG], '§1 la figure porte sa source d’image');
eq(figure.caption.map((r) => r.text).join('').trim(), 'Figure 1: uptake over time.', '§1 …et sa légende');
eq(DX.collectImageSources(blocks), [DATA_PNG], '§1 les sources d’images sont listées, sans doublon');

const refItems = blocks.filter((b) => b.anchor && b.anchor.startsWith('b_ref'));
eq(refItems.map((b) => b.anchor), ['b_ref12', 'b_ref13'],
  '§1 la liste des références porte une ancre PAR référence (les renvois « [12] » la trouvent)');

/* ── 2. LE PAQUET .docx (un vrai ZIP, des XML bien formés) ────────────────── */

/* Un XML « bien formé » suffit pour que Word ouvre le fichier : les balises se
   ferment dans l'ordre, et aucun « < » ni « & » nu ne traîne dans le texte. Le
   contrôle ci-dessous est volontairement strict : c'est la seule chose qui peut
   transformer un bon document en fichier que Word refuse d'ouvrir. */
const assertWellFormedXml = (xml, what) => {
  const body = String(xml).replace(/^<\?xml[^>]*\?>/, '');
  const tags = /<[^>]+>/g;
  const stack = [];
  let consumed = 0;
  let m = tags.exec(body);
  while (m) {
    const text = body.slice(consumed, m.index);
    assert.ok(!text.includes('<'), `${what} : un « < » nu dans le texte (${JSON.stringify(text.slice(0, 40))})`);
    assert.ok(!/&(?!#[0-9]+;|#x[0-9a-fA-F]+;|[a-zA-Z][a-zA-Z0-9]*;)/.test(text),
      `${what} : un « & » non échappé (${JSON.stringify(text.slice(0, 40))})`);
    consumed = m.index + m[0].length;
    const token = m[0];
    if (/^<\?/.test(token)) { m = tags.exec(body); continue; }
    const name = (/^<\/?\s*([A-Za-z_][\w:.-]*)/.exec(token) || [])[1];
    assert.ok(name, `${what} : balise illisible ${token.slice(0, 40)}`);
    if (/^<\//.test(token)) {
      assert.equal(stack.pop(), name, `${what} : fermeture </${name}> dans le désordre`);
    } else if (!/\/>$/.test(token)) {
      stack.push(name);
    }
    m = tags.exec(body);
  }
  assert.equal(stack.length, 0, `${what} : balises restées ouvertes (${stack.join(', ')})`);
  passed += 1;
};

const IMAGES = { [DATA_PNG]: { bytes: dataUrlToBytes(DATA_PNG), ext: 'png' } };
const file = DX.buildDocx({
  blocks,
  images: IMAGES,
  title: 'Kinetics of the ABC transporter',
  creator: 'Rossi',
  dateIso: '2026-09-25T10:00:00.000Z'
});
ok(file.bytes instanceof Uint8Array && file.bytes.length > 1500,
  `§2 le fichier est bien des octets (${file.bytes.length} o)`);
eq(file.fileName, 'Kinetics of the ABC transporter.docx', '§2 le nom du fichier suit le titre de l’article');
eq(file.embedded, 1, '§2 la figure du document est écrite');
eq(file.missing, [], '§2 aucune figure n’est restée de côté');

const zip = unzipSync(file.bytes);
const names = Object.keys(zip);
[['[Content_Types].xml'], ['_rels/.rels'], ['word/document.xml'], ['word/styles.xml'],
  ['word/_rels/document.xml.rels'], ['docProps/core.xml'], ['docProps/app.xml']]
  .forEach(([n]) => ok(names.includes(n), `§2 le paquet contient ${n}`));
ok(names.includes('word/media/image1.png'), '§2 les pixels de la figure sont dans word/media/');
eq(zip['word/media/image1.png'].length, DX_DATA_BYTES, '§2 …tels quels (aucun pixel n’est retouché)');

names.filter((n) => /\.(xml|rels)$/.test(n)).forEach((n) => assertWellFormedXml(strFromU8(zip[n]), n));

/* Le MÊME document doit donner le MÊME fichier : l'écriture ne lit ni l'heure
   ni un compteur global (sinon un test ne pourrait rien affirmer, et deux
   exports du même texte ne se compareraient pas). */
const again = DX.buildDocx({ blocks, images: IMAGES, title: 'Kinetics of the ABC transporter', creator: 'Rossi', dateIso: '2026-09-25T10:00:00.000Z' });
eq(again.bytes.length, file.bytes.length, '§2 deux exports du même document donnent le même fichier (taille)');
eq(Array.from(again.bytes), Array.from(file.bytes), '§2 …octet pour octet');

/* ── 3. CE QUE LE XML DIT ─────────────────────────────────────────────────── */
const docXml = strFromU8(zip['word/document.xml']);
const relsXml = strFromU8(zip['word/_rels/document.xml.rels']);
const typesXml = strFromU8(zip['[Content_Types].xml']);
const stylesXml = strFromU8(zip['word/styles.xml']);

ok(docXml.startsWith('<?xml'), '§3 document.xml s’ouvre sur sa déclaration XML');
ok(docXml.includes('<w:body>') && docXml.includes('</w:body>'), '§3 …et son corps existe');
ok(docXml.includes('<w:t xml:space="preserve">Kinetics of the ABC transporter</w:t>'),
  '§3 le titre de l’article est dans le document');
ok(docXml.includes('<w:pStyle w:val="Heading2"/>'), '§3 une section du document devient un titre Word (Heading2)');
ok(docXml.includes('<w:pStyle w:val="Heading1"/>'), '§3 le <h1> devient Heading1');
ok(/<w:r><w:rPr><w:b\/><\/w:rPr><w:t xml:space="preserve">37 °C<\/w:t>/.test(docXml),
  '§3 « 37 °C » part en GRAS');
ok(docXml.includes('<w:vertAlign w:val="superscript"/>'), '§3 les exposants (affiliations) partent en exposant');
ok(!docXml.includes('\u0000') && !docXml.includes('\u0007'), '§3 aucun caractère interdit par XML ne part dans le fichier');

/* Les citations : un SIGNE pour la référence, un RENVOI pour la citation. C'est
   ce qui fait qu'un « [12] » clique encore quand le co-auteur ouvre le Word. */
ok(docXml.includes('<w:bookmarkStart w:id="1" w:name="b_ref12"/>'), '§3 chaque référence du document devient un signet Word');
ok(docXml.includes('<w:bookmarkEnd w:id="1"/>'), '§3 …et son signet se referme');
ok(docXml.includes('<w:hyperlink w:anchor="b_ref12">'), '§3 « [12] » renvoie au signet (pas besoin de réseau)');
const citeLink = docXml.slice(docXml.indexOf('<w:hyperlink w:anchor="b_ref12">'));
const citeInner = citeLink.slice(0, citeLink.indexOf('</w:hyperlink>'));
ok(citeInner.includes('<w:b/>') && citeInner.includes('<w:u w:val="single"/>')
  && citeInner.includes('<w:color w:val="2563EB"/>'),
  '§3 le renvoi reste bleu, gras et souligné (comme la feuille imprimée)');
ok(/<w:hyperlink r:id="rId\d+">/.test(docXml), '§3 un lien externe du texte part en relation Word');
ok(relsXml.includes('Target="https://doi.org/10.1000/xyz" TargetMode="External"'),
  '§3 …avec son adresse, marquée « hors du fichier »');
ok(relsXml.includes('Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"'),
  '§3 le document est TOUJOURS relié à ses styles (la première relation du fichier)');
ok(relsXml.includes('Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"'),
  '§3 l’image a SA relation');
ok(relsXml.includes('Target="media/image1.png"'), '§3 la cible d’une image est relative au dossier word/');
ok(/<a:blip r:embed="rId\d+"\/>/.test(docXml), '§3 la figure appelle bien son image dans le dessin');
ok(docXml.includes('<wp:extent cx="5486400"'), '§3 une image sans taille connue prend la largeur de la colonne (jamais plus)');
ok(docXml.includes('<w:jc w:val="center"/>'), '§3 la figure est centrée, comme dans la feuille imprimée');

/* Tableaux, listes, légendes : ce que le lecteur voit dans l'article. */
ok(docXml.includes('<w:tbl>') && docXml.includes('<w:tblGrid>'), '§3 le tableau devient un vrai tableau Word');
ok(docXml.includes('<w:shd w:val="clear" w:color="auto" w:fill="F1F5F9"/>'), '§3 les en-têtes restent grisés');
ok(/<w:tc>(<w:tcPr>.*?<\/w:tcPr>)<w:p>.*?<w:b\/>.*?Sample/.test(docXml), '§3 …et gras');
ok(docXml.includes('<w:t xml:space="preserve">• </w:t>'), '§3 une puce est ÉCRITE dans le texte (le même repère partout)');
ok(docXml.includes('<w:t xml:space="preserve">1. </w:t>'), '§3 …et une liste numérotée garde ses numéros');
ok(docXml.includes('<w:ind w:left="720"/>'), '§3 une liste imbriquée est en retrait');
ok(docXml.includes('<w:pStyle w:val="Caption"/>'), '§3 la légende d’une figure a son style (petit, italique)');
ok(!docXml.includes('Only the ⭐-starred'), '§3 l’aide « .no-print » de l’application n’est PAS dans le Word');
ok(docXml.includes('<w:sectPr>') && docXml.includes('<w:pgSz w:w="11906" w:h="16838"/>'),
  '§3 la page est réglée (A4) : Word n’invente pas une mise en page');
ok(typesXml.includes('<Default Extension="png" ContentType="image/png"/>'), '§3 le type de l’image est déclaré au paquet');
ok(typesXml.includes('wordprocessingml.document.main+xml'), '§3 le paquet dit bien que c’est un document Word');
ok(stylesXml.includes('w:ascii="Georgia"'), '§3 la police du document (Georgia) part avec le fichier');
['Heading1', 'Heading2', 'Heading3', 'Caption', 'Hyperlink'].forEach((id) =>
  ok(stylesXml.includes(`w:styleId="${id}"`), `§3 le style « ${id} » existe (pas de style manquant)`));
const coreXml = strFromU8(zip['docProps/core.xml']);
ok(coreXml.includes('<dc:title>Kinetics of the ABC transporter</dc:title>'), '§3 les propriétés portent le titre');
ok(coreXml.includes('<dcterms:created xsi:type="dcterms:W3CDTF">2026-09-25T10:00:00.000Z</dcterms:created>'),
  '§3 …et la date donnée (jamais celle de l’horloge)');

/* L'échappement : le texte de l'auteur ne doit pas pouvoir casser le XML. */
const risky = DX.buildDocx({
  blocks: DX.parseDocHtml('<p>a &lt; b &amp; c</p><p>tab\there</p><p>bad\u0000char</p>'),
  title: 'x'
});
const riskyXml = strFromU8(unzipSync(risky.bytes)['word/document.xml']);
ok(riskyXml.includes('<w:t xml:space="preserve">a &lt; b &amp; c</w:t>'),
  '§3 « < » et « & » du texte partent échappés (le fichier reste ouvrable)');
ok(riskyXml.includes('<w:t xml:space="preserve">badchar</w:t>'), '§3 un caractère interdit (\\u0000) est retiré du texte');
assertWellFormedXml(riskyXml, 'word/document.xml (texte risqué)');

/* ── 4. LES PIXELS DES FIGURES ────────────────────────────────────────────── */

/* Un faux Drive : `fetchImpl` est INJECTÉ, donc aucune requête ne part d'ici.
   C'est ce qui permet de mesurer ce qui se passe quand une image répond (200),
   quand elle manque (404) et quand elle est un dessin VECTORIEL. */
const pngBytes = dataUrlToBytes(DATA_PNG);
const fetched = [];
const fakeFetch = async (url) => {
  fetched.push(url);
  if (url === DRIVE_URL) {
    return {
      ok: true, status: 200,
      headers: { get: () => 'image/png' },
      arrayBuffer: async () => pngBytes.slice().buffer
    };
  }
  return { ok: false, status: 404, headers: { get: () => '' }, arrayBuffer: async () => new ArrayBuffer(0) };
};
const fakeMeasure = async () => ({ width: 800, height: 400 });

const imgBlocks = DX.parseDocHtml(
  `<figure><img src="${DATA_PNG}" alt="local"/></figure>`
  + `<figure><img src="${DRIVE_URL}" alt="drive"/></figure>`
  + '<figure><img src="https://example.org/missing.png" alt="gone"/></figure>'
  + `<figure><img src="${SVG_DATA}" alt="vector"/></figure>`
);
const loaded = await DX.loadDocImages(imgBlocks, { fetchImpl: fakeFetch, measure: fakeMeasure, rasterize: null });
eq(loaded.sources.length, 4, '§4 les quatre figures du document sont vues');
eq(fetched, [DRIVE_URL, 'https://example.org/missing.png'], '§4 seules les adresses distantes passent par le réseau');
ok(loaded.images[DATA_PNG] && loaded.images[DATA_PNG].bytes.length === DX_DATA_BYTES,
  '§4 une figure en data:URL ne passe par AUCUN réseau (ses octets viennent du document)');
eq(loaded.images[DATA_PNG].ext, 'png', '§4 …et son format est reconnu');
eq(loaded.images[DRIVE_URL].ext, 'png', '§4 une figure du Drive arrive par fetch, dans son format');
eq(loaded.images[DATA_PNG].width, 800, '§4 la taille réelle de l’image est mesurée (figures jamais déformées)');
eq(loaded.warnings.map((w) => w.src), ['https://example.org/missing.png'],
  '§4 une figure illisible est NOMMÉE (jamais disparue en silence)');
ok(/404/.test(loaded.warnings[0].reason), '§4 …avec la raison (un 404 se dit)');

/* Le Word ne dessine pas un SVG : quand le navigateur sait le convertir (canvas,
   voir browserRasterize), la figure entre en PNG — c'est le cas des courbes
   vectorielles des pages de mesures. */
const svgOnly = DX.parseDocHtml(`<figure><img src="${SVG_DATA}" alt="vector"/></figure>`);
const noRaster = await DX.loadDocImages(svgOnly, { fetchImpl: fakeFetch, measure: fakeMeasure, rasterize: null });
eq(noRaster.images[SVG_DATA].ext, 'svg', '§4 sans moyen de conversion, un SVG entre tel quel (la figure n’est pas perdue)');
const withRaster = await DX.loadDocImages(svgOnly, {
  fetchImpl: fakeFetch,
  rasterize: async () => ({ bytes: pngBytes, ext: 'png', width: 120, height: 60 })
});
eq(withRaster.images[SVG_DATA].ext, 'png', '§4 avec canvas, le SVG devient un PNG que Word lit');
eq(withRaster.images[SVG_DATA].width, 120, '§4 …et la taille du dessin est gardée');
eq(withRaster.warnings, [], '§4 …sans rien laisser de côté');

/* Les petits outils de la même famille. */
eq(DX.docxFileName('Kinetics: a/b? *c*'), 'Kinetics a b c.docx', '§4 le nom du fichier perd les caractères interdits');
eq(DX.docxFileName(''), 'project.docx', '§4 …et ne peut pas être vide');
eq(DX.docxFileName('a'.repeat(200)).length, 85, '§4 …ni démesuré');
ok(DX.docxReport({ embedded: 2 }).includes('2 figures embedded'), '§4 le compte rendu dit ce qui est parti');
ok(DX.docxReport({ embedded: 1, warnings: [{}] }).includes('1 figure embedded'), '§4 …au singulier quand il n’y a qu’une figure');
ok(DX.docxReport({ embedded: 0, missing: ['x'] }).includes('not readable'), '§4 …et ce qui n’a pas suivi');
eq(DX.imageSizeEmu({ width: 4000, height: 800 }).cx, 5486400, '§4 une image trop large est ramenée à la colonne de texte');
eq(DX.imageSizeEmu({ width: 400, height: 200 }).cy, 200 * 9525, '§4 une image normale garde sa taille (1 px = 9525 EMU)');
eq(await DX.exportProjectDocx({ html: '<p class="no-print">rien</p>' }), 
  { ok: false, reason: 'the document is empty', report: '⚠️ Word: the document is empty' },
  '§4 un document vide ne produit pas de fichier (et le dit)');
eq(DX.downloadDocxFile({ bytes: pngBytes, fileName: 'x.docx' }), false,
  '§4 hors navigateur, aucun téléchargement n’est tenté');

/* ── 5. LE BOUTON, DANS LE DOCUMENT FINAL ──────────────────────────────────── */

/* Le JSX ne s'exécute pas hors navigateur : ce qui se vérifie ici, c'est le
   CÂBLAGE — que le bouton existe, qu'il appelle l'écriture du .docx, et surtout
   qu'il part du MÊME corps HTML que l'impression. C'est la seule façon qu'un
   « Word » et un « PDF » du même document ne puissent pas diverger. */
ok(PROJ.includes("import { exportProjectDocx } from '../../utils/docxExport';"),
  '§5 le document importe l’écriture Word (utils/docxExport.js)');
ok(PROJ.includes('const docExportBodyHtml = () => {'),
  '§5 le corps du document vit en UNE fonction (source unique)');

const printFn = PROJ.slice(PROJ.indexOf('const printProjectDoc = () => {'),
  PROJ.indexOf('/* ---- LE DOCUMENT FINAL EN .docx (Word) ---- */'));
ok(printFn.includes('const bodyHtml = docExportBodyHtml();') && !printFn.includes('docEl.innerHTML'),
  '§5 « 🖨️ Print / Save as PDF » part de ce corps (il ne relit plus le DOM lui-même)');

const docxFn = PROJ.slice(PROJ.indexOf('const exportDocx = async () => {'));
ok(docxFn.includes('const html = docExportBodyHtml();'),
  '§5 …et « ⬇️ Word (.docx) » part DU MÊME : le fichier Word est le document relu');
ok(docxFn.includes('await exportProjectDocx({'), '§5 …par la fonction qui écrit le fichier');
ok(docxFn.includes('title: project.paperTitle || project.name'),
  '§5 le nom du fichier suit le titre de l’article (sinon le nom du projet)');
ok(docxFn.includes('dateIso: new Date().toISOString()'), '§5 la date du fichier est celle de l’export');
ok(docxFn.includes('setDocxFeedback(res.report || \'\')'), '§5 le compte rendu de l’écriture est remonté à l’écran');
ok(/catch \(e\) \{[\s\S]*setDocxFeedback\(`⚠️ Word:/.test(docxFn),
  '§5 un échec d’écriture est DIT (pas de bouton qui ne répond pas)');

ok(PROJ.includes('<button onClick={exportDocx} disabled={docxBusy}'),
  '§5 le bouton du document appelle l’export et ne peut pas être cliqué deux fois');
ok(PROJ.includes("{docxBusy ? '⏳ Building the Word file…' : '⬇️ Word (.docx)'}"),
  '§5 …et il montre qu’il travaille');
ok(PROJ.includes('Download this document as a Word file (.docx)'),
  '§5 son infobulle dit ce qu’il produit et avec quoi on l’ouvre');
ok(PROJ.includes('{docxFeedback && ('), '§5 le compte rendu se lit dans le document (bandeau « no-print »)');
ok(PROJ.indexOf("{docxFeedback && (") < PROJ.indexOf('id="project-doc-container"'),
  '§5 …au-dessus du texte, pas dans le document exporté');
ok(PROJ.includes('const [docxBusy, setDocxBusy] = useState(false);'), '§5 l’état « en cours d’écriture » vit dans la page');
ok(PROJ.includes('const [docxFeedback, setDocxFeedback] = useState(\'\');'), '§5 …avec son compte rendu');
ok(PROJ.indexOf('onClick={exportDocx}') > PROJ.indexOf('onClick={printProjectDoc}'),
  '§5 le bouton Word est posé JUSTE APRÈS « 🖨️ Print / Save as PDF » (les deux exports se suivent)');

console.log(`_docx_export_test.mjs — ${passed} assertions OK (le document final en .docx)`);





