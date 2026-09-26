/* =========================================================================
   _pub_doc_screen_only_test.mjs — LE PROGRAMME N'ÉCRIT PAS DANS LE DOCUMENT.

   La plainte : le document du projet (et le .docx qui en descend) emportait les
   textes DU PROGRAMME — « Automatically generated from the Experimental Conditions
   … of each included test », « Only the figures, plots and tables you ⭐-starred on
   the test pages are imported here », le bandeau « ☁ Text filed on Drive … ♻ Load
   the Drive copy » et les boutons de la page. Ils s'affichaient sous le texte de
   l'auteur, et « ✏️ Edit text » → « 💾 Save changes » les FIGEAIT avec lui
   (`el.innerHTML` était recopié tel quel) : l'instantané, la page relue, le PDF et
   le fichier Word les portaient tous.

   Le programme savait déjà quelles parties ne vivent qu'à l'écran — la classe
   `no-print`, que la feuille d'impression cache et que docxExport retire. Ce qui
   manquait : le document FIGÉ, qui la recopiait sans la regarder. D'où
   `withoutScreenOnlyUi` (journalFormats.js), appliquée à l'enregistrement, à
   l'affichage d'un instantané déjà écrit, et juste avant l'impression / le .docx.

   Ce qui est mesuré ici, sur le code livré :
     §1 `withoutScreenOnlyUi` EXÉCUTÉE : notes, boutons et bandeau retirés, texte
        de l'auteur intact — imbrication, apostrophes, balises vides comprises ;
     §2 LE DOCUMENT FIGÉ, exécuté avec le VRAI enchaînement de l'affichage ;
     §3 LE FICHIER WORD, exécuté : le même document n'y porte aucune note ;
     §4 LE CÂBLAGE : la page du projet, le panneau, leurs ré-exports — et ce qui
        N'EST PAS de l'interface (la ligne « Project line », la bibliographie).
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

// Les sources de src/ s'importent sans extension (résolues par Vite) — même crochet
// que _pub_doc_head_lines_test.mjs / _pub_docx_export_test.mjs.
register('./_esm_test_hook.mjs', import.meta.url);
const { withoutScreenOnlyUi, docHeadSpacedHtml, DOC_EMPTY_LINE_HTML } = await import('./src/components/journalFormats.js');
const { htmlToDocxBody } = await import('./src/utils/docxExport.js');

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

/* LE DOCUMENT D'ESSAI : le texte de l'auteur, les deux notes du programme, le
   bandeau du Drive, le bouton d'une légende — le balisage exact de la page du
   projet (classes de la mise en forme comprises). */
const TITLE = '<h1 class="pf-title text-2xl font-black text-slate-900 mb-1">Mortalin-p53 interaction in cancer cells</h1>';
const BODY = '<h2 class="pf-heading text-base font-black">Results and Discussion</h2>'
  + '<p class="pf-body">The peptides were tested against the mutant.</p>';
const MM_NOTE = '<p class="text-[10px] text-slate-400 mb-3 no-print">'
  + 'Automatically generated from the Experimental Conditions, Instrumental Setup and Experiment Setup '
  + 'of each included test.</p>';
const STAR_NOTE = '<p class="text-[10px] text-slate-400 mb-3 no-print">Only the figures, plots and tables '
  + 'you ⭐-starred on the test pages are imported here.</p>';
const DRIVE_BOX = '<div class="mb-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-600 '
  + 'bg-sky-50 border border-sky-200 rounded-lg px-2 py-1.5 no-print">'
  + '<span class="font-bold">☁ Text filed on Drive</span>'
  + '<button type="button" class="ml-auto">♻ Load the Drive copy</button></div>';
const CAPTION_BUTTON = '<span class="no-print">✏️ Edit this caption</span>';
const META = '<p class="pf-meta text-xs text-slate-500 mb-6">Project: Aphid · Scientist: Rossi M</p>';
/* L'INSTANTANÉ d'un document écrit AVANT cette règle : tout y est encore. */
const FROZEN = TITLE + META + MM_NOTE + BODY + STAR_NOTE + DRIVE_BOX + CAPTION_BUTTON;

