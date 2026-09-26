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
  PUB_DOC_BLOCKS, PUB_DOC_BLOCK_IDS, PUB_DOC_TITLED_IDS, PUB_DOC_FIXED_IDS, PUB_DOC_SECTION_BLOCKS,
  buildPubDocOrder, buildPubDocTitles, buildPubFormat, normalizePubDocOrder,
  normalizePubDocTitles, normalizePubFormat, pubDocOrderDropped, pubDocOrderMoved, pubDocTitleKeywords,
  pubDocOrderKeywords, pubDocTitleOf
} = await import('./src/components/pubCitation.js');
const {
  JOURNAL_FORMATS, applyJournalFormat, clearJournalFormat, reorderDocHtml
} = await import('./src/components/journalFormats.js');
// Le document FIGÉ est affiché sans sa propre bibliographie : la coupe est mesurée en §5.
const { withoutBibliographySection } = await import('./src/utils/referenceLinks.js');

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
eq(PUB_DOC_BLOCKS.length, 12, 'le document a douze blocs nommés');
eq(PUB_DOC_BLOCK_IDS, ['title', 'authors', 'affiliations', 'meta',
  'background', 'discussion', 'conclusions', 'funding', 'supporting', 'methods', 'experiments', 'references'],
'les blocs du document, dans l’ordre où la page du projet les imprime (le contexte et les résultats ont leur rangée comme « Materials and Methods » — le bloc générique « Text sections » a disparu)');
eq(PUB_DOC_TITLED_IDS, ['background', 'discussion', 'conclusions', 'funding', 'supporting', 'methods', 'experiments', 'references'],
'huit blocs portent un intitulé que le PROGRAMME écrit, donc huit champs dans le panneau');
eq(PUB_DOC_FIXED_IDS, ['references'],
'la liste VIVANTE des références est imprimée en dernier (son intitulé, lui, se règle)');
eq(buildPubDocOrder(), PUB_DOC_BLOCK_IDS, 'l’ordre du programme est celui de la page du projet');
eq(buildPubDocTitles(), {
  background: 'Scientific background', discussion: 'Results and Discussion',
  conclusions: 'Conclusions', funding: 'Funding', supporting: 'Supporting information',
  methods: 'Materials and Methods', experiments: 'Experiments', references: 'References'
},
'les intitulés du programme, tels qu’ils s’impriment aujourd’hui');

// 1a. Un ordre relu : rien ne disparaît, rien d’inconnu ne passe.
eq(normalizePubDocOrder(undefined), PUB_DOC_BLOCK_IDS, 'un format sans ordre prend celui du programme');
eq(normalizePubDocOrder(['authors', 'title']),
  ['authors', 'title', 'affiliations', 'meta', 'background', 'discussion', 'conclusions', 'funding', 'supporting', 'methods', 'experiments', 'references'],
  'un ordre PARTIEL est complété par les blocs oubliés (aucune section ne peut disparaître)');
eq(normalizePubDocOrder(['title', 'authors', 'affiliations', 'meta', 'sections', 'experiments', 'methods', 'references']),
  ['title', 'authors', 'affiliations', 'meta', 'background', 'discussion', 'experiments', 'methods', 'references', 'conclusions', 'funding', 'supporting'],
  'un ordre enregistré AVANT cette version nomme encore le bloc générique « sections » : ses deux sections prennent SA place (elles ne partent pas à la fin du document)');
eq(normalizePubDocOrder(['title', 'title', 'nulle-part']), PUB_DOC_BLOCK_IDS,
  'les doublons et les blocs inconnus sont écartés');
eq(normalizePubDocOrder('title'), PUB_DOC_BLOCK_IDS, 'un ordre qui n’est pas une liste est ignoré');

// 1b. ▲▼ — le premier exemple de la demande : les AUTEURS avant le TITRE.
const swapped = pubDocOrderMoved(PUB_DOC_BLOCK_IDS, 'authors', -1);
eq(swapped, ['authors', 'title', 'affiliations', 'meta', 'background', 'discussion', 'conclusions', 'funding', 'supporting', 'methods', 'experiments', 'references'],
  '▲▼ met les auteurs AVANT le titre (« put the author before the title »)');
