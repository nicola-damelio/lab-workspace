/* =========================================================================
   _pub_columns_test.mjs — LA PAGE À DEUX COLONNES DU « PUBLICATION FORMAT ».

   La demande, mot pour mot : « In the publication format we forgot to implement
   the two column style which is quite common in journals? It should be defined
   for all sections. »

   CE QUI EST VÉRIFIÉ ICI, SUR LE MODULE RÉEL (src/components/pubCitation.js) :

     1. UN NIVEAU DE PAGE — `layout.page.columns` : 1, 2 ou 3 colonnes. Un format
        neuf (et tout format enregistré avant ce réglage) est à UNE colonne et
        n'écrit AUCUNE règle de plus qu'avant : la feuille reste vide ;
     2. UN MOT PAR PARTIE — `layout.<partie>.span`, défini pour LES SEPT parties
        du document (PUB_LAYOUT_PARTS, la demande « pour toutes les sections ») :
        'flow' (elle coule dans les colonnes), 'all' (elle barre la page) ou ''
        (comme la page : les trois lignes de tête barrent, le reste coule) ;
     3. LA FEUILLE : `column-count` sur le conteneur du document, `column-span:
        all` sur les parties qui barrent, `break-inside: avoid` sur les figures
        et les intitulés (jamais sur le texte des sections, qui DOIT se couper) ;
     4. LES REVUES : chaque journal de la liste imprime en deux colonnes, donc
        chaque journal l'apporte (`applyJournalFormat`), et « As in the app »
        (`clearJournalFormat`) ramène la page à une colonne ;
     5. LE PANNEAU : les deux réglages sont là — le nombre de colonnes de la page
        et la ligne « Columns » de CHAQUE partie — et ils passent par les
        fonctions qui écrivent le format (pubSetLayout), jamais par une écriture
        directe ; le document, lui, ne consulte que pubLayoutCss.

   CE QU'ELLE NE VÉRIFIE PAS : l'export .docx, qui ne porte pas les colonnes de
   la page (Word les met dans le `sectPr` d'une section — c'est dit dans l'en-tête
   de src/utils/docxExport.js, et c'est la seule sortie qui n'a pas ce style).
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);
const {
  PUB_COLUMN_GAP_REM, PUB_COLUMN_SPANS, PUB_COLUMN_SPAN_IDS, PUB_HEAD_PART_IDS,
  PUB_LAYOUT_PARTS, PUB_LAYOUT_PART_IDS, PUB_PAGE_COLUMNS, PUB_PAGE_COLUMN_IDS,
  buildPubFormat, buildPubLayout, normalizePubFormat, normalizePubLayout,
  pubLayoutCss, pubPageColumnsOf, pubSpanIn, pubSpanOf,
} = await import('./src/components/pubCitation.js');
const {
  JOURNAL_FORMATS, JOURNAL_IDS, applyJournalFormat, clearJournalFormat, journalLayoutPatches,
} = await import('./src/components/journalFormats.js');

const PANEL = readFileSync(new URL('./src/components/Publications.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const PAGE = readFileSync(new URL('./src/components/AppModules/projectDetailModule.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

let passed = 0;
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};
const eq = (a, b, what) => {
  assert.deepEqual(a, b, `${what}\n  attendu : ${JSON.stringify(b)}\n  obtenu  : ${JSON.stringify(a)}`);
  passed += 1;
};

/* ── 1. LE RÉGLAGE DE PAGE ────────────────────────────────────────────────── */
eq(PUB_PAGE_COLUMN_IDS, [1, 2, 3], 'on offre une, deux ou trois colonnes — « two column » est le cas des revues');
eq(PUB_PAGE_COLUMNS.map((c) => c.label), ['One column', 'Two columns', 'Three columns'], '…nommées comme le panneau les montre');
eq(PUB_PAGE_COLUMNS.every((c) => c.title && c.title.length > 30), true, '…et chacune dit ce qu’elle fait (le panneau n’a rien à réécrire)');
ok(PUB_COLUMN_GAP_REM >= 1.5 && PUB_COLUMN_GAP_REM <= 4, `l’écart entre deux colonnes est celui d’une revue (${PUB_COLUMN_GAP_REM}rem)`);
const fresh = buildPubFormat('nature');
eq(pubPageColumnsOf(fresh), 1, 'un format neuf est à UNE colonne : le document garde l’aspect du programme tant que personne ne demande deux colonnes');
eq(buildPubLayout().page, { columns: 1 }, '…et la page est écrite dans la mise en forme (`layout.page`)');
eq(pubPageColumnsOf({ layout: { page: { columns: 2 } } }), 2, 'le format porte le nombre de colonnes');
eq(pubPageColumnsOf({ layout: { page: { columns: 7 } } }), 1, 'un nombre inconnu (format d’un autre poste) retombe sur une colonne');
eq(pubPageColumnsOf({ layout: {} }), 1, 'un format sans page (enregistré avant ce réglage) aussi');
eq(normalizePubLayout({ page: { columns: '2' } }).page, { columns: 2 }, '…et le nombre est relu comme un nombre au chargement');