/* ══ 1. `withoutScreenOnlyUi` EXÉCUTÉE ════════════════════════════════════════ */
eq(withoutScreenOnlyUi(FROZEN), TITLE + META + BODY,
  'le document sort sans un caractère de plus : les deux notes, le bandeau du Drive et le bouton de légende sont retirés');
eq(count(withoutScreenOnlyUi(FROZEN), 'no-print'), 0, 'aucun élément marqué ne reste dans le document');
ok(!withoutScreenOnlyUi(FROZEN).includes('Automatically generated'),
  '…ni la note « Automatically generated … » (section « Materials and Methods »)');
ok(!withoutScreenOnlyUi(FROZEN).includes('⭐-starred'),
  '…ni l’aide « Only the figures … ⭐-starred … » (section des figures)');
ok(!withoutScreenOnlyUi(FROZEN).includes('Text filed on Drive') && !withoutScreenOnlyUi(FROZEN).includes('Load the Drive copy'),
  '…ni le bandeau « ☁ Text filed on Drive » / « ♻ Load the Drive copy »');
ok(!withoutScreenOnlyUi(FROZEN).includes('Edit this caption'),
  '…ni les boutons de l’éditeur de légende (même règle que la feuille d’impression)');
ok(withoutScreenOnlyUi(FROZEN).includes('The peptides were tested against the mutant.'),
  'LE TEXTE DE L’AUTEUR, lui, n’est pas touché');

const once = withoutScreenOnlyUi(FROZEN);
eq(withoutScreenOnlyUi(once), once, 'la règle est IDEMPOTENTE : repasser dessus ne retire rien de plus');
eq(withoutScreenOnlyUi(withoutScreenOnlyUi(once)), once, '…même deux fois');
eq(withoutScreenOnlyUi('<p class="pf-body">Un document sans interface.</p>'),
  '<p class="pf-body">Un document sans interface.</p>',
  'un document sans « no-print » sort au caractère près');
eq(withoutScreenOnlyUi(''), '', 'un document vide reste vide');
eq(withoutScreenOnlyUi(null), '', 'une valeur absente ne casse rien');
eq(withoutScreenOnlyUi(undefined), '', '…ni `undefined`');

/* Les formes d'écriture d'une même classe, et l'imbrication : un bandeau marqué
   qui CONTIENT un bouton marqué doit partir d'un bloc (aucune balise orpheline). */
eq(withoutScreenOnlyUi('<p class=\'x no-print\'>aide</p><p>suite</p>'), '<p>suite</p>',
  'la classe entre apostrophes, au milieu d’autres classes, est reconnue');
eq(withoutScreenOnlyUi('<p className="x no-print">aide</p><p>suite</p>'), '<p>suite</p>',
  '…et l’attribut `className` aussi (le balisage d’un composant)');
eq(withoutScreenOnlyUi('<div class="no-print"><p>a</p><div class="no-print"><p>b</p></div></div><p>gardé</p>'),
  '<p>gardé</p>',
  'un élément marqué DANS un élément marqué sort avec lui — rien ne reste derrière');
eq(withoutScreenOnlyUi('<div class="pf-body"><span class="no-print">x</span><p>text</p></div>'),
  '<div class="pf-body"><p>text</p></div>',
  'un élément marqué dans un bloc du DOCUMENT ne retire que lui-même');
eq(withoutScreenOnlyUi('<p>a</p><hr class="no-print"><p>b</p>'), '<p>a</p><p>b</p>',
  '…et une balise vide marquée (`hr`)');
eq(withoutScreenOnlyUi('<img src="f.png" class="no-print"><p>b</p>'), '<p>b</p>',
  'une image marquée ne part pas non plus');
eq(withoutScreenOnlyUi('<p class="no-print">jamais fermé'), '<p class="no-print">jamais fermé',
  'un élément marqué JAMAIS FERMÉ est laissé tel quel (une note de trop plutôt qu’un document amputé)');
