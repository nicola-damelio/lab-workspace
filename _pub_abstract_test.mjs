/* =========================================================================
   _pub_abstract_test.mjs — L'ABSTRACT DU PAPIER : LE CHAMP, LE BLOC, LE STYLE.

   La demande, mot pour mot : « in the project page after the affiliations there must
   be the section of the “abstract” which should also be linked in the publication
   format (style, position in the text, etc). »

   Ce qui est vérifié ici, sur les modules RÉELS :

     1. LE BLOC — `abstract` est un bloc du document titré (« Abstract »), placé
        APRÈS les affiliations dans l'ordre du programme, et un format d'AVANT cette
        version (un ordre enregistré qui ne le nomme pas) le reçoit À SA PLACE — pas
        au bout du document (voir normalizePubDocOrder) ;
     2. LE VOCABULAIRE — « abstract » (et « summary ») désignent ce bloc : un
        document DÉJÀ écrit qui porte un `<h2>Abstract</h2>` suit donc l'ordre du
        panneau et les intitulés choisis ; les journaux, qui nomment tous
        « abstract » en premier, le laissent juste après les affiliations ;
     3. LE STYLE ET LES COLONNES — une PARTIE « Abstract » (police, taille,
        alignement, gras/italique…), sa feuille (`pubLayoutCss`), et la ligne vide de
        la tête qui l'encadre (voir DOC_HEAD_CLASSES) ;
     4. LA PAGE DU PROJET — le champ se saisit APRÈS les affiliations, et le document
        imprime le bloc entre les affiliations et la ligne d'information, sous
        l'intitulé réglé au panneau ; un projet sans résumé n'imprime RIEN ;
     5. LE FICHIER WORD — le résumé y est mis en forme comme sa partie, et
        « Full width » y ouvre SA section d'une colonne (comme pour une figure).

   Run: node _pub_abstract_test.mjs
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);
const {
  DOC_SECTION_ATTR, PUB_DOC_BLOCKS, PUB_DOC_BLOCK_IDS, PUB_DOC_HEAD_IDS, PUB_DOC_SPAN_IDS,
  PUB_LAYOUT_PARTS, PUB_LAYOUT_PART_IDS, PUB_COLUMN_MENU_SPANS,
  buildPubDocOrder, buildPubDocTitles, docBlockOfWord, normalizePubDocOrder, pubDocOrderKeywords,
  pubDocOrderMoved, pubDocTitleKeywords, pubDocTitleOf, pubLayoutCss, pubSpanIn, pubSpanOf,
} = await import('./src/components/pubCitation.js');
const {
  DOC_HEAD_CLASSES, DOC_HEAD_IDS, DOC_EMPTY_LINE_ID, JOURNAL_FORMATS, applyJournalFormat,
  docHeadRows, reorderDocHtml,
} = await import('./src/components/journalFormats.js');
const { PROJECT_TEXT_SECTIONS } = await import('./src/utils/manuscriptImport.js');
const { htmlToDocxBody } = await import('./src/utils/docxExport.js');

const PANEL = readFileSync('./src/components/Publications.jsx', 'utf8').replace(/\r\n/g, '\n');
const PAGE = readFileSync('./src/components/AppModules/projectDetailModule.jsx', 'utf8').replace(/\r\n/g, '\n');

let passed = 0;
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const eq = (actual, expected, what) => {
  assert.deepEqual(actual, expected, `${what}\n  attendu : ${JSON.stringify(expected)}\n  obtenu  : ${JSON.stringify(actual)}`);
  passed += 1;
};
const has = (hay, needle, what) => ok(String(hay).includes(needle), `${what}\n  introuvable : ${needle}`);


/* ══ 1. LE BLOC DU DOCUMENT ══════════════════════════════════════════════════ */
const block = PUB_DOC_BLOCKS.find((b) => b.id === 'abstract');
ok(block, 'l’abstract est un bloc nommé du document');
eq([block.label, block.titled, block.title], ['Abstract', true, 'Abstract'],
  'le programme écrit son intitulé (« Abstract »), que la rangée du panneau peut remplacer');