/* ── 2. LE MOT DE CHAQUE PARTIE, POUR TOUTES LES PARTIES ──────────────────── */
eq(PUB_LAYOUT_PARTS.filter((p) => p.span).map((p) => p.id), PUB_LAYOUT_PART_IDS,
  'LES SEPT parties du document ont un mot sur les colonnes (la demande : « defined for all sections »)');
eq(PUB_LAYOUT_PARTS.filter((p) => !p.span).length, 0, '…aucune ne l’oublie');
eq(PUB_COLUMN_SPAN_IDS, ['', 'flow', 'all'], 'les trois mots : comme la page · dans les colonnes · pleine largeur');
eq(PUB_COLUMN_SPANS.map((s) => s.label), ['As the page', 'In the columns', 'Full width'], '…avec les libellés du panneau');
eq(PUB_HEAD_PART_IDS, ['title', 'authors', 'affiliations'], 'les trois lignes de TÊTE : ce sont elles qui barrent la page par défaut');
const L2 = normalizePubLayout({ page: { columns: 2 } });
eq(pubSpanIn(L2, 'title'), 'all', 'en deux colonnes, le titre barre la page sans que le format ait rien dit');
eq(pubSpanIn(L2, 'authors'), 'all', '…les auteurs aussi');
eq(pubSpanIn(L2, 'affiliations'), 'all', '…et les affiliations');
eq(pubSpanIn(L2, 'heading'), 'flow', 'un intitulé de section coule dans sa colonne');
eq(pubSpanIn(L2, 'body'), 'flow', 'le texte des sections coule : c’est le principe des colonnes');
eq(pubSpanIn(L2, 'figure'), 'flow', 'une figure prend une colonne');
eq(pubSpanIn(L2, 'bibliography'), 'flow', 'la liste des références coule (les revues l’impriment ainsi)');
eq(pubSpanIn(normalizePubLayout({ page: { columns: 2 }, body: { span: 'all' } }), 'body'), 'all',
  '…et une partie peut dire « pleine largeur » (un résumé imprimé sur les deux colonnes)');
eq(pubSpanIn(normalizePubLayout({ page: { columns: 2 }, title: { span: 'flow' } }), 'title'), 'flow',
  '…comme les lignes de tête peuvent dire le contraire');
eq(pubSpanIn(normalizePubLayout({ page: { columns: 2 }, body: { span: 'zzz' } }), 'body'), 'flow',
  'un mot inconnu ne casse rien : la partie retombe sur le défaut de la page');
eq(pubSpanOf(fresh, 'body'), 'flow', 'pubSpanOf lit la même chose sur un format entier (le panneau l’interroge)');
eq(pubSpanOf(fresh, 'title'), 'all', '…titre compris');
eq(normalizePubFormat({ ...fresh, layout: { ...fresh.layout, page: { columns: 2 }, figure: { ...fresh.layout.figure, span: 'all' } } }).layout.figure.span, 'all',
  'un format ENREGISTRÉ garde ses colonnes et ses mots (aller-retour par normalizePubFormat)');

/* ── 3. LA FEUILLE DE STYLE ───────────────────────────────────────────────── */
eq(pubLayoutCss(fresh), '', 'un format neuf (une colonne) n’écrit AUCUNE règle, comme avant');
const css2 = pubLayoutCss({ layout: { page: { columns: 2 } } });
ok(css2.includes(`#project-doc-container { column-count: 2 !important; column-gap: ${PUB_COLUMN_GAP_REM}rem !important; }`),
  'la page à deux colonnes est écrite sur le CONTENEUR du document');
ok(css2.includes('#project-doc-container .pf-title, #project-doc-container h1 { column-span: all !important; break-inside: avoid !important; }'),
  '…et le titre barre la page (classe ET balise de repli, comme toutes les autres règles)');
ok(css2.includes('#project-doc-container .pf-authors { column-span: all !important; break-inside: avoid !important; }'),
  '…les auteurs aussi');
