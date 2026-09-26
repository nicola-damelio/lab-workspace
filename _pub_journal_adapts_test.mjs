/* =========================================================================
   _pub_journal_adapts_test.mjs — CE QUE LE JOURNAL EMPORTE, ET CE QUI SE
   RALLUME À LA MAIN.

   Quatre signalements de la même session, mesurés sur le code RÉEL
   (utils/authorNames.js, components/pubCitation.js, components/journalFormats.js),
   plus le câblage du panneau et de la page du projet (lignes présentes dans le
   source, comme le font _pub_format_panel_test.mjs et _pub_doc_sections_test.mjs) :

     1. « the names of the scientists have their surname in capital letter and
        that is fine but it is not fine when they are inserted as authors in a
        paper with a certain style » — la casse d'un nom écrit par un journal ;
     2. « selecting a journal style in the journal preset drop-down menu does not
        affect (as it should) the “In-text citations (project document)” and the
        “et al. after” settings » — `inText` · `etAl` dans le paquet du journal ;
     3. « the project line should not appear in the document unless activated »
        — `docNoBlock` (buildPubDocNoBlock · pubDocBlockHidden) ;
     4. « the references section always lacks the reference title in the final
        document even if in principle I can edit its name in the publication
        format section » — pubSetDocTitle rallume l'intitulé caché.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);
const { nameCase, nameParts, canonicalName, formatAuthorName, familyNameOf, NAME_STYLE_IDS } = await import('./src/utils/authorNames.js');
const { citeAuthorYearLabel } = await import('./src/utils/referenceLinks.js');
const {
  PUB_DOC_BLOCKS, PUB_DOC_OPTIONAL_IDS, buildPubFormat, buildPubDocNoBlock, buildPubLayout,
  normalizePubDocNoBlock, pubDocBlockHidden, pubDocTitleKeywords, pubDocTitleHidden, pubDocTitleOf,
  normalizePubDocTitles, normalizePubFormat, pubCitationText
} = await import('./src/components/pubCitation.js');
const {
  JOURNAL_IDS, applyJournalFormat, clearJournalFormat, withoutProjectLineHtml, docHeadSpacedHtml
} = await import('./src/components/journalFormats.js');

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const PANEL = src('./src/components/Publications.jsx');
const PROJ = src('./src/components/AppModules/projectDetailModule.jsx');
const ENGINE = src('./src/components/pubCitation.js');
const NAMES = src('./src/utils/authorNames.js');

let passed = 0;
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const eq = (a, b, what) => {
  assert.deepEqual(a, b, `${what}\n  attendu : ${JSON.stringify(b)}\n  obtenu  : ${JSON.stringify(a)}`);
  passed += 1;
};
const has = (where, needle, what) => ok(where.includes(needle), what);
const lacks = (where, needle, what) => ok(!where.includes(needle), what);

/* ══ 1. LA CASSE D'UN NOM QU'UN JOURNAL ÉCRIT ════════════════════════════════
   Le nom de famille en capitales est une écriture fréquente des sources
   (PubMed, RIS, Paperpile) : « as written » la garde, un journal ne peut pas
   l'imprimer. */
{
  eq(nameCase('ROSSI'), 'Rossi', 'un nom tout en capitales redevient un nom');
  eq(nameCase('VAN DER BERG'), 'van der Berg', '…les particules reprennent la minuscule');
  eq(nameCase('DE LA CRUZ'), 'de la Cruz', '…particules composées comprises');
  eq(nameCase("O'BRIEN"), "O'Brien", '…et l’apostrophe garde sa majuscule');
  eq(nameCase('SMITH-JONES'), 'Smith-Jones', '…comme le tiret');
  eq(nameCase('McDonald'), 'McDonald', 'un nom qui n’est pas tout en capitales n’est jamais touché');
  eq(nameCase('De Simone'), 'De Simone', '…ni une écriture mixte');
  eq(nameCase(''), '', 'une chaîne vide reste vide');
  eq(nameCase('ST JOHN'), 'St John', '« ST » ouvre aussi des noms : il n’est pas abaissé');

  NAME_STYLE_IDS.filter((id) => id !== 'asis').forEach((id) => {
    const written = formatAuthorName('SMITH JA', id);
    ok(!written.includes('SMITH') && written.includes('Smith'),
      `${id} : la famille n'est plus en capitales (${written})`);
  });
  eq(formatAuthorName('SMITH JA', 'family-comma-initials'), 'Smith, J. A.', '« SMITH JA » → « Smith, J. A. » (Nature, Cell)');
  eq(formatAuthorName('SMITH JA', 'initials-family'), 'J. A. Smith', '…« J. A. Smith » chez Science');
  eq(formatAuthorName('SMITH JA', 'family-initials'), 'Smith JA', '…« Smith JA » chez PNAS');
  eq(formatAuthorName('Marco ROSSI', 'family-comma-initials'), 'Rossi, M.', 'un prénom ordinaire et un nom en capitales : pareil');
  eq(formatAuthorName('ROSSI M', 'family-dot-initials'), 'Rossi M.', 'les initiales restent, la casse revient');
  eq(formatAuthorName('Rossi M', 'asis'), 'Rossi M', '« as written » laisse un nom déjà écrit tel quel');
  eq(formatAuthorName('ROSSI M', 'asis'), 'ROSSI M', '« as written » garde le nom AU CARACTÈRE PRÈS : la casse est une décision du format');
  /* …ET LE NOM EN CAPITALES DIT OÙ EST LE NOM (sans virgule, rien d'autre ne le dit). */
  eq(nameParts('ROSSI Marco'), { family: 'ROSSI', initials: 'M' },
    '« ROSSI Marco » : le mot en capitales EST le nom (et non « Marco »)');
  eq(nameParts('VAN DER BERG Jan'), { family: 'VAN DER BERG', initials: 'J' }, '…particules comprises');
  eq(nameParts('MCDONALD John'), { family: 'MCDONALD', initials: 'J' }, '…comme un nom qui n’est pas en capitales d’habitude');
  eq(nameParts('Marco ROSSI'), { family: 'ROSSI', initials: 'M' }, '« Marco ROSSI » (prénom puis nom en capitales) : la règle ordinaire suffit');
  eq(nameParts('SMITH JA'), { family: 'SMITH', initials: 'JA' }, 'une liste tout en capitales AVEC initiales : inchangée (PubMed)');
  eq(canonicalName('ROSSI Marco'), 'ROSSI M', 'la convention du laboratoire garde le nom, elle ne prend plus le prénom');
  eq(formatAuthorName('ROSSI Marco', 'family-comma-initials'), 'Rossi, M.', '…et la citation d’un journal écrit « Rossi, M. »');
  eq(formatAuthorName('ROSSI Marco', 'initials-family'), 'M. Rossi', '…« M. Rossi » chez Science');
  eq(familyNameOf('ROSSI Marco'), 'Rossi', 'le libellé auteur-année prend le nom en capitales, lui aussi');
  eq(formatAuthorName('EPPO', 'family-initials'), 'EPPO', 'un nom collectif sans initiales n’est pas « corrigé »');
  eq(formatAuthorName('SMITH', 'family-comma-initials'), 'SMITH', '…même chose pour un nom de famille seul');
  eq(familyNameOf('SMITH M'), 'Smith', 'le libellé auteur-année du texte suit la même règle');
  eq(familyNameOf('Rossi M'), 'Rossi', '…sans toucher un nom déjà écrit normalement');
  eq(citeAuthorYearLabel({ authors: 'SMITH M, ROSSI A, BIANCHI L', year: '2018' }), 'Smith et al., 2018',
    '« (SMITH et al., 2018) » n’est imprimé par aucune revue');
  eq(citeAuthorYearLabel({ authors: 'SMITH M, BIANCHI A', year: '2018' }), 'Smith & Bianchi, 2018',
    '…deux auteurs : « Nom & Nom, année »');
  has(NAMES, 'export const nameCase', 'la règle vit dans utils/authorNames.js, avec le reste des noms');
}

