/* =========================================================================
   _pub_doc_head_lines_test.mjs — LA TÊTE DU DOCUMENT SE LIT SUR DES LIGNES SÉPARÉES.

   La demande, mot pour mot : « In the final document the list of authors must be
   separated by the title with one empty line. an empty line must also separate the
   authors from the affiliations. »

   Le titre, les auteurs et les affiliations sont les trois blocs de tête du panneau
   « Publication format » (`docOrder` → voir _pub_doc_head_order_test.mjs) et le
   document les écrit avec une classe que le programme pose lui-même (`pf-title`,
   `pf-authors`, `pf-affiliations`). Une LIGNE VIDE les sépare maintenant : un
   PARAGRAPHE À PART (`pf-empty-line`), pas une marge — l'écran, la feuille imprimée,
   le PDF et le .docx la portent tous, et elle survit à un changement de taille des
   textes comme à un déplacement des blocs.

   Ce qui est mesuré ici, sur le code livré :
     §1 LES RANGÉES (`docHeadRows`, exécuté) : la page du projet ;
     §2 LE HTML (`docHeadSpacedHtml`, exécuté) : document figé, impression, .docx ;
     §3 LE FICHIER WORD, EXÉCUTÉ : la ligne vide y est un vrai paragraphe vide ;
     §4 LE CÂBLAGE : la page du projet, le panneau, leurs ré-exports.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

// Les sources de src/ s'importent sans extension (résolues par Vite) — même crochet
// que _pub_doc_head_order_test.mjs / _pub_docx_export_test.mjs.
register('./_esm_test_hook.mjs', import.meta.url);
const {
  DOC_HEAD_IDS, DOC_HEAD_CLASSES, DOC_EMPTY_LINE_ID, DOC_EMPTY_LINE_CLASS, DOC_EMPTY_LINE_HTML,
  docHeadRows, docHeadSpacedHtml, reorderDocHtml
} = await import('./src/components/journalFormats.js');
const {
  buildPubDocOrder, pubDocOrderKeywords, pubLayoutCss, PUB_LAYOUT_PARTS
} = await import('./src/components/pubCitation.js');
const { htmlToDocxBody } = await import('./src/utils/docxExport.js');
const { PROJECT_TEXT_SECTIONS } = await import('./src/utils/manuscriptImport.js');

let passed = 0;
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const eq = (a, b, what) => {
  assert.deepEqual(a, b, `${what}\n  attendu : ${JSON.stringify(b)}\n  obtenu  : ${JSON.stringify(a)}`);
  passed += 1;
};
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const PROJ = read('./src/components/AppModules/projectDetailModule.jsx');
const PANEL = read('./src/components/Publications.jsx');
const has = (hay, needle, what) => ok(String(hay).includes(needle), `${what}\n  introuvable : ${needle}`);
const count = (hay, needle) => String(hay).split(needle).length - 1;

/* LE DOCUMENT D'ESSAI : les trois blocs de tête, la ligne d'information, une section —
   le balisage exact que la page du projet écrit (classes comprises). */
const TITLE = '<h1 class="pf-title text-2xl font-black text-slate-900 mb-1">Mortalin-p53 interaction in cancer cells</h1>';
const AUTHORS = '<p class="pf-authors text-sm font-semibold text-slate-800 mb-1">Rossi M<sup>1,2</sup>, Bianchi A<sup>3</sup></p>';
const AFFIL = '<p class="pf-affiliations text-[11px] text-slate-500 italic whitespace-pre-line mb-2">1 Dipartimento di Agraria, Portici · 3 INRAE, Villenave</p>';
const META = '<p class="pf-meta text-xs text-slate-500 mb-6">Project: Aphid · Scientist: Rossi M</p>';
const SECTION = '<h2 class="pf-heading text-base font-black">Results and Discussion</h2><p class="pf-body">The peptides were tested.</p>';
const BLANK = DOC_EMPTY_LINE_HTML;