eq(withoutScreenOnlyUi('<p class="no-printable">reste</p>'), '<p class="no-printable">reste</p>',
  'une classe qui CONTIENT « no-print » n’est pas la classe « no-print »');
eq(withoutScreenOnlyUi('<p data-note="no-print">reste</p>'), '<p data-note="no-print">reste</p>',
  'un attribut qui porte la chaîne ne marque pas l’élément');

/* ══ 2. LE DOCUMENT FIGÉ, AVEC LE VRAI ENCHAÎNEMENT DE L'AFFICHAGE ════════════
   La page affiche un instantané ainsi (voir projectDetailModule) :
   `docHeadSpacedHtml(reorderDocHtml(withoutScreenOnlyUi(…)))`. Le nettoyage
   passe AVANT les autres règles — un instantané écrit par une version
   précédente est donc nettoyé À L'AFFICHAGE, sans rien réenregistrer. */
const shown = docHeadSpacedHtml(withoutScreenOnlyUi(FROZEN));
eq(count(shown, 'no-print'), 0, 'un document enregistré AVANT la règle s’affiche nettoyé');
ok(!shown.includes('Automatically generated') && !shown.includes('Text filed on Drive'),
  '…sans les notes du programme ni le bandeau du Drive (l’instantané, lui, n’est pas réécrit)');
ok(shown.includes('The peptides were tested against the mutant.') && shown.includes('Mortalin-p53'),
  '…et le texte de l’auteur est là, entier');

/* L'ORDRE COMPTE : la note du programme ne doit pas séparer deux blocs de tête —
   elle n'est plus là quand la ligne vide se pose (voir docHeadSpacedHtml). */
const headWithNote = TITLE + MM_NOTE + '<p class="pf-authors text-sm font-semibold">Rossi M</p>';
eq(count(docHeadSpacedHtml(withoutScreenOnlyUi(headWithNote)), DOC_EMPTY_LINE_HTML), 1,
  'la note retirée, la ligne vide du titre aux auteurs se pose normalement');
eq(count(docHeadSpacedHtml(headWithNote), DOC_EMPTY_LINE_HTML), 0,
  '…alors qu’avec la note encore là, elle ne se posait pas (la règle qui la retire passe bien en premier)');

/* ══ 3. LE FICHIER WORD, EXÉCUTÉ ══════════════════════════════════════════════
   Le .docx descend du même corps de document : ce qui sort du document doit en
   sortir aussi (docxExport retire déjà les `no-print`, voir isScreenOnly). */
const { xml } = htmlToDocxBody(FROZEN);
ok(xml.includes('The peptides were tested against the mutant.') && xml.includes('Results and Discussion'),
  'le .docx garde le texte de l’auteur et ses intitulés');
ok(!xml.includes('Automatically generated') && !xml.includes('⭐-starred'),
  '…et ne porte aucune des deux notes du programme');
ok(!xml.includes('Text filed on Drive') && !xml.includes('Load the Drive copy'),
  '…ni le bandeau du Drive');
ok(!xml.includes('Edit this caption'), '…ni les boutons de l’écran');

/* ══ 4. LE CÂBLAGE : LA PAGE DU PROJET, LE PANNEAU, LEURS RÉ-EXPORTS ═════════ */
has(PROJ, '  withoutScreenOnlyUi,',
  'la page du projet importe la règle (elle n’importe que le panneau : d’où le ré-export)');
has(PANEL, '  withoutScreenOnlyUi,\n', 'le panneau la ré-exporte');
/* …ET, AVEC ELLE, LE RETRAIT DE LA LIGNE D'INFORMATION DU PROJET (« the project
   line should not appear in the document unless activated ») : la page du projet
   n'importe que ce panneau, donc les deux règles voyagent ensemble. */
has(PANEL, '  withoutProjectLineHtml\n',
  '…avec le retrait de la ligne d’information du projet (voir withoutProjectLineHtml)');