/* ══ 2. LE JOURNAL PORTE LES RENVOIS DU TEXTE ET LA COUPE DES AUTEURS ═══════
   Les deux réglages de la rubrique « References (citation & bibliography) » qui
   ne suivaient PAS le journal choisi. */
{
  const fresh = buildPubFormat('nature');
  eq([fresh.inTextStyle, fresh.etAlLimit], ['keep', 0],
    'un format neuf n’impose rien : le renvoi garde l’écriture du document, aucune coupe');
  JOURNAL_IDS.forEach((id) => {
    const fmt = applyJournalFormat(fresh, id);
    ok(fmt.inTextStyle !== 'keep', `${id} : le journal pose une forme de renvoi (${fmt.inTextStyle})`);
    ok(fmt.journal === id, `${id} : …et le format sait de quel journal il vient`);
  });
  eq(applyJournalFormat(fresh, 'nature').etAlLimit, 6, 'Nature coupe après six auteurs');
  eq(applyJournalFormat(fresh, 'science').etAlLimit, 5, 'Science après cinq');
  eq(applyJournalFormat(fresh, 'cell').inTextStyle, 'author-date', 'Cell écrit « (Rossi & Bianchi, 2018) »');
  eq(applyJournalFormat(fresh, 'cell').etAlLimit, 0, '…et ne coupe pas sa liste d’auteurs');
  eq(applyJournalFormat({ ...fresh, inTextStyle: 'bracket', etAlLimit: 3 }, 'nature').inTextStyle, 'sup',
    'le journal passe devant le réglage de l’utilisateur (« all the elements … must adapt to it »)');
  const many = {
    authors: 'A One, B Two, C Three, D Four, E Five, F Six, G Seven, H Eight',
    year: '2024', title: 'T', journal: 'J', volume: '1', pages: '2'
  };
  ok(pubCitationText(many, applyJournalFormat(fresh, 'nature'), []).includes('et al.'),
    'la coupe du journal se VOIT dans la citation');
  eq(clearJournalFormat(applyJournalFormat(fresh, 'nature'), buildPubLayout()).journal, undefined,
    '« As in the app » détache le journal…');
  eq(clearJournalFormat(applyJournalFormat(fresh, 'nature'), buildPubLayout()).inTextStyle, 'sup',
    '…et laisse le réglage de citation, que l’utilisateur a sous les yeux (comme les champs et la forme des noms)');
  has(ENGINE, "inTextStyle: 'keep'", 'le format neuf garde son état de départ (« keep »)');
  has(PANEL, 'const withPreset = applyJournalFormat({', 'le panneau applique le paquet du journal d’un seul geste');
  has(PANEL, 'in-text citations are', '…et le badge du journal annonce la forme des renvois et la coupe qu’il apporte');
}