/* ══ 1. LES RANGÉES DE LA PAGE DU PROJET, EXÉCUTÉES ═══════════════════════════ */
eq(DOC_HEAD_IDS, ['title', 'authors', 'affiliations', 'meta'],
  'les quatre blocs de tête sont ceux du panneau (voir PUB_DOC_BLOCKS) — la ligne d’information en fait partie depuis « there must be an empty line after the affiliations »');
eq(DOC_HEAD_CLASSES, ['pf-title', 'pf-authors', 'pf-affiliations', 'pf-meta'],
  '…et ce sont les classes que le document leur écrit (voir reorderDocHtml)');
eq(DOC_EMPTY_LINE_HTML, `<div class="${DOC_EMPTY_LINE_CLASS}" aria-hidden="true">&nbsp;</div>`,
  'la ligne vide a UN seul balisage, celui que la page écrit et que le HTML exporté reçoit');
ok(DOC_EMPTY_LINE_HTML.includes('&nbsp;') && !DOC_EMPTY_LINE_HTML.includes('no-print'),
  '…un vrai caractère (donc une vraie ligne à l’écran) qui part à l’IMPRESSION (jamais un « no-print »)');

const PROGRAM = buildPubDocOrder();
eq(docHeadRows(PROGRAM),
  ['title', DOC_EMPTY_LINE_ID, 'authors', DOC_EMPTY_LINE_ID, 'affiliations', DOC_EMPTY_LINE_ID,
    'meta', 'background', 'discussion', 'conclusions', 'funding', 'supporting', 'methods', 'experiments', 'references'],
  'la tête du document se lit : titre · ligne vide · auteurs · ligne vide · affiliations · ligne vide · ligne d’information (« in the formatted paper there must be an empty line after the affiliations »)');
eq(docHeadRows(['authors', 'title', 'affiliations', 'meta']),
  ['authors', DOC_EMPTY_LINE_ID, 'title', DOC_EMPTY_LINE_ID, 'affiliations', DOC_EMPTY_LINE_ID, 'meta'],
  '…et « mettre l’auteur avant le titre » (l’exemple de la demande d’origine) garde les lignes vides ENTRE les blocs');
eq(docHeadRows(['title', 'conclusions', 'affiliations', 'meta']),
  ['title', 'conclusions', 'affiliations', DOC_EMPTY_LINE_ID, 'meta'],
  'deux blocs de tête séparés par un AUTRE bloc (une section) n’en reçoivent pas : il y a déjà de la place');
eq(docHeadRows(PROGRAM, (id) => id !== 'authors'),
  ['title', DOC_EMPTY_LINE_ID, 'affiliations', DOC_EMPTY_LINE_ID, 'meta', 'background', 'discussion',
    'conclusions', 'funding', 'supporting', 'methods', 'experiments', 'references'],
  'un projet SANS auteurs garde la ligne vide entre le titre et les affiliations (le bloc absent ne compte pas)');
eq(docHeadRows(['title']), ['title'], 'une tête d’un seul bloc ne reçoit aucune ligne vide');
eq(docHeadRows(undefined), [], 'un ordre absent ne rend rien (jamais une erreur)');

/* ══ 2. LA MÊME RÈGLE SUR LE HTML (document figé · impression · .docx) ═══════ */
const doc = [TITLE, AUTHORS, AFFIL, META, SECTION].join('');
eq(docHeadSpacedHtml(doc),
  [TITLE, BLANK, AUTHORS, BLANK, AFFIL, BLANK, META, SECTION].join(''),
  'le document écrit une ligne vide entre le titre et les auteurs, entre les auteurs et les affiliations, ET après les affiliations — et RIEN d’autre (ni avant la section)');
eq(count(docHeadSpacedHtml(doc), DOC_EMPTY_LINE_CLASS), 3, '…trois lignes vides : une seule par paire de blocs de tête');