eq(pubDocOrderMoved(swapped, 'references', -1), swapped, '…la liste des références, elle, ne se déplace pas');
eq(pubDocOrderMoved(PUB_DOC_BLOCK_IDS, 'title', -1), PUB_DOC_BLOCK_IDS, 'un cran hors de la liste ne fait rien');
eq(pubDocOrderMoved(PUB_DOC_BLOCK_IDS, 'references', -1), PUB_DOC_BLOCK_IDS, '…comme un ▲ sur le premier bloc');
eq(pubDocOrderMoved(PUB_DOC_BLOCK_IDS, 'funding', -1).indexOf('funding'), PUB_DOC_BLOCK_IDS.indexOf('funding') - 1,
  '…et une section de FIN se déplace comme les autres (le financement passe devant les conclusions)');

/* 1b-bis. LE GLISSER-DÉPOSER — la demande : « these elements must be movable by
   drag and drop rather than arrows ». Le bloc pris PREND LA PLACE du bloc visé. */
eq(pubDocOrderDropped(PUB_DOC_BLOCK_IDS, 'authors', 'title'),
  ['authors', 'title', 'affiliations', 'meta', 'background', 'discussion', 'conclusions', 'funding', 'supporting', 'methods', 'experiments', 'references'],
  'lâcher « Authors » sur « Title » le met à sa place (« put the author before the title »)');
eq(pubDocOrderDropped(PUB_DOC_BLOCK_IDS, 'methods', 'title'),
  ['methods', 'title', 'authors', 'affiliations', 'meta', 'background', 'discussion', 'conclusions', 'funding', 'supporting', 'experiments', 'references'],
  'lâcher un bloc VERS LE HAUT le fait remonter (les autres descendent)');
eq(pubDocOrderDropped(PUB_DOC_BLOCK_IDS, 'title', 'methods'),
  ['authors', 'affiliations', 'meta', 'background', 'discussion', 'conclusions', 'funding', 'supporting', 'methods', 'title', 'experiments', 'references'],
  'lâcher un bloc VERS LE BAS l’envoie à la place visée (les autres remontent)');
eq(pubDocOrderDropped(PUB_DOC_BLOCK_IDS, 'conclusions', 'discussion'),
  ['title', 'authors', 'affiliations', 'meta', 'background', 'conclusions', 'discussion', 'funding', 'supporting', 'methods', 'experiments', 'references'],
  '…et une section de FIN se prend et se vise comme les autres');
eq(pubDocOrderDropped(PUB_DOC_BLOCK_IDS, 'title', 'title'), PUB_DOC_BLOCK_IDS,
  'un geste sur soi-même ne change rien');
eq(pubDocOrderDropped(PUB_DOC_BLOCK_IDS, 'references', 'title'), PUB_DOC_BLOCK_IDS,
  'la liste VIVANTE des références ne se prend pas (elle reste la dernière)');
eq(pubDocOrderDropped(PUB_DOC_BLOCK_IDS, 'title', 'references'), PUB_DOC_BLOCK_IDS,
  '…et on ne peut pas la viser : rien ne passe derrière elle');
eq(pubDocOrderDropped(PUB_DOC_BLOCK_IDS, 'nulle-part', 'title'), PUB_DOC_BLOCK_IDS,
  'un bloc inconnu ne casse rien');
eq(pubDocOrderDropped(swapped, 'title', 'authors'),
  ['title', 'authors', 'affiliations', 'meta', 'background', 'discussion', 'conclusions', 'funding', 'supporting', 'methods', 'experiments', 'references'],
  'le même geste remet le titre en tête sur un ordre déjà déplacé');


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
/* ⚠ DEPUIS QUE LE JOURNAL ÉCRIT L'ORDRE DES SECTIONS (sa demande — « including the
   order of the sections »), appliquer un journal REMPLACE `docOrder` : c'est ainsi
   qu'Angewandte met l'Experimental Section APRÈS la Conclusion. La mesure complète est
   dans _pub_style_presets_test.mjs. Ce qui NE change pas : un intitulé que l'utilisateur
   a choisi lui-même est respecté. */
