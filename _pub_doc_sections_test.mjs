/* =========================================================================
   _pub_doc_sections_test.mjs — L'ORDRE ET LES INTITULÉS DES SECTIONS DU DOCUMENT.

   La demande, mot pour mot : « In the publication format I cannot change the order of
   the sections nor change the titles of the subsections. I want to be able for example
   to put the author before the title or change the name of “materials and methods”
   into “experimental section” or whatever. »

   Trois mesures, sur le code livré :
     §1 les FONCTIONS RÉELLES de src/components/pubCitation.js (PUB_DOC_BLOCKS ·
        `docOrder` · `docTitles`), exécutées ;
     §2 `reorderDocHtml` AVEC DES INTITULÉS CHOISIS, exécuté sur un vrai document ;
     §3 le CÂBLAGE : le panneau « Publication format » (Publications.jsx) et le
        document du projet (projectDetailModule.jsx) suivent vraiment cet ordre.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

// Les sources de src/ s'importent sans extension (résolues par Vite) — même
// crochet que _journal_formats_test.mjs.
register('./_esm_test_hook.mjs', import.meta.url);
const {
  PUB_DOC_BLOCKS, PUB_DOC_BLOCK_IDS, PUB_DOC_TITLED_IDS, PUB_DOC_FIXED_IDS,
  buildPubDocOrder, buildPubDocTitles, buildPubFormat, normalizePubDocOrder,
  normalizePubDocTitles, normalizePubFormat, pubDocOrderMoved, pubDocTitleKeywords,
  pubDocTitleOf
} = await import('./src/components/pubCitation.js');
const {
  JOURNAL_FORMATS, applyJournalFormat, clearJournalFormat, reorderDocHtml
} = await import('./src/components/journalFormats.js');

let passed = 0;
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const eq = (a, b, what) => {
  assert.deepEqual(a, b, `${what}\n  attendu : ${JSON.stringify(b)}\n  obtenu  : ${JSON.stringify(a)}`);
  passed += 1;
};

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const PANEL = read('./src/components/Publications.jsx');
const PROJ = read('./src/components/AppModules/projectDetailModule.jsx');
const has = (hay, needle, what) => ok(String(hay).includes(needle), `${what}\n  introuvable : ${needle}`);

/* ══ 1. LES BLOCS DU DOCUMENT, EXÉCUTÉS ═══════════════════════════════════════ */
eq(PUB_DOC_BLOCKS.length, 8, 'le document a huit blocs nommés');
eq(PUB_DOC_BLOCK_IDS, ['title', 'authors', 'affiliations', 'meta', 'sections', 'methods', 'experiments', 'references'],
  'les blocs du document, dans l’ordre où la page du projet les imprime');
eq(PUB_DOC_TITLED_IDS, ['methods', 'experiments', 'references'],
  'trois blocs seulement portent un intitulé que le PROGRAMME écrit');
eq(PUB_DOC_FIXED_IDS, ['references'],
  'la liste VIVANTE des références est imprimée en dernier (son intitulé, lui, se règle)');
eq(buildPubDocOrder(), PUB_DOC_BLOCK_IDS, 'l’ordre du programme est celui de la page du projet');
eq(buildPubDocTitles(), { methods: 'Materials and Methods', experiments: 'Experiments', references: 'References' },
  'les intitulés du programme, tels qu’ils s’impriment aujourd’hui');

// 1a. Un ordre relu : rien ne disparaît, rien d’inconnu ne passe.
eq(normalizePubDocOrder(undefined), PUB_DOC_BLOCK_IDS, 'un format sans ordre prend celui du programme');
eq(normalizePubDocOrder(['authors', 'title']),
  ['authors', 'title', 'affiliations', 'meta', 'sections', 'methods', 'experiments', 'references'],
  'un ordre PARTIEL est complété par les blocs oubliés (aucune section ne peut disparaître)');