const spaced = docHeadSpacedHtml(doc);
eq(docHeadSpacedHtml(spaced), spaced, 'la règle est IDEMPOTENTE : repasser dessus ne double aucune ligne');
eq(count(docHeadSpacedHtml(docHeadSpacedHtml(doc)), DOC_EMPTY_LINE_CLASS), 3,
  '…même après le passage de la page, du figé et de l’export l’un après l’autre');

/* LA TÊTE DÉPLACÉE À LA MAIN : `reorderDocHtml` déplace des blocs ENTIERS et la ligne
   vide voyage avec celui qui la précède — la même règle la remet donc entre les bons
   blocs, sans doublon ni ligne orpheline. */
const authorsFirst = ['authors', 'title', 'affiliations', 'meta', 'methods', 'experiments', 'references'];
const words = pubDocOrderKeywords(authorsFirst, PROJECT_TEXT_SECTIONS.map((s) => s.label));
const moved = docHeadSpacedHtml(reorderDocHtml(spaced, words));
eq(moved, docHeadSpacedHtml([AUTHORS, TITLE, AFFIL, META, SECTION].join('')),
  'un document ENREGISTRÉ relu « auteurs avant le titre » se relit avec ses lignes vides aux bonnes places');
eq(count(moved, DOC_EMPTY_LINE_CLASS), 3,
  '…toujours trois lignes vides, aucune laissée derrière la tête');
ok(moved.indexOf(AUTHORS) < moved.indexOf(BLANK) && moved.indexOf(BLANK) < moved.indexOf(TITLE),
  '…la première des deux est bien ENTRE les auteurs et le titre');

/* LE REPLI EST EXACT : un document qui n’a pas les classes de la tête (écrit à la main,
   ou enregistré avant que le programme les écrive) sort identique, au caractère près. */
const plain = '<h1>Titre</h1><p>Rossi M</p><p>1 Napoli</p><h2>Results</h2><p>text</p>';
eq(docHeadSpacedHtml(plain), plain, 'un document sans les classes de la tête n’est pas touché');
eq(docHeadSpacedHtml(''), '', 'un document vide reste vide');
{
  const written = docHeadSpacedHtml(doc).replace(new RegExp(`<p class="${DOC_EMPTY_LINE_CLASS}">[\\s\\S]*?</p>`, 'g'), BLANK);
  eq(docHeadSpacedHtml(written), docHeadSpacedHtml(doc),
    'une ligne vide écrite autrement (un <p> au lieu d’une <div>) est reconnue, retirée et réécrite — une seule fois');
}
ok(!docHeadSpacedHtml([TITLE, AUTHORS, SECTION].join(''))
  .includes(`${DOC_EMPTY_LINE_CLASS}" aria-hidden="true">&nbsp;</div><h2`),
  'aucune ligne vide ne se glisse entre la tête et la première section');
ok(PUB_LAYOUT_PARTS.every((p) => (p.selectors || []).every((s) => !/^div\b/.test(s))),
  'aucune partie du « Publication format » ne vise l’élément de la ligne vide (une div)');
{
  const css = pubLayoutCss({ layout: { body: { size: 28 }, title: { size: 30 } } }, '#project-doc-container');
  ok(css && !css.includes(DOC_EMPTY_LINE_CLASS),
    '…donc la hauteur de la ligne vide ne dépend pas de la taille choisie pour le texte des sections');
}