/* ══ 3. LA LIGNE D'INFORMATION DU PROJET N'IMPRIME QUE SI ELLE EST ACTIVÉE ══ */
{
  eq(PUB_DOC_OPTIONAL_IDS, ['meta'], 'la seule ligne facultative est la ligne du projet');
  eq(PUB_DOC_BLOCKS.find((b) => b.id === 'meta').optional, true, '…elle est marquée `optional` dans les blocs du document');
  eq(PUB_DOC_BLOCKS.filter((b) => b.id !== 'meta' && b.optional), [],
    'aucun autre bloc n’est facultatif : titre, auteurs et affiliations portent le texte de l’auteur');
  eq(buildPubDocNoBlock(), ['meta'], 'un format neuf NE l’imprime PAS (« unless activated »)');
  eq(buildPubFormat('nature').docNoBlock, ['meta'], '…et le format neuf le dit');
  eq(normalizePubDocNoBlock(undefined), ['meta'], 'un format enregistré avant ce réglage reçoit le défaut du programme');
  eq(normalizePubDocNoBlock(['meta', 'meta', 'title']), ['meta'],
    'la liste relue : un bloc connu, une fois (le titre n’est pas facultatif)');
  eq(normalizePubDocNoBlock([]), [], 'une liste VIDE est un choix : ce format montre la ligne');
  eq(pubDocBlockHidden({}, 'meta'), true, 'sans réglage, la ligne est éteinte');
  eq(pubDocBlockHidden({ docNoBlock: [] }, 'meta'), false, '…allumée dès que la liste se vide');
  eq(pubDocBlockHidden({}, 'authors'), false, 'un bloc de tête qui porte le texte de l’auteur n’est jamais éteint');
  eq(applyJournalFormat(buildPubFormat('nature'), 'jacs').docNoBlock, ['meta'],
    'changer de journal ne rallume pas la ligne : c’est la décision de l’utilisateur');
  eq(applyJournalFormat({ ...buildPubFormat('nature'), docNoBlock: [] }, 'jacs').docNoBlock, [],
    '…et ne l’éteint pas non plus');
  eq(clearJournalFormat({ ...buildPubFormat('nature'), docNoBlock: [] }, buildPubLayout()).docNoBlock, ['meta'],
    '« As in the app » la remet à l’état d’un format neuf (éteinte)');

  /* LE DOCUMENT DÉJÀ ÉCRIT : la ligne en sort, et les lignes vides se replacent
     entre les blocs de tête qui restent VOISINS (voir docHeadSpacedHtml). */
  const FROZEN = '<h1 class="pf-title">Titre</h1><div class="pf-empty-line" aria-hidden="true">&nbsp;</div>'
    + '<p class="pf-authors">Rossi M</p><div class="pf-empty-line" aria-hidden="true">&nbsp;</div>'
    + '<p class="pf-meta text-xs text-slate-500 mb-6">Project: Aphid · Scientist: Rossi M</p>'
    + '<h2 class="pf-heading">Results and Discussion</h2><p>text</p>';
  eq(withoutProjectLineHtml(FROZEN),
    '<h1 class="pf-title">Titre</h1><div class="pf-empty-line" aria-hidden="true">&nbsp;</div>'
    + '<p class="pf-authors">Rossi M</p><div class="pf-empty-line" aria-hidden="true">&nbsp;</div>'
    + '<h2 class="pf-heading">Results and Discussion</h2><p>text</p>',
    'la ligne d’information sort du document écrit, et rien d’autre ne bouge');
  eq(withoutProjectLineHtml(withoutProjectLineHtml(FROZEN)), withoutProjectLineHtml(FROZEN), 'l’opération est idempotente');
  eq(withoutProjectLineHtml('<p class="x">a</p>'), '<p class="x">a</p>', 'un document sans cette ligne sort tel quel');
  eq(withoutProjectLineHtml('<p class="pf-meta-x">a</p>'), '<p class="pf-meta-x">a</p>',
    'une AUTRE classe qui commence pareil n’est pas prise pour elle');
  lacks(docHeadSpacedHtml(withoutProjectLineHtml(FROZEN)), 'pf-meta', 'après le retrait, aucune ligne d’information ne reste');
  eq(docHeadSpacedHtml(withoutProjectLineHtml(FROZEN)),
    '<h1 class="pf-title">Titre</h1><div class="pf-empty-line" aria-hidden="true">&nbsp;</div>'
    + '<p class="pf-authors">Rossi M</p><h2 class="pf-heading">Results and Discussion</h2><p>text</p>',
    '…et la ligne vide qui la suivait disparaît avec elle');

  /* LE CÂBLAGE : la page ne rend plus le bloc, l’aperçu suit, et l’instantané
     enregistré comme l’export (impression, PDF, .docx) passent par le retrait. */
  has(PROJ, "if (!pubDocBlockHidden(pubFormat, 'meta')) blocks.meta = (",
    'la page du projet ne rend la ligne que si le format la montre');
  has(PROJ, 'const withoutHiddenHeadLines = (html) =>', '…un seul endroit retire la ligne d’un document écrit');
  has(PROJ, 'withoutScreenOnlyUi(withoutHiddenHeadLines(docEl.innerHTML))',
    'l’export (impression, PDF, .docx) la retire aussi');
  has(PROJ, 'withoutScreenOnlyUi(withoutHiddenHeadLines(', '…et le document FIGÉ affiché sur la page');
  has(PANEL, 'checked={!docNoBlock.includes(id)}', 'la rangée du panneau porte une case (cochée = imprimée)');
  has(PANEL, 'pubToggleDocBlock(id, e.target.checked)', '…qui écrit le choix dans le format');
  has(PANEL, 'docNoBlock: normalizePubDocNoBlock(fmt && fmt.docNoBlock)',
    'le format garde `docNoBlock` quand on règle un champ de la citation');
  has(PANEL, 'docNoBlock: buildPubDocNoBlock()', '…et le ↺ des sections le remet à l’état de départ');
  has(PANEL, "!pubDocBlockHidden(activeFormat, 'meta')",
    'l’aperçu du panneau ne montre pas une ligne que le document n’imprime pas');
  has(PANEL, 'withoutProjectLineHtml', 'le panneau ré-exporte le retrait pour la page du projet');
}