const mine = { ...buildPubFormat('nature'), docOrder: swapped, docTitles: { ...buildPubDocTitles(), methods: 'Experimental section' } };
const applied = applyJournalFormat(mine, 'jacs');
eq(applied.journal, 'jacs', 'appliquer un journal change bien le journal');
eq(applied.docOrder.slice(0, 4), mine.docOrder.slice(0, 4),
'…la tête du document reste celle que l’utilisateur avait réglée (un ordre de journal ne concerne pas le titre et les auteurs)');
eq(applied.docOrder.length === PUB_DOC_BLOCK_IDS.length && applied.docOrder[applied.docOrder.length - 1] === 'references',
  true, '…et toutes les sections sont là, la bibliographie en dernier');
eq(applied.docTitles.methods, 'Experimental section', '…et l’intitulé choisi par l’utilisateur est RESPECTÉ');
eq(clearJournalFormat(mine, {}).docOrder, PUB_DOC_BLOCK_IDS,
  '« ↺ As in the app » remet l’ordre du programme (le journal l’avait écrit)');
eq(clearJournalFormat(mine, {}).docTitles, buildPubDocTitles(), '…et ses intitulés');

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

/* ── LES DEUX RANGÉES DEMANDÉES — ET LEURS NOMS, ÉDITABLES ────────────────────
   « the “Document sections (order & titles)” section should contain “scientific
   background” and “Results and discussion”. As “Material and method” I must be able to
   edit their names. » */
eq(PUB_DOC_SECTION_BLOCKS.map((b) => b.id), ['background', 'discussion', 'conclusions', 'funding', 'supporting'],
  'les cinq sections de texte du projet ont leur rangée — le contexte et les résultats compris');
eq(pubDocTitleOf({}, 'background'), 'Scientific background',
  'la rangée du contexte écrit d’abord l’intitulé de la section (rien ne change tant qu’on n’y touche pas)');
eq(pubDocTitleOf({}, 'discussion'), 'Results and Discussion', '…et celle des résultats, le sien');
{
  const renamedSections = reorderDocHtml(
    [H2('Scientific background'), '<p>bg</p>', H2('Results and Discussion'), '<p>results</p>'].join(''),
    [],
    pubDocTitleKeywords({ docTitles: { background: 'Introduction', discussion: 'Findings' } }));
  ok(renamedSections.includes(`${H2('Introduction')}<p>bg</p>`)
    && renamedSections.includes(`${H2('Findings')}<p>results</p>`),
  'chacune se renomme comme « Materials and Methods » (« I must be able to edit their names »), son texte intact');
}
/* ── UN INTITULÉ QUE LE FORMAT NE VEUT PAS ────────────────────────────────────
   « if in the style of science references have no title then the title tick must be
   unchecked in the “References (citation & bibliography)” section. » La demande est
   portée par `docNoTitle`, et le document écrit alors le bloc SANS son `<h2>`. */
{
  const noHeading = reorderDocHtml(
    `${H2('References (2)')}<ol class="pf-bib"><li>ref 1</li><li>ref 2</li></ol>`,
    [],
    pubDocTitleKeywords({ docNoTitle: ['references'] }));
  ok(!noHeading.includes('<h2'), 'un bloc dont le format cache l’intitulé sort SANS son `<h2>` (Science ne titre pas sa bibliographie)');
  ok(noHeading.includes('<ol class="pf-bib"><li>ref 1</li><li>ref 2</li></ol>'),
    '…et sa liste reste entière, à la même place');
  eq(pubDocTitleKeywords({ docNoTitle: ['references'] }).references, '',
    '…parce que le mot « references » du vocabulaire porte le titre VIDE');
  eq(pubDocTitleKeywords({ docTitles: { references: 'Bibliography' } }).references, 'Bibliography',
    '…alors qu’un titre choisi, lui, s’écrit (« Bibliography »)');
}

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
has(PANEL, 'onChange={(e) => pubSetDocTitle(id, e.target.value)}', '…un champ par bloc qui porte un intitulé');
has(PANEL, 'onClick={pubResetDocSections}', '…et un ↺ qui rend l’ordre et les intitulés du programme');
has(PANEL, 'draggable={!block.fixed}', '…chaque rangée se prend à la souris');
has(PANEL, 'onDrop={(e) => { e.preventDefault(); e.stopPropagation(); pubDropDocBlock(id); }}',
  '…et se lâche sur une autre (« movable by drag and drop rather than arrows »)');