/* ══ 3. LE FICHIER WORD : LA LIGNE VIDE Y EST UN VRAI PARAGRAPHE VIDE ════════ */
const GAP_PARA = '<w:p><w:r><w:t xml:space="preserve"> </w:t></w:r></w:p>';
{
  const { xml } = htmlToDocxBody(docHeadSpacedHtml(doc));
  const gaps = [];
  let at = xml.indexOf(GAP_PARA);
  while (at >= 0) { gaps.push(at); at = xml.indexOf(GAP_PARA, at + 1); }
  eq(gaps.length, 3, 'le .docx reçoit trois paragraphes vides (un entre chaque paire de blocs de tête)');
  ok(gaps[0] > xml.indexOf('Heading1') && gaps[0] < xml.indexOf('Rossi M'),
    '…le premier tombe ENTRE le titre (Heading1) et la liste des auteurs');
  ok(xml.indexOf('Bianchi A') < gaps[1] && gaps[1] < xml.indexOf('1 Dipartimento'),
    '…le second entre les auteurs et les affiliations');
  ok(xml.indexOf('1 Dipartimento') < gaps[2] && gaps[2] < xml.indexOf('Project:'),
    '…et le troisième APRÈS les affiliations (« there must be an empty line after the affiliations »)');
  ok(!htmlToDocxBody(plain).xml.includes(GAP_PARA),
    'un document sans les classes de la tête n’invente aucune ligne vide dans Word');
}

/* ══ 4. LE CÂBLAGE : LA PAGE DU PROJET ET LE PANNEAU ═════════════════════════ */
has(PROJ, 'docHeadRows, docHeadSpacedHtml, DOC_EMPTY_LINE_ID, DOC_EMPTY_LINE_CLASS,',
  'la page du projet importe la règle (par ../Publications, comme le reste du format)');
has(PROJ, 'return docHeadRows(docOrder, (id) => !!blocks[id]).map((id, i) => (',
  '…et elle rend les rangées de la tête, dans l’ordre choisi');
has(PROJ, 'id === DOC_EMPTY_LINE_ID',
  '…la ligne vide étant une rangée à part');
has(PROJ, 'className={DOC_EMPTY_LINE_CLASS}',
  '…écrite avec la classe du vocabulaire (celle que le HTML exporté récrit)');
{
  const inBody = PROJ.indexOf('const projectDocBodyHtml = () => {');
  const reorderAt = PROJ.indexOf('bodyHtml = reorderDocHtml(bodyHtml, docOrderWords(pubFormat), pubDocTitleKeywords(pubFormat));');
  const spaceAt = PROJ.indexOf('bodyHtml = docHeadSpacedHtml(bodyHtml);');
  ok(inBody !== -1 && reorderAt > inBody && spaceAt > reorderAt,
    'la fabrication du corps EXPORTÉ met les lignes vides APRÈS avoir rangé les blocs (un seul endroit : impression, PDF et .docx)');
  ok(spaceAt > 0 && spaceAt < PROJ.indexOf('const printProjectDoc = () => {'),
    '…avant l’impression et l’export, qui n’en savent rien');
}
eq(count(PROJ, 'docHeadSpacedHtml('), 3,
  'le document FIGÉ, la version proposée (suggestion) et le corps exporté portent tous la règle');
has(PROJ, '__html: docHeadSpacedHtml(reorderDocHtml(',
  '…et un document enregistré AVANT cette règle reçoit ses lignes vides à l’affichage aussi');

has(PANEL, '  DOC_HEAD_IDS, DOC_HEAD_CLASSES, DOC_EMPTY_LINE_ID, DOC_EMPTY_LINE_CLASS, DOC_EMPTY_LINE_HTML,',
  'le panneau ré-exporte les constantes de la règle (la page du projet n’importe que lui)');
has(PANEL, '  docHeadRows, docHeadSpacedHtml',
  '…et les deux fonctions');
{
  const preview = PANEL.indexOf('id="pub-layout-preview"');
  const after = PANEL.slice(preview, preview + 2600);
  eq(count(after, 'className={DOC_EMPTY_LINE_CLASS}'), 3,
    'l’aperçu « Live preview — project document » montre la tête du document FINAL : titre · ligne vide · auteurs · ligne vide · affiliations · ligne vide · ligne d’information');
}

console.log(`_pub_doc_head_lines_test.mjs : ${passed} passed`);