has(PANEL, "} from './journalFormats';", '…depuis journalFormats.js, où elle est écrite');

/* L'ENREGISTREMENT : les trois chemins qui figent le document. */
has(PROJ, 'exportDocHtml: withoutScreenOnlyUi(el.innerHTML), docSuggestion: null',
  '« 💾 Save changes » fige le TEXTE — les notes du programme n’entrent pas dans l’instantané');
has(PROJ, 'setSuggestBaseHtml(withoutScreenOnlyUi(el.innerHTML));',
  'la base d’une suggestion est du texte aussi (le diff ne montre pas les notes du programme)');
has(PROJ, 'const editedHtml = withoutScreenOnlyUi(el.innerHTML);',
  '…et la version proposée (suggestion) est nettoyée des deux côtés');
has(PROJ, 'const baseHtml = withoutScreenOnlyUi(suggestBaseHtml) || editedHtml;',
  '…base comprise, pour que le diff reste comparable');
/* L'AFFICHAGE : un instantané déjà écrit, et le corps de l'impression / du .docx. */
has(PROJ, '__html: docHeadSpacedHtml(withoutScreenOnlyUi(',
  'le document FIGÉ est nettoyé à l’affichage (les instantanés déjà enregistrés aussi)');
/* LE DOCUMENT FIGÉ (et l'export) PASSE AUSSI PAR LE RETRAIT DE LA LIGNE
   D'INFORMATION DU PROJET : `withoutHiddenHeadLines` l'applique quand le format
   ne la montre pas, et le nettoyage des notes du programme l'entoure. */
has(PROJ, 'withoutScreenOnlyUi(withoutHiddenHeadLines(',
  '…nettoyé des notes du programme ET de la ligne d’information du projet, au même endroit');
has(PROJ, 'linkCitations(repairContentImages(withoutBibliographySection(project.exportDocHtml)))',
  '…avant les références et l’ordre du journal, sans toucher au texte de l’auteur');
has(PROJ, 'let bodyHtml = withoutScreenOnlyUi(withoutHiddenHeadLines(docEl.innerHTML));',
  'le corps PARTAGÉ de l’impression, du PDF et du .docx est nettoyé une seule fois, pour les trois');
eq(count(PROJ, 'withoutScreenOnlyUi('), 7,
  'sept endroits seulement : les trois enregistrements, les deux affichages et le corps exporté — tous les chemins du document');

/* CE QUI PORTE « no-print » DANS LE DOCUMENT : les notes du programme et le
   bandeau du Drive. Rien d'autre. */
eq(count(PROJ, 'text-[10px] text-slate-400 mb-3 no-print'), 2,
  'les deux notes du programme (Materials & Methods, figures ⭐) vivent à l’écran seulement');
has(PROJ, 'rounded-lg px-2 py-1.5 no-print">',
  '…et le bandeau « ☁ Text filed on Drive … ♻ Load the Drive copy »');
has(PROJ, '.no-print { display: none !important; }',
  'la feuille de la page EXPORTÉE (impression et PDF) cache la même classe');
ok(read('./src/utils/docxExport.js').includes('no-print'),
  'docxExport.js retire la même classe du fichier Word (voir isScreenOnly)');