eq(PANEL.includes('pubMoveDocBlock'), false, '…plus une seule flèche ▲▼ dans le panneau');
has(PANEL, 'Document layout & sections (project document)',
  '…la mise en forme et les sections du document dans UNE carte (« must be fused with »)');
has(PANEL, 'const pubDropDocBlock = (targetId) => {', 'le geste a sa fonction');
has(PANEL, 'pubDocOrderDropped(docOrder, pubDocDragId, targetId)',
  '…qui donne à la rangée prise la place de la rangée visée (pubDocOrderDropped)');
has(PANEL, 'const docOrder = normalizePubDocOrder(activeFormat.docOrder);', 'le panneau lit l’ordre du format');
has(PANEL, 'docTitles: normalizePubDocTitles(fmt && fmt.docTitles)', '…et ses intitulés, dans une seule liste de réglages');
has(PANEL, '...(fmt && fmt.journal ? { journal: fmt.journal } : {}),',
  '…qui garde aussi le journal choisi (changer un champ ne peut plus le décrocher)');
has(PANEL, 'const pubCustomFormat = (fields) => ({\n    ...pubDocSettings(activeFormat),',
  '…et que tout réglage de citation recopie');
has(PANEL, '...pubDocSettings(activeFormat),', '…y compris au changement de preset de citation');
has(PANEL, 'docOrder: normalizePubDocOrder(activeFormat.docOrder),\n      docTitles: normalizePubDocTitles(activeFormat.docTitles)',
  '…et que le journal qui arrive NE remet PAS la structure du document à celle du programme');
has(PANEL, 'const pubResetDocSections = () => pubPatchFormat({',
  'le ↺ réécrit l’ordre ET les intitulés du programme');
has(PANEL, 'docOrder: buildPubDocOrder(),', '…l’ordre et les intitulés (voir la rangée, plus haut)');
/* …ET LES INTITULÉS QU'UN STYLE CACHE : le ↺ les rend aussi — « the references
   section always lacks the reference title in the final document even if in
   principle I can edit its name in the publication format section » (voir
   pubSetDocTitle, qui rallume l'intitulé dès qu'un nom est écrit dans la rangée). */
has(PANEL, 'docNoTitle: buildPubDocNoTitle(),', '…les intitulés qu’un style n’écrit pas');
has(PANEL, 'docNoBlock: buildPubDocNoBlock()', '…et la ligne d’information du projet, éteinte comme un format neuf la porte');

has(PROJ, 'const docOrder = normalizePubDocOrder(pubFormat && pubFormat.docOrder);', 'le document du projet lit l’ordre du format');
has(PROJ, 'const docTitles = normalizePubDocTitles(pubFormat && pubFormat.docTitles);', '…et ses intitulés');
has(PROJ, "const docHeading = (id) => (pubDocTitleHidden(pubFormat, id) ? '' : pubDocTitleOf(docTitles, id));",
  '…et sait écrire l’intitulé d’un bloc — ou n’en écrire AUCUN quand le format le cache (voir _journal_formats_test.mjs)');
has(PROJ, 'return docHeadRows(docOrder, (id) => !!blocks[id]).map((id, i) => (',
  '…en rendant les blocs DANS CET ORDRE — avec la LIGNE VIDE entre le titre, les auteurs et les affiliations (voir _pub_doc_head_lines_test.mjs)');