ok(!/pf-body[^{]*\{[^}]*column-span/.test(css2), 'le texte des sections, lui, NE barre pas : il coule dans les colonnes');
ok(!/pf-body[^{]*\{[^}]*break-inside/.test(css2), '…et il lui est interdit de ne pas se couper (une colonne doit pouvoir le couper)');
ok(css2.includes('#project-doc-container .pf-figure, #project-doc-container figure { break-inside: avoid; }'),
  'une figure ne se coupe ni entre deux colonnes ni entre deux pages');
ok(css2.includes('#project-doc-container .pf-heading, #project-doc-container h2 { break-inside: avoid; }'),
  '…un intitulé non plus (il ne reste pas seul au bas d’une colonne)');
ok(css2.includes('#project-doc-container .pf-empty-line { column-span: all !important; break-inside: avoid !important; }'),
  'les lignes vides de la tête appartiennent à la tête : elles barrent la page comme elle');
const css3 = pubLayoutCss({ layout: { page: { columns: 3 }, bibliography: { span: 'all' } } });
ok(css3.includes('column-count: 3 !important'), 'trois colonnes s’écrivent comme deux');
ok(css3.includes('#project-doc-container .pf-bib, #project-doc-container .pf-bib li { column-span: all !important;'),
  '…et la liste des références barre la page quand le format le demande');
ok(!pubLayoutCss({ layout: { page: { columns: 1 }, body: { span: 'all' } } }).includes('column-span'),
  'avec UNE colonne, aucun mot sur les colonnes n’est écrit (il n’y a rien à barrer)');

/* ── 4. LES REVUES IMPRIMENT EN DEUX COLONNES ─────────────────────────────── */
ok(JOURNAL_IDS.length > 0, 'la liste des journaux est là');
JOURNAL_IDS.forEach((id) => {
  eq(pubPageColumnsOf({ layout: JOURNAL_FORMATS[id].layout }), 2,
    `le journal « ${JOURNAL_FORMATS[id].label} » imprime une page à deux colonnes, et son format l’apporte`);
  eq(journalLayoutPatches(id).page, { columns: 2 },
    `…et sa rustine de mise en forme le dit (journalLayoutPatches, ${id})`);
  const applied = applyJournalFormat(buildPubFormat('nature'), id);
  eq(pubPageColumnsOf(applied), 2, `choisir « ${JOURNAL_FORMATS[id].label} » met le document sur deux colonnes`);
  eq(pubSpanOf(applied, 'title'), 'all', '…titre barrant la page, comme dans la revue');
  eq(pubSpanOf(applied, 'body'), 'flow', '…et un texte qui coule dans les colonnes');
  eq(pubPageColumnsOf(clearJournalFormat(applied, buildPubLayout())), 1,
    '« As in the app » ramène la page à UNE colonne (rien du journal ne reste)');
});
ok(journalLayoutPatches('jacs').title && journalLayoutPatches('jacs').body,
  'les rustines portent toujours les parties du document (la page ne les remplace pas)');

/* ── 5. LE PANNEAU ET LA PAGE DU PROJET ───────────────────────────────────── */
ok(PANEL.includes('PUB_PAGE_COLUMNS, PUB_COLUMN_SPANS, pubPageColumnsOf'),
  'le panneau importe la page ET les mots de partie (aucune copie locale)');
ok(PANEL.includes('{PUB_PAGE_COLUMNS.map((c) => ('), '…il affiche le nombre de colonnes de la page');
ok(PANEL.includes("onClick={() => pubSetLayout('page', { columns: c.id })}"),
  '…et l’écrit par la fonction qui écrit une partie du format (pubSetLayout) — jamais à la main');
ok(PANEL.includes('pubPageColumnsOf(activeFormat) === c.id'), '…en montrant le choix en cours');
ok(PANEL.includes("onClick={() => pubResetLayout('page')}"), '↺ remet la page à une colonne');
ok(PANEL.includes('{part.span && ('), '…et CHAQUE partie du document a son mot sur les colonnes (la demande)');
ok(PANEL.includes("{PUB_COLUMN_SPANS.map((s) => <option key={s.id || 'page'} value={s.id}>{s.label}</option>)}"),
  'la liste déroulante des mots est écrite par le rendu commun');
ok(PANEL.includes('onChange={(e) => pubSetLayout(part.id, { span: e.target.value })}'),
  '…et elle écrit dans la partie elle-même');
ok(PAGE.includes('pubLayoutCss(pubFormat, DOC_CONTAINER_SELECTOR)'),
  'la page du projet et sa feuille d’impression lisent la MÊME feuille (donc les colonnes aussi)');
ok(PAGE.includes('<div id="project-doc-container"'), '…sur le conteneur que la règle de colonnes vise');
ok(/@media screen\s*\{\s*#project-doc-container\[contenteditable="true"\]\s*\{[^}]*column-count: 1/.test(PAGE),
  'la page d’ÉCRITURE est remise sur une colonne (on n’écrit pas dans une mise en page), et seulement à l’écran : l’impression, le PDF et l’aperçu gardent les colonnes');
ok(PANEL.includes("pubLayoutCss(activeFormat, '#pub-layout-preview')"),
  'l’aperçu du panneau suit le même chemin (ce qu’il montre est ce qui s’imprime)');

console.log(`_pub_columns_test.mjs — ${passed} assertions OK (page à deux colonnes + un mot pour chaque partie)`);