eq(!!block.section, false,
  'il n’imprime AUCUNE section de texte du projet : c’est la tête du papier, pas un RichTextEditor');
eq(PUB_DOC_BLOCK_IDS.indexOf('abstract'), PUB_DOC_BLOCK_IDS.indexOf('affiliations') + 1,
  'il naît JUSTE APRÈS les affiliations (« after the affiliations there must be the section of the abstract »)');
eq(PUB_DOC_SPAN_IDS.includes('abstract'), true, 'il a son mot sur les colonnes (voir sa PARTIE)');
eq(PUB_DOC_HEAD_IDS.includes('abstract'), false,
  'il n’est pas une ligne de tête du panneau : il a un intitulé, sa rangée et son champ');
eq(PROJECT_TEXT_SECTIONS.some((s) => s.id === 'abstract'), false,
  '…et ce n’est pas une section de texte du projet (rien à ajouter à PROJECT_TEXT_SECTIONS)');
eq(buildPubDocTitles().abstract, 'Abstract', 'un format neuf porte son intitulé');

/* UN ORDRE ENREGISTRÉ AVANT L'ABSTRACT LE REÇOIT À SA PLACE — jamais après les
   références : c'est la tête du papier. */
const ANCIENT = ['title', 'authors', 'affiliations', 'meta', 'background', 'discussion',
  'conclusions', 'funding', 'supporting', 'methods', 'experiments', 'references'];
eq(normalizePubDocOrder(ANCIENT),
  ['title', 'authors', 'affiliations', 'abstract', 'meta', 'background', 'discussion',
    'conclusions', 'funding', 'supporting', 'methods', 'experiments', 'references'],
  'un ordre complet d’avant cette version (aucun abstract) le récupère entre les affiliations et la ligne d’information');
ok(normalizePubDocOrder(ANCIENT).indexOf('abstract') < normalizePubDocOrder(ANCIENT).indexOf('references'),
  '…donc jamais au bout du document, derrière la bibliographie');
eq(pubDocOrderMoved(buildPubDocOrder(), 'abstract', 1).indexOf('abstract'),
  buildPubDocOrder().indexOf('abstract') + 1,
  'il se déplace comme les autres blocs (la rangée du panneau, glisser-déposer)');

/* ══ 2. LE VOCABULAIRE : « abstract » DÉSIGNE CE BLOC ════════════════════════ */
eq(docBlockOfWord('abstract'), 'abstract', '« abstract » désigne la rangée du résumé');
eq(docBlockOfWord('summary'), 'abstract', '…« summary » aussi (un manuscrit l’écrit ainsi)');
eq(docBlockOfWord('Abstract'), 'abstract', '…quelle que soit la casse du document');
const SECTIONS = PROJECT_TEXT_SECTIONS.map((s) => s.label);
ok(pubDocOrderKeywords(buildPubDocOrder(), SECTIONS).indexOf('abstract')
  < pubDocOrderKeywords(buildPubDocOrder(), SECTIONS).indexOf('scientific background'),
  'dans le vocabulaire, ses mots viennent APRÈS les affiliations et AVANT le contexte (l’ordre du panneau)');
{
  /* LE JOURNAL : tous ceux de la liste commencent par « abstract ». Le bloc ne bouge
     donc pas de la tête, et « introduction » ne passe pas devant lui. */
  const jacs = applyJournalFormat({ preset: 'acs' }, 'jacs');
  eq(jacs.docOrder.indexOf('abstract'), buildPubDocOrder().indexOf('abstract'),
    'appliquer un journal laisse le résumé après les affiliations');
  ok(jacs.docOrder.indexOf('abstract') < jacs.docOrder.indexOf('background'),
    '…et devant le contexte, comme toutes les revues de la liste l’impriment');
  eq(jacs.docTitles.abstract, 'Abstract', '…sans renommer son intitulé (le mot du journal est celui du programme)');
  ok(Object.keys(JOURNAL_FORMATS).every((id) => JOURNAL_FORMATS[id].layout.abstract),
    'chaque journal de la liste règle aussi le caractère de l’abstract');
}
/* UN DOCUMENT DÉJÀ ÉCRIT : le `<h2>Abstract</h2>` est reconnu, laissé à sa place quand
   l'ordre le veut, et renommé quand l'utilisateur choisit un autre nom. */
{
  const H2 = (t) => `<h2 class="pf-heading">${t}</h2>`;
  const doc = [
    '<h1 class="pf-title">Titre</h1>', '<p class="pf-authors">Rossi M</p>',
    '<p class="pf-affiliations">1 Napoli</p>',
    H2('Abstract'), '<p>We report…</p>',
    H2('Scientific background'), '<p>bg</p>',
  ].join('');
  eq(reorderDocHtml(doc, pubDocOrderKeywords(buildPubDocOrder(), SECTIONS)), doc,
    'dans l’ordre du programme, le bloc du résumé ne bouge pas d’un caractère');
  const renamed = reorderDocHtml(doc, [], pubDocTitleKeywords({ docTitles: { abstract: 'Summary' } }));
  ok(renamed.includes('>Summary</h2>') && renamed.includes('<p>We report…</p>'),
    'un intitulé choisi au panneau s’écrit sur le résumé d’un document figé, son texte intact');
  eq(pubDocTitleOf({ abstract: 'Summary' }, 'abstract'), 'Summary',
    '…et c’est bien cet intitulé-là que le document doit écrire');
}