has(PROJ, 'blocks.title = (', 'le titre est un bloc déplaçable');
has(PROJ, 'if (project.paperAuthors) blocks.authors = (', '…les auteurs un autre (« put the author before the title »)');
has(PROJ, 'if (project.paperAffiliations) blocks.affiliations = (', '…les affiliations aussi');
has(PROJ, 'blocks.meta = (', '…la ligne du projet aussi');
ok(!PROJ.includes('blocks.sections = sectionBlocks'),
  '…le bloc générique « Text sections » n’existe plus : chaque section de texte du projet a SA rangée');
has(PROJ, 'blocks[block.id] = renderSectionBlock(s, docHeading(block.id));',
  '…et les conclusions, le financement et les informations supplémentaires à LEUR rangée, sous l’intitulé choisi');
has(PROJ, 'const ownRowBlocks = sectionBlocksOf.filter((s) => !!pubDocBlockOfSection(s.id));',
  '…en prenant toutes les sections de texte du projet (elles ont maintenant toutes leur rangée)');
has(PROJ, 'if (includedExps.length > 0 || mmTextSaved) blocks.methods = (', '…« Materials and Methods » aussi');
has(PROJ, "{docHeading('methods')}</h2>", '…avec l’intitulé choisi (« Experimental section »)');
has(PROJ, "{docHeading('experiments')} ({includedExps.length})</h2>", '…« Experiments (n) » garde son compte sous le titre choisi');
has(PROJ, "{docHeading('references')}</h2>",
  '…et « References » son intitulé réglable — SANS compteur : le rapport de cette session dit « the references should behave like the other sections and not have a tick display reference title (the number of references in parentheses is not professional) »');
has(PROJ, 'reorderDocHtml(bodyHtml, docOrderWords(pubFormat), pubDocTitleKeywords(pubFormat))',
  'l’export écrit aussi les titres choisis sur un texte DÉJÀ enregistré');
has(PROJ, 'const docOrderWords = (fmt) => {',
  '…et l’ordre du PANNEAU passe avant celui du journal (voir docOrderWords, une seule fois)');
has(PROJ, 'fmt && fmt.docOrder,',
  '…en lisant `docOrder` du format, comme le document vivant');
has(PROJ, '__html: docHeadSpacedHtml(reorderDocHtml(',
  'un document ENREGISTRÉ est réordonné lui aussi (la page du projet, pas seulement l’export), avec ses lignes vides de tête');
has(PROJ, 'const OPTIONAL_TEXT_SECTION_IDS = [\'funding\', \'supporting\'];',
  'les sections de texte du projet viennent de la liste PARTAGÉE (utils/manuscriptImport.js) : un seul vocabulaire pour la page, l’import d’un manuscrit et le document');

/* ══ 4. L'ORDRE DU PANNEAU SUR UN DOCUMENT DÉJÀ ENREGISTRÉ ═══════════════════
   Le rapport, mot pour mot : « In the publication format even if I change the
   order of the sections they do not affect the document in the project. » Un
   document ENREGISTRÉ (« 💾 Save changes ») est un instantané : la page
   l'affichait tel quel, donc les ▲▼ du panneau ne changeaient RIEN. Les mots de
   l'ordre choisi se traduisent maintenant en intitulés de `<h2>` ET, pour les
   quatre blocs de tête, en CLASSES (`pf-title`, `pf-authors`, `pf-affiliations`,
   `pf-meta` — voir _pub_doc_head_order_test.mjs, qui mesure la tête à fond) :
   `reorderDocHtml` s'applique à l'instantané AUSSI, et il déplace les HUIT blocs
   que le panneau propose. Exécuté ici sur un vrai document figé. */