/* …ET SUR LA BONNE BALISE : le « no-print » ajouté doit être sur l'élément qui
   porte le texte du programme, pas sur un bloc voisin (le défaut à ne pas
   commettre). On relit donc la source autour de chaque texte. */
{
  const boxAt = PROJ.indexOf('rounded-lg px-2 py-1.5 no-print">');
  const boxEnd = PROJ.indexOf('\n          </div>', boxAt);
  const box = PROJ.slice(boxAt, boxEnd);
  ok(box.includes('☁ Text filed on Drive') && box.includes('♻ Load the Drive copy'),
    'le « no-print » est sur LA BOÎTE du bandeau : « ☁ Text filed on Drive … ♻ Load the Drive copy » est dedans');
  ok(box.includes('☁ The text of this project is not filed on Drive yet') && box.includes('☁ File the text on Drive'),
    '…les DEUX branches du bandeau (projet déjà déposé / pas encore déposé) sont couvertes par le même `no-print`');
  /* …ET LA BOÎTE EST HORS DU DOCUMENT — la plainte de cette session : « In the final
     exported document of the project page I still don't see the title of the section
     references. In its place I see the section “Text filed on Drive” which should not be
     there. » Le bandeau ne vit plus DANS le bloc des références (donc dans
     `#project-doc-container`) : il est rendu APRÈS la fermeture du conteneur, du côté de
     l'interface — et la liste des références, elle, reste dans le document. */
  has(PROJ, '</div>\n          {/* ── LE BANDEAU DU DRIVE EST DE L\'INTERFACE',
    'le bandeau vient APRÈS la fermeture du conteneur du document : il n’en fait plus partie');
  ok(boxEnd !== -1 && PROJ.indexOf('<ol className="pf-bib', boxAt) < boxAt,
    '…et la bibliographie est restée DANS le document (elle passe avant lui)');
  for (const [label, needle] of [
    ['la note « Automatically generated … » des Materials and Methods', 'Automatically generated from the Experimental'],
    ['l’aide des figures ⭐', '⭐-starred on the test pages'],
  ]) {
    const at = PROJ.indexOf(needle);
    ok(at !== -1 && PROJ.slice(PROJ.lastIndexOf('<p', at), at).includes('no-print">'),
      `« no-print » est sur la balise de ${label} elle-même, pas sur un bloc voisin`);
  }
}

/* CE QUI N'EST PAS DE L'INTERFACE ET RESTE DONC DANS LE DOCUMENT. */
has(PROJ, 'className="pf-meta text-xs text-slate-500 mb-6"',
  'la ligne « Project line » (project · scientist · date) reste : elle a sa rangée dans le « Publication format »');
has(PROJ, '<ol className="pf-bib list-decimal pl-5 text-sm text-slate-800 space-y-1">',
  'la liste des références reste dans le document (le bandeau du Drive est retiré, la bibliographie non)');
has(PROJ, 'className="pf-title text-2xl font-black text-slate-900 mb-1"',
  '…et la tête du document (titre, auteurs, affiliations) n’est jamais marquée');

/* ══ 5. L'INTERFACE DE LA PAGE N'EST PAS LE DOCUMENT ══════════════════════════
   Les rangées de la page — « 🖼 Saved canvases », « 📚 References », « 🧾 Title,
   authors & affiliations »… — vivent HORS du conteneur du document
   (#project-doc-container) : l'instantané, la feuille d'impression / le PDF et
   le .docx descendent tous de CE conteneur, jamais de la page. Le texte d'une
   rangée de l'interface ne peut donc pas se retrouver dans la sortie (la sortie
   ne contient que le document). */
{
  const open = PROJ.indexOf('<div id="project-doc-container"');
  const afterDoc = open < 0 ? '' : PROJ.slice(open);
  const row = afterDoc.indexOf('<SectionCard');
  ok(open > 0 && row > 0, 'le document et les rangées de la page sont deux endroits distincts');
  const doc = afterDoc.slice(0, row);
  ok(!doc.includes('Saved canvases') && !doc.includes('SectionCard'),
    '…aucune rangée de la page (dont « 🖼 Saved canvases ») n’est DANS le document');
  has(doc, '<ol className="pf-bib',
    '…alors que la liste des références, elle, en fait partie (le document a sa bibliographie)');
  has(PROJ, 'document.getElementById(DOC_CONTAINER_ID)',
    'l’impression / le PDF / le .docx se fabriquent DANS le conteneur du document');
  has(PROJ, '<body><div id="${DOC_CONTAINER_ID}">${bodyHtml}</div></body>',
    '…et la feuille imprimée ne porte QUE lui : rien de la page ne peut en sortir');
}

console.log(`_pub_doc_screen_only_test.mjs : ${passed} passed`);