/* ══ 3. SA PARTIE : LE STYLE, LES COLONNES, LA LIGNE VIDE ════════════════════ */
const part = PUB_LAYOUT_PARTS.find((p) => p.id === 'abstract');
ok(part, 'l’abstract a SA partie dans « Formatting of every part »');
eq([part.label, part.span], ['Abstract', true], '…intitulée « Abstract », avec son mot sur les colonnes');
eq(part.selectors, ['.pf-abstract'], '…et sa classe, celle que la page du projet écrit');
eq(PUB_LAYOUT_PART_IDS.indexOf('abstract'), PUB_LAYOUT_PART_IDS.indexOf('affiliations') + 1,
  'sa ligne du panneau se lit après les affiliations, comme sa rangée');
{
  const css = pubLayoutCss({ layout: { abstract: { font: 'Georgia, serif', size: 11, align: 'justify', italic: true } } });
  ok(css.includes('#project-doc-container .pf-abstract { '), 'la feuille met le résumé en forme par sa classe');
  ok(css.includes('font-family: Georgia, serif !important;') && css.includes('font-size: 11pt !important;')
    && css.includes('text-align: justify !important;') && css.includes('font-style: italic !important;'),
    '…avec sa police, sa taille, son alignement et son italique');
  ok(pubLayoutCss({ layout: { page: { columns: 2 }, abstract: { span: 'all' } } })
    .includes('#project-doc-container .pf-abstract { column-span: all !important;'),
    '« Full width » fait barrer toute la page au résumé d’un seul tenant (le saut de section)');
  eq(pubSpanIn({ page: { columns: 2 } }, 'abstract'), 'flow',
    'sans rien de réglé, il coule dans les colonnes de la page (comme le texte des sections)');
  eq(pubSpanOf({ layout: { page: { columns: 2 }, abstract: { span: 'all' } } }, 'abstract'), 'all',
    '…et le menu des colonnes montre la valeur qui s’applique');
  eq(PUB_COLUMN_MENU_SPANS.map((s) => s.id), ['flow', 'all'],
    'le menu de sa ligne n’offre que les deux valeurs qui existent');
  const body = PUB_LAYOUT_PARTS.find((p) => p.id === 'body');
  ok(body.selectors.some((s) => s.includes(':not(.pf-abstract)')),
    'le TEXTE des sections ne met jamais en forme les paragraphes du résumé (il a sa propre partie)');
}
eq(DOC_HEAD_IDS, ['title', 'authors', 'affiliations', 'abstract', 'meta'],
  'l’abstract est une ligne de tête du document : la ligne vide de la tête l’encadre');