const PROJECT_SECTIONS = ['Scientific background', 'Results and Discussion', 'Conclusions', 'Funding', 'Supporting information'];
const frozen = [
  '<h1 class="pf-title">Titre</h1>', '<p class="pf-authors">Rossi M</p>',
  H2('Scientific background'), '<p>bg</p>',
  H2('Conclusions'), '<p>c</p>',
  H2('Materials and Methods'), '<p>methods</p>',
  H2('Experiments (2)'), '<p>exps</p>'
].join('');
eq(pubDocOrderKeywords(buildPubDocOrder(), PROJECT_SECTIONS),
  ['pf-title', 'pf-authors', 'pf-affiliations', 'pf-meta',
    'scientific background', 'introduction', 'background',
    'results and discussion', 'results', 'discussion',
    'conclusions', 'conclusion', 'concluding remarks', 'perspectives',
    'funding', 'funding statement', 'acknowledgements', 'acknowledgments', 'financial support',
    'supporting information', 'supplementary information', 'supporting material', 'supplementary material', 'supplementary data',
    'materials and methods', 'methods', 'experimental section', 'experimental part', 'experimental procedures', 'experiments',
    'references', 'bibliography'],
  'l’ordre du programme se traduit dans les mots que le document écrit — les quatre blocs de tête par leur CLASSE, chaque section de texte par les mots de SA rangée (et leurs synonymes : « introduction » est le contexte, comme un journal l’écrit)');
eq(pubDocOrderKeywords(buildPubDocOrder(), PROJECT_SECTIONS), pubDocOrderKeywords(PUB_DOC_BLOCK_IDS, PROJECT_SECTIONS),
  '…et un ordre absent (format ancien) donne le même vocabulaire');
eq(reorderDocHtml(frozen, pubDocOrderKeywords(buildPubDocOrder(), PROJECT_SECTIONS)), frozen,
  'un document figé déjà dans cet ordre ne bouge pas d’un caractère');
const swappedOrder = ['title', 'authors', 'affiliations', 'meta', 'sections', 'experiments', 'methods', 'references'];
const frozenSwapped = reorderDocHtml(frozen, pubDocOrderKeywords(swappedOrder, PROJECT_SECTIONS));
ok(frozenSwapped.indexOf('Experiments (2)') < frozenSwapped.indexOf('Materials and Methods'),
  'les ▲▼ du panneau déplacent vraiment le bloc « Experiments » d’un document ENREGISTRÉ');
eq(frozenSwapped.length, frozen.length, '…sans rien couper ni dupliquer');
const frozenAuthorsFirst = reorderDocHtml(frozen,
  pubDocOrderKeywords(['authors', 'title', 'affiliations', 'meta', 'sections', 'methods', 'experiments', 'references'], PROJECT_SECTIONS));
ok(frozenAuthorsFirst.indexOf('Rossi M') < frozenAuthorsFirst.indexOf('Titre'),
  '…et « mettre l’auteur avant le titre » (l’exemple de la demande) atteint le document ENREGISTRÉ');
eq(frozenAuthorsFirst.length, frozen.length, '…sans rien couper ni dupliquer');
ok(frozenAuthorsFirst.startsWith('<p class="pf-authors">Rossi M</p><h1 class="pf-title">Titre</h1>'),
  '…la tête se réordonne par les classes que le programme écrit (voir _pub_doc_head_order_test.mjs)');
const frozenRenamed = reorderDocHtml(frozen, pubDocOrderKeywords(swappedOrder, PROJECT_SECTIONS),
  pubDocTitleKeywords({ docTitles: { methods: 'Experimental section', experiments: 'Biological assays' } }));
ok(frozenRenamed.includes('Experimental section') && frozenRenamed.includes('Biological assays'),
  '…et les intitulés choisis s’écrivent sur le texte figé');
ok(!reorderDocHtml(frozen, pubDocOrderKeywords(swappedOrder, ['Mes propres titres'])).includes('<script'),
  'un vocabulaire sans section connue ne casse rien');

/* ══ 5. LE MATÉRIEL ET MÉTHODES NE DISPARAÎT PAS DU DOCUMENT FINAL ═════════════
   Le rapport, mot pour mot : « matherial and method section does ntappear in the
   final document ». La page du projet n'ÉCRIVAIT la section que si un test était coché
   « Include » — alors que le TEXTE DU PROJET (« 📋 Materials and Methods », écrit à la
   main, ou déposé par un manuscrit importé, que l'import annonce comme imprimé par le
   document) la remplit à lui seul. Le document n'avait alors plus rien à figer, donc
   rien à imprimer. Deux mesures : le CÂBLAGE (§5a) et ce que le document FINAL fait
   d'une section qui est là (§5b, §5c, exécuté). */