eq(normalizePubDocOrder(['title', 'title', 'nulle-part']), PUB_DOC_BLOCK_IDS,
  'les doublons et les blocs inconnus sont écartés');
eq(normalizePubDocOrder('title'), PUB_DOC_BLOCK_IDS, 'un ordre qui n’est pas une liste est ignoré');

// 1b. ▲▼ — le premier exemple de la demande : les AUTEURS avant le TITRE.
const swapped = pubDocOrderMoved(PUB_DOC_BLOCK_IDS, 'authors', -1);
eq(swapped, ['authors', 'title', 'affiliations', 'meta', 'sections', 'methods', 'experiments', 'references'],
  '▲▼ met les auteurs AVANT le titre (« put the author before the title »)');
eq(pubDocOrderMoved(swapped, 'references', -1), swapped, '…la liste des références, elle, ne se déplace pas');
eq(pubDocOrderMoved(PUB_DOC_BLOCK_IDS, 'title', -1), PUB_DOC_BLOCK_IDS, 'un cran hors de la liste ne fait rien');
eq(pubDocOrderMoved(PUB_DOC_BLOCK_IDS, 'references', -1), PUB_DOC_BLOCK_IDS, '…comme un ▲ sur le premier bloc');

// 1c. Les intitulés — le second exemple : « Materials and Methods » → « Experimental section ».
eq(normalizePubDocTitles(undefined), buildPubDocTitles(), 'sans choix, les intitulés du programme');
eq(pubDocTitleOf(buildPubDocTitles(), 'methods'), 'Materials and Methods',
  'tant qu’on n’y touche pas, le document écrit l’intitulé du programme');
eq(pubDocTitleOf({ methods: 'Experimental section' }, 'methods'), 'Experimental section',
  '…et le titre choisi dès qu’il y en a un (« change the name of “materials and methods” »)');
eq(pubDocTitleOf({ methods: '   ' }, 'methods'), 'Materials and Methods', 'un titre d’espaces rend l’intitulé du programme');
eq(pubDocTitleOf({ methods: '<b>X</b>' }, 'methods'), 'bX/b', 'un titre ne peut pas apporter de HTML (les chevrons tombent)');
eq(pubDocTitleOf({ title: 'Mon titre' }, 'title'), '', 'un bloc sans intitulé n’en rend aucun (le titre EST le titre)');
eq(normalizePubDocTitles({ methods: 'x'.repeat(200) }).methods.length, 120, 'un intitulé démesuré est coupé à 120 caractères');
eq(normalizePubDocTitles({ experiments: 'Experimental part', nulle: 'x' }).nulle, undefined,
  'seuls les blocs connus sont relus');
eq(normalizePubDocTitles({ methods: '  Experimental  section ' }).methods, 'Experimental section',
  'les espaces d’un titre enregistré sont nettoyés');

// 1d. Les intitulés choisis, prêts pour un document DÉJÀ écrit (reorderDocHtml).
eq(pubDocTitleKeywords(buildPubFormat('nature')), {},
  'aucun intitulé choisi : rien à réécrire dans un texte déjà écrit');
const rewritten = pubDocTitleKeywords({ docTitles: { methods: 'Experimental section' } });
eq(rewritten['materials and methods'], 'Experimental section', 'un titre choisi suit le mot « materials and methods »');
eq(rewritten.methods, 'Experimental section', '…et son synonyme « methods » (tel que Nature le nomme)');
eq(rewritten.references, undefined, '…et ne touche pas aux autres blocs');
eq(pubDocTitleKeywords({ docTitles: { references: 'Bibliography' } }).references, 'Bibliography',
  'renommer les références se propage aussi');