eq(DOC_HEAD_CLASSES, ['pf-title', 'pf-authors', 'pf-affiliations', 'pf-abstract', 'pf-meta'],
  '…et sa classe fait partie de celles que la ligne vide reconnaît');
eq(docHeadRows(buildPubDocOrder()).slice(0, 9),
  ['title', DOC_EMPTY_LINE_ID, 'authors', DOC_EMPTY_LINE_ID, 'affiliations', DOC_EMPTY_LINE_ID,
    'abstract', DOC_EMPTY_LINE_ID, 'meta'],
  'la tête imprimée se lit : titre · auteurs · affiliations · abstract · ligne d’information');
has(PANEL, 'Document sections (order & titles)', 'la rangée de l’abstract se lit dans cette rubrique du panneau');
has(PANEL, 'onChange={(e) => pubSetDocTitle(id, e.target.value)}', '…où son intitulé se règle comme celui des autres blocs');

/* ══ 4. LA PAGE DU PROJET ════════════════════════════════════════════════════ */
{
  const card = PAGE.slice(PAGE.indexOf('<SectionCard title="🧾 Title, authors & affiliations"'));
  const field = card.indexOf('updateProject({ paperAbstract:');
  ok(field > 0, 'la fiche « Title, authors & affiliations » a un champ pour le résumé');
  has(card, 'onChange={(e) => updateProject({ paperAbstract: e.target.value })}',
    '…écrit dans le projet (project.paperAbstract)');
  has(card, 'readOnly={!canModify}', '…et il suit les droits de l’écrivain comme les autres champs');
  ok(card.indexOf('project.paperAffiliations') < field,
    'il se saisit APRÈS les affiliations (« in the project page after the affiliations »)');
  ok(card.indexOf('>Affiliations</span>') < card.indexOf('>Abstract</span>'),
    '…et son étiquette le dit');
  ok(card.indexOf('project.paperAbstract') > 0 && card.indexOf('project.paperAbstract') < card.indexOf('project.paperAffiliations'),
    '…et la fiche le montre « filled » dès qu’il y en a un (sa pastille de tête)');
}
{
  /* LE DOCUMENT : le bloc n'est rendu que REMPLI, à la place que le format lui donne. */
  has(PAGE, "const abstractText = String(project.paperAbstract || '').trim();",
    'le document lit le résumé du projet');
  has(PAGE, 'if (abstractText) blocks.abstract = (',
    '…et n’imprime le bloc QUE s’il y a quelque chose à lire (un projet sans résumé ne change pas)');
  has(PAGE, "{...{ [DOC_SECTION_ATTR]: 'abstract' }}",
    'le bloc porte l’identifiant de sa section (la feuille et le .docx le retrouvent)');
  has(PAGE, 'className="pf-abstract mb-6"',
    '…et sa classe, sur son CADRE (le résumé barre la page d’un seul tenant)');
  has(PAGE, 'className="pf-abstract text-sm text-slate-800 text-justify leading-relaxed mb-2"',
    '…et sur chacun de ses paragraphes (le texte des sections ne les met pas en forme deux fois)');
  has(PAGE, "{docHeading('abstract') ? (", 'son intitulé est celui du panneau (ou aucun, si le format le cache)');
  ok(PAGE.indexOf('blocks.abstract = (') > PAGE.indexOf('blocks.affiliations = ('),
    'le bloc est déclaré APRÈS les affiliations, comme dans l’ordre du programme');
  ok(PAGE.indexOf('blocks.abstract = (') < PAGE.indexOf('blocks.meta = ('),
    '…et avant la ligne d’information du projet');
}