// 5a. Le texte du projet compte comme les tests cochés — et « 🔄 Update from tests »
//     ne peut plus l'effacer quand il n'y a rien à lire.
has(PROJ, "const mmTextSaved = String((project.materialsAndMethods || {}).text || '').trim();",
  'la section « Materials and Methods » sait lire le TEXTE DU PROJET');
has(PROJ, 'if (includedExps.length > 0 || mmTextSaved) blocks.methods = (',
  '…et s’écrit dès que les tests cochés OU ce texte ont quelque chose à dire (aucun test coché ne peut plus la faire disparaître)');
has(PROJ, "{project.materialsAndMethods?.text ? (",
  '…le corps de la section imprime le texte enregistré avant toute génération');
has(PROJ, "if (!parts.length && String((project.materialsAndMethods || {}).text || '').trim()) {",
  '« 🔄 Update from tests » sans aucun test à lire ne touche pas au texte écrit (il l’écrasait)');
has(PROJ, "'⚠ No test to read — the Materials & Methods text is unchanged'",
  '…et la page le dit au lieu de le perdre');
has(PROJ, "if (project.materialsAndMethods?.edited) return;",
  'le texte écrit à la main n’est jamais réécrit par le rafraîchissement automatique du document');

// 5b. Exécuté : une section PRÉSENTE traverse le réordonnancement entière.
const mmFrozen = [
  '<h1 class="pf-title">Titre</h1>', '<p class="pf-authors">Rossi M</p>',
  H2('Scientific background'), '<p>bg</p>',
  H2('Materials and Methods'), '<p>Le tampon était 20 mM Tris.</p>',
  H2('Experiments (1)'), '<p>exps</p>',
  H2('References (2)'), '<ol class="pf-bib"><li>ref 1</li><li>ref 2</li></ol>'
].join('');
const mmOrder = pubDocOrderKeywords(
  ['title', 'authors', 'affiliations', 'meta', 'sections', 'experiments', 'methods', 'references'],
  PROJECT_SECTIONS);
const mmMoved = reorderDocHtml(mmFrozen, mmOrder);
ok(mmMoved.indexOf('Experiments (1)') < mmMoved.indexOf('Materials and Methods'),
  'les ▲▼ du panneau déplacent aussi le matériel et méthodes d’un document ENREGISTRÉ');
ok(mmMoved.includes('<p>Le tampon était 20 mM Tris.</p>'),
  '…son texte traverse le déplacement, intact');
eq(mmMoved.length, mmFrozen.length, '…sans un caractère perdu ni dupliqué : le document final a tout');
const mmTitled = reorderDocHtml(mmFrozen, mmOrder,
  pubDocTitleKeywords({ docTitles: { methods: 'Experimental section' } }));
ok(mmTitled.includes(`${H2('Experimental section')}<p>Le tampon était 20 mM Tris.</p>`),
  '…et l’intitulé choisi reste collé à son texte (« change the name of “materials and methods” »)');

// 5c. Exécuté : le retrait de la bibliographie d'un document FIGÉ s'arrête à sa liste —
//     un matériel et méthodes écrit plus bas n'est pas emporté par la coupe, donc il
//     survit à l'affichage puis à l'impression, qui copie cette page.
const mmAfterBib = [
  H2('Introduction'), '<p>intro</p>',
  H2('References (2)'), '<ol class="pf-bib"><li>ref 1</li><li>ref 2</li></ol>',
  H2('Materials and Methods'), '<p>Le tampon était 20 mM Tris.</p>'
].join('');
const mmStripped = withoutBibliographySection(mmAfterBib);
ok(!mmStripped.includes('pf-bib'), 'la bibliographie figée est retirée du document affiché');
ok(mmStripped.includes('<p>Le tampon était 20 mM Tris.</p>'),
  '…mais rien APRÈS elle n’est emporté (le matériel et méthodes survit)');
ok(mmStripped.includes(H2('Materials and Methods')), '…avec son intitulé');

console.log(`_pub_doc_sections_test.mjs — ${passed} assertions OK (ordre & intitulés des sections du document)`);