// 1e. Le format les PORTE, et le changement de journal ne les emporte pas.
const fresh = buildPubFormat('nature');
eq(fresh.docOrder, PUB_DOC_BLOCK_IDS, 'un format neuf porte l’ordre du programme');
eq(fresh.docTitles, buildPubDocTitles(), '…et ses intitulés');
const ancient = normalizePubFormat({ preset: 'acs' });
eq(ancient.docOrder, PUB_DOC_BLOCK_IDS, 'un format enregistré AVANT cette version ne perd pas une section');
eq(ancient.docTitles, buildPubDocTitles(), '…ni un intitulé');
const mine = { ...buildPubFormat('nature'), docOrder: swapped, docTitles: { methods: 'Experimental section' } };
eq(applyJournalFormat(mine, 'jacs').docOrder, swapped, 'appliquer un journal ne touche pas l’ordre du DOCUMENT');
eq(applyJournalFormat(mine, 'jacs').docTitles.methods, 'Experimental section', '…ni ses intitulés');
eq(applyJournalFormat(mine, 'jacs').journal, 'jacs', '…alors que le journal, lui, change bien');
eq(clearJournalFormat(mine, {}).docOrder, swapped,
  '« ↺ As in the app » détache le journal sans toucher à l’ordre du document');
eq(clearJournalFormat(mine, {}).docTitles.methods, 'Experimental section', '…ni à ses intitulés');

/* ══ 2. UN TITRE CHOISI SUR UN DOCUMENT DÉJÀ ÉCRIT ═══════════════════════════ */
const H2 = (t) => `<h2 class="pf-heading">${t}</h2>`;
const doc = [
  '<h1 class="pf-title">Titre</h1>', '<p class="pf-authors">Rossi M</p>',
  H2('Introduction'), '<p>intro</p>',
  H2('Materials and Methods'), '<p>methods</p>',
  H2('Results and Discussion'), '<p>results</p>',
  H2('References (12)'), '<ol class="pf-bib"><li>ref</li></ol>'
].join('');
eq(reorderDocHtml(doc, [], {}), doc, 'sans ordre ni intitulé, l’HTML sort intact');

const renamedDoc = reorderDocHtml(doc, [], { 'materials and methods': 'Experimental section' });
ok(renamedDoc.includes('<h2 class="pf-heading">Experimental section</h2>'),
  'l’intitulé choisi est écrit dans le document (classe du panneau comprise)');
ok(!renamedDoc.includes('Materials and Methods'), '…et l’ancien intitulé a disparu');
ok(renamedDoc.includes('<p>methods</p>'), '…le texte de la section n’est pas touché');
ok(renamedDoc.startsWith('<h1 class="pf-title">Titre</h1><p class="pf-authors">Rossi M</p>'),
  '…ni la tête du document (titre, auteurs)');
eq(renamedDoc.length, doc.length - ('Materials and Methods'.length - 'Experimental section'.length),
  '…seul l’intitulé change, et rien d’autre');
ok(!reorderDocHtml(doc, [], { 'materials and methods': '<img src=x onerror=alert(1)>' }).includes('<img'),
  'un intitulé ne peut pas apporter une balise au document');

const angew = reorderDocHtml(doc, JOURNAL_FORMATS.angewandte.order, { 'materials and methods': 'Experimental section' });
ok(angew.includes('Experimental section'), 'le titre choisi part avec le bloc que le journal déplace');
ok(angew.indexOf('Results and Discussion') < angew.indexOf('Experimental section'),
  '…vers sa place chez Angewandte (après les résultats)');
ok(angew.indexOf('Introduction') < angew.indexOf('Results and Discussion'), '…et l’ordre du journal tient');
eq(angew.split('<h2').length - 1, 4, 'aucun bloc n’est perdu');
eq(reorderDocHtml(doc, JOURNAL_FORMATS.jacs.order).includes('Materials and Methods'), true,
  'sans titre choisi, l’intitulé du document reste celui de l’auteur');