/* ══ 4. L'INTITULÉ QU'ON ÉCRIT EST CELUI QUI S'IMPRIME ══════════════════════
   Un style peut cacher un intitulé (Science n'en écrit aucun au-dessus de sa
   bibliographie) : la rangée « References » le dit, et un nom écrit (ou ↺) le
   fait revenir. MAIS SEUL LE JOURNAL PEUT LE CACHER — la plainte de cette session,
   « In the final exported document of the project page I still don't see the title of
   the section references », venait d'un format enregistré du temps où la case
   « Print the “References” heading » existait : son `docNoTitle: ['references']`
   survivait SANS le journal qui l'expliquait, et l'intitulé restait caché pour
   toujours (voir effectivePubDocNoTitle). */
{
  /* LA RÈGLE DE LA PAGE DU PROJET, reproduite ici (voir `docHeading`,
     projectDetailModule) : l'intitulé du document est celui du format, et un
     intitulé CACHÉ n'en est pas un. */
  const docHeading = (fmt, id) => (pubDocTitleHidden(fmt, id) ? '' : pubDocTitleOf(normalizePubDocTitles(fmt && fmt.docTitles), id));
  /* SCIENCE : le journal dit lui-même qu'il n'écrit aucun intitulé (`bibLabel: ''`). */
  const science = { docNoTitle: ['references'], bibLabel: '', journal: 'science' };
  eq(docHeading(science, 'references'), '',
    'un style qui cache l’intitulé (Science) : le document n’écrit rien au-dessus de la liste');
  eq(pubDocTitleKeywords(science).references, '',
    '…sur un document DÉJÀ ÉCRIT, cet intitulé est réécrit VIDE : son <h2> s’en va, le bloc reste');
  /* LE MARQUEUR DE LA CASE DISPARUE : gardé par un format enregistré, mais AUCUN
     journal ne l'explique (`bibLabel` absent, ou un intitulé normal). */
  eq(docHeading({ docNoTitle: ['references'] }, 'references'), 'References',
    'un marqueur que RIEN ne justifie (la case disparue, un format rechargé) ne cache plus l’intitulé : il s’imprime de nouveau');
  eq(pubDocTitleKeywords({ docNoTitle: ['references'] }).references, undefined,
    '…et le document déjà écrit garde son <h2> : la liste des références ne reste plus sans titre dans le document final');
  eq(pubDocTitleKeywords({ docNoTitle: ['references'], bibLabel: 'References' }).references, undefined,
    '…même quand le format dit qu’il écrit un intitulé (bibLabel « References »)');
  eq(pubDocTitleKeywords({ docNoTitle: ['references'], bibLabel: '' }).references, '',
    '…tandis qu’un vrai journal sans intitulé (Science) continue de le retirer');
  eq(pubDocTitleHidden({ docNoTitle: ['methods'] }, 'methods'), false,
    'aucun journal n’a jamais caché l’intitulé d’une AUTRE section : cette liste n’en cache qu’un');
  eq(docHeading({ docNoTitle: [] }, 'references'), 'References',
    'le masque retiré, l’intitulé du programme s’imprime — c’est lui qui « manquait » dans le document final');
  eq(docHeading({ docNoTitle: [], docTitles: { references: 'Bibliography' } }, 'references'), 'Bibliography',
    '…ou le nom que l’utilisateur écrit dans « Document sections (order & titles) »');
  eq(docHeading({ docNoTitle: [] }, 'methods'), 'Materials and Methods',
    '…et aucune autre section ne change : c’est la même règle pour toutes');
  eq(pubDocTitleKeywords({ docNoTitle: [] }).references, undefined,
    '…tandis qu’un intitulé laissé au programme n’a rien à réécrire (le document écrit déjà le sien)');
  has(PANEL, 'docNoTitle: normalizePubDocNoTitle(docNoTitle.filter((x) => x !== id)),',
    'écrire un intitulé le RALLUME (il sort de `docNoTitle`)');
  has(PANEL, 'docNoBlock: normalizePubDocNoBlock(docNoBlock.filter((x) => x !== id))',
    '…et il rallume aussi une ligne facultative qu’un format n’imprimait pas');
  has(PANEL, "onClick={() => pubSetDocTitle(id, '')}", 'le ↺ de la rangée passe par le même chemin');
  has(PANEL, 'docNoTitle.includes(id) &&', 'la rangée DIT que le style n’écrit pas cet intitulé');
  has(PANEL, 'not printed by the style', '…et le répète dans la bulle du badge');
  /* LE FORMAT LUI-MÊME : seul le journal justifie un intitulé caché — au chargement
     comme dans le panneau (voir effectivePubDocNoTitle). */
  eq(normalizePubFormat({ docNoTitle: ['references'] }).docNoTitle, [],
    'un format rechargé perd le marqueur que rien ne justifie');
  eq(normalizePubFormat({ docNoTitle: ['references'], bibLabel: '' }).docNoTitle, ['references'],
    '…mais garde celui de son journal (Science) : son intitulé reste caché');
  /* LE JOURNAL SURVIT AU RECHARGEMENT (il était perdu, avec son intitulé) : sans lui,
     le panneau montrait « As in the app » et l'intitulé de la bibliographie restait
     caché sans que rien ne l'explique. */
  const reloaded = normalizePubFormat({
    preset: 'science', journal: 'science', order: ['abstract', 'references'], bibLabel: '', docNoTitle: ['references']
  });
  eq(reloaded.journal, 'science', 'le NOM du journal survit au rechargement (le panneau le montre)');
  eq(reloaded.bibLabel, '', '…l’intitulé de sa bibliographie aussi');
  eq(reloaded.order, ['abstract', 'references'], '…et l’ordre de ses sections');
  eq(reloaded.docNoTitle, ['references'], '…donc son intitulé caché reste caché (le journal le justifie)');
  has(ENGINE, 'docNoTitle: effectivePubDocNoTitle(parsed),',
    'le masque se relit par la MÊME règle que le document (effectivePubDocNoTitle)');
  has(PANEL, 'docNoTitle: effectivePubDocNoTitle(fmt),',
    'le panneau aussi : régler un champ de la citation ne remet pas un marqueur mort');
  has(PROJ, "pubDocTitleHidden(pubFormat, id) ? '' : pubDocTitleOf(docTitles, id)",
    'la page du projet suit ce masque, intitulé compris');
  has(PROJ, "!docHeading('references') && (",
    '…et elle DIT, à l’écran, quand c’est le style qui n’écrit pas l’intitulé (et comment le rendre)');
}

console.log(`_pub_journal_adapts_test.mjs — ${passed} assertions passed`);