/* ══ 5. LE FICHIER WORD ══════════════════════════════════════════════════════ */
const DOC_HTML = [
  '<h1 class="pf-title">Title</h1>',
  '<p class="pf-authors">Rossi M</p>',
  '<p class="pf-affiliations">1 Napoli</p>',
  '<div class="pf-abstract mb-6" data-doc-section="abstract">',
  '<h2 class="pf-heading">Abstract</h2>',
  '<p class="pf-abstract">We report a new virus.</p>',
  '<p class="pf-abstract">Its vector is an aphid.</p>',
  '</div>',
  '<p class="pf-meta">Project: Aphid</p>',
  '<div data-doc-section="background"><h2 class="pf-heading">Introduction</h2>',
  '<p class="pf-body">The context.</p></div>',
].join('');
{
  const { xml } = htmlToDocxBody(DOC_HTML, {
    format: { layout: { page: { columns: 2 }, abstract: { size: 11, align: 'justify' } } }
  });
  ok(xml.includes('We report a new virus.') && xml.includes('Its vector is an aphid.'),
    'le texte du résumé part dans le .docx, paragraphe par paragraphe');
  eq([...(xml.matchAll(/<w:cols w:num="1"\/>/g))].length, 1,
    '« In the columns » : le résumé n’ouvre PAS de section — la seule qui existe est celle des lignes de tête (elles barrent la page)');
  ok(xml.indexOf('Rossi M') < xml.indexOf('<w:cols w:num="1"/>')
    && xml.indexOf('<w:cols w:num="1"/>') < xml.indexOf('We report a new virus.'),
    '…elle se ferme avec la DERNIÈRE ligne de tête (les affiliations), et le résumé s’écrit donc derrière elle, dans les colonnes de la page');
  const styled = /<w:p>(?:(?!<\/w:p>)[\s\S])*We report a new virus\.[\s\S]*?<\/w:p>/.exec(xml);
  ok(styled && styled[0].includes('<w:jc w:val="both"/>') && styled[0].includes('w:sz w:val="22"'),
    '…et il est mis en forme comme SA partie (justifié, 11 pt), pas comme le texte des sections');
  ok(xml.indexOf('1 Napoli') < xml.indexOf('We report a new virus.')
    && xml.indexOf('We report a new virus.') < xml.indexOf('Project: Aphid'),
    '…à sa place : après les affiliations, avant la ligne d’information');
  ok(xml.indexOf('Abstract</w:t>') > 0, '…sous son intitulé');
}
{
  const { xml } = htmlToDocxBody(DOC_HTML, {
    format: { layout: { page: { columns: 2 }, abstract: { span: 'all' } } }
  });
  eq([...(xml.matchAll(/<w:cols w:num="1"\/>/g))].length, 1,
    '« Full width » : le résumé BARRE la page — la section d’une colonne, cette fois, l’englobe (voir plus bas)');
  ok(xml.indexOf('We report a new virus.') < xml.indexOf('<w:cols w:num="1"/>')
    && xml.indexOf('<w:cols w:num="1"/>') < xml.indexOf('Its vector is an aphid.'),
    '…la section d’une colonne ne se ferme qu’avec le DERNIER paragraphe du résumé : c’est donc lui qui barre la page, comme dans le document exporté');
  ok(xml.slice(xml.indexOf('<w:cols w:num="1"/>')).includes('The context.'),
    '…et le texte des sections reprend les colonnes de la page derrière lui');
}
{
  /* LE RÉSUMÉ D'UN DOCUMENT FIGÉ (sans les classes de paragraphe) : il est reconnu par
     sa PARTIE (`pf-abstract`), donc mis en forme lui aussi. */
  const { xml } = htmlToDocxBody('<div class="pf-abstract"><p>Old abstract.</p></div>',
    { format: { layout: { abstract: { align: 'justify' } } } });
  ok(xml.includes('Old abstract.') && xml.includes('<w:jc w:val="both"/>'),
    'une ligne dont l’abstract vient d’un document enregistré est mise en forme par la même partie');
}

console.log(`_pub_abstract_test.mjs — ${passed} assertions OK (l’abstract : champ, bloc, style, position et .docx)`);