/* ══ 3. LE CÂBLAGE : LE PANNEAU ET LE DOCUMENT ═══════════════════════════════ */
has(PANEL, 'PUB_DOC_BLOCKS', 'le panneau « Publication format » nomme les blocs du document');
has(PANEL, 'Document sections (order & titles)', '…et leur consacre une rubrique');
has(PANEL, 'onClick={() => pubMoveDocBlock(id, -1)}', '…avec les ▲▼ qui déplacent un bloc');
has(PANEL, 'onChange={(e) => pubSetDocTitle(id, e.target.value)}', '…un champ par bloc qui porte un intitulé');
has(PANEL, 'onClick={pubResetDocSections}', '…et un ↺ qui rend l’ordre et les intitulés du programme');
has(PANEL, 'disabled={block.fixed}', '…les blocs FIXES (la liste des références) ne se déplacent pas');
has(PANEL, 'const docOrder = normalizePubDocOrder(activeFormat.docOrder);', 'le panneau lit l’ordre du format');
has(PANEL, 'docTitles: normalizePubDocTitles(fmt && fmt.docTitles)', '…et ses intitulés, dans une seule liste de réglages');
has(PANEL, '...(fmt && fmt.journal ? { journal: fmt.journal } : {}),',
  '…qui garde aussi le journal choisi (changer un champ ne peut plus le décrocher)');
has(PANEL, 'const pubCustomFormat = (fields) => ({\n    ...pubDocSettings(activeFormat),',
  '…et que tout réglage de citation recopie');
has(PANEL, '...pubDocSettings(activeFormat),', '…y compris au changement de preset de citation');
has(PANEL, 'docOrder: normalizePubDocOrder(activeFormat.docOrder),\n      docTitles: normalizePubDocTitles(activeFormat.docTitles)',
  '…et que le journal qui arrive NE remet PAS la structure du document à celle du programme');
has(PANEL, 'const pubResetDocSections = () => pubPatchFormat({ docOrder: buildPubDocOrder(), docTitles: buildPubDocTitles() });',
  'le ↺ réécrit l’ordre ET les intitulés du programme');

has(PROJ, 'const docOrder = normalizePubDocOrder(pubFormat && pubFormat.docOrder);', 'le document du projet lit l’ordre du format');
has(PROJ, 'const docTitles = normalizePubDocTitles(pubFormat && pubFormat.docTitles);', '…et ses intitulés');
has(PROJ, 'const docHeading = (id) => pubDocTitleOf(docTitles, id);', '…et sait écrire l’intitulé d’un bloc');
has(PROJ, 'return docOrder.map((id) => blocks[id] || null);', '…en rendant les blocs DANS CET ORDRE');
has(PROJ, 'blocks.title = (', 'le titre est un bloc déplaçable');
has(PROJ, 'if (project.paperAuthors) blocks.authors = (', '…les auteurs un autre (« put the author before the title »)');
has(PROJ, 'if (project.paperAffiliations) blocks.affiliations = (', '…les affiliations aussi');
has(PROJ, 'blocks.meta = (', '…la ligne du projet aussi');
has(PROJ, 'blocks.sections = sectionBlocks.map((s) => (', '…les sections de texte de l’auteur aussi');
has(PROJ, 'if (includedExps.length > 0) blocks.methods = (', '…« Materials and Methods » aussi');
has(PROJ, "{docHeading('methods')}</h2>", '…avec l’intitulé choisi (« Experimental section »)');
has(PROJ, "{docHeading('experiments')} ({includedExps.length})</h2>", '…« Experiments (n) » garde son compte sous le titre choisi');
has(PROJ, "{docHeading('references')} ({refs.length})</h2>", '…et « References (n) » son intitulé réglable');
has(PROJ, 'reorderDocHtml(bodyHtml, journalSectionOrder(pubFormat), pubDocTitleKeywords(pubFormat))',
  'l’export écrit aussi les titres choisis sur un texte DÉJÀ enregistré');

console.log(`_pub_doc_sections_test.mjs — ${passed} assertions OK (ordre & intitulés des sections du document)`);
