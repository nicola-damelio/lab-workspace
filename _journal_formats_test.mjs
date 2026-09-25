/* =========================================================================
   _journal_formats_test.mjs — « cambiare giornale di submission velocemente ».

   La demande : « se invio il paper a JACS e viene rifiutato, posso decidere di
   inviarlo a angewandte: l'ordine delle sezioni, il formato della bibliografia, il
   carattere delle varie sezioni cambierà. Vorrei poter fare questo cambio in
   automatico. »

   Le module RÉEL est importé (src/components/journalFormats.js) : chaque journal
   est vérifié contre le panneau « Publication format » — son preset de citation
   existe, ses sept parties de document sont des parties CONNUES, ses réglages de
   caractère passent le nettoyage du panneau (une police, une taille, un alignement
   légaux) — et `reorderDocHtml` est EXÉCUTÉ sur de vrais documents pour prouver
   qu'un changement de journal réordonne les sections sans perdre un mot.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

// Les sources de src/ s'importent sans extension (résolues par Vite) — même
// crochet que _pub_author_style_test.mjs.
register('./_esm_test_hook.mjs', import.meta.url);
const {
  JOURNAL_FORMATS, JOURNAL_IDS, applyJournalFormat, clearJournalFormat, journalLabelOf,
  journalLayoutPatches, journalOf, journalPubFields, journalSectionOrder, reorderDocHtml
} = await import('./src/components/journalFormats.js');
const {
  PUB_FORMAT_PRESETS, PUB_LAYOUT_PARTS, PUB_LAYOUT_PART_IDS,
  buildPubFormat, buildPubLayout, normalizePubLayout, pubCitationText, pubDocTitleKeywords, pubTextStyleIsSet
} = await import('./src/components/pubCitation.js');
const { NAME_STYLE_IDS, normalizeNameStyle } = await import('./src/utils/authorNames.js');

let passed = 0;
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const eq = (a, b, what) => {
  assert.deepEqual(a, b, `${what}\n  attendu : ${JSON.stringify(b)}\n  obtenu  : ${JSON.stringify(a)}`);
  passed += 1;
};

/* ══ 1. CHAQUE JOURNAL EST UN PACCHETTO COMPLET ═══════════════════════════ */
ok(JOURNAL_IDS.length >= 8, `les journaux proposés sont assez nombreux (${JOURNAL_IDS.length})`);
const labels = JOURNAL_IDS.map((id) => JOURNAL_FORMATS[id].label);
eq([...new Set(labels)].length, labels.length, 'deux journaux ne portent pas le même nom');
JOURNAL_IDS.forEach((id) => {
  const j = JOURNAL_FORMATS[id];
  ok(!!j.label, `${id} : un nom lisible dans la liste`);
  ok(!!PUB_FORMAT_PRESETS[j.preset], `${id} : son preset de citation existe (${j.preset})`);
  eq(journalLabelOf(id), j.label, `${id} : journalLabelOf rend le même nom`);
  eq(Object.keys(j.layout).sort(), PUB_LAYOUT_PART_IDS.slice().sort(),
    `${id} : il règle les SEPT parties du document (titre → bibliographie)`);
  eq(Object.keys(journalLayoutPatches(id)).sort(), PUB_LAYOUT_PART_IDS.slice().sort(),
    `${id} : toutes ses parties passent le filtre des parties connues`);
  // Le nettoieur du panneau garde la valeur telle quelle : police, taille et
  // alignement sont donc LÉGAUX (sinon le document ignorerait le réglage).
  const clean = normalizePubLayout(j.layout);
  PUB_LAYOUT_PART_IDS.forEach((part) => {
    eq(clean[part].font, j.layout[part].font, `${id} : la police de « ${part} » survit au nettoyage`);
    eq(clean[part].size, j.layout[part].size, `${id} : la taille de « ${part} » survit au nettoyage`);
    eq(clean[part].align, j.layout[part].align, `${id} : l’alignement de « ${part} » survit au nettoyage`);
    ok(pubTextStyleIsSet(clean[part]), `${id} : « ${part} » porte vraiment un caractère (le document change)`);
  });
  // L'ORDRE : des mots, pas des nombres, et la bibliographie est toujours nommée.
  ok(Array.isArray(j.order) && j.order.length >= 3, `${id} : il déclare l’ordre de ses sections`);
  ok(j.order.includes('references'), `${id} : la bibliographie est nommée dans l’ordre`);
  eq([...new Set(j.order)].length, j.order.length, `${id} : aucun mot répété dans l’ordre`);
  ok(j.order.every((w) => w === w.toLowerCase()), `${id} : les mots de l’ordre sont en minuscules (comparaison sûre)`);
  ok(!!j.notes, `${id} : il explique sa convention (infobulle)`);
});
// Le cas de la demande : JACS puis Angewandte ne se ressemblent pas.
ok(JOURNAL_FORMATS.jacs.order.join() !== JOURNAL_FORMATS.angewandte.order.join(),
  'JACS et Angewandte ne rangent pas les sections de la même façon');
ok(pubTextStyleIsSet(JOURNAL_FORMATS.jacs.layout.body) && pubTextStyleIsSet(JOURNAL_FORMATS.angewandte.layout.body),
  '…et tous deux dictent le caractère du corps du texte');
ok(JOURNAL_FORMATS.jacs.layout.body.font !== JOURNAL_FORMATS.angewandte.layout.body.font,
  'changer de journal change la police du corps du texte');

/* ══ 2. APPLIQUER UN JOURNAL N'INVENTE RIEN ═══════════════════════════════ */
const mine = {
  ...buildPubFormat('nature'),
  inTextStyle: 'superscript',
  bibLabel: 'Mine',
  width: 42,
  layout: normalizePubLayout({ body: { font: 'Arial, Helvetica, sans-serif', size: 13 } }),
};
const applied = applyJournalFormat(mine, 'jacs');
eq(applied.journal, 'jacs', 'le format sait à quel journal il appartient');
eq(applied.preset, 'acs', '…et sa citation prend le preset du journal');
eq(applied.order, JOURNAL_FORMATS.jacs.order, '…et son ordre de sections');
eq(applied.bibLabel, 'References', '…et le titre de sa bibliographie');
eq(applied.layout.body.font, JOURNAL_FORMATS.jacs.layout.body.font, '…et le caractère de son texte');
eq(applied.inTextStyle, 'superscript', 'le style de renvoi DANS le texte est conservé');
eq(applied.width, 42, 'un réglage que le journal ne touche pas est conservé');
ok(mine.journal === undefined, 'le format d’origine n’est pas modifié (copie, pas mutation)');
const rebond = applyJournalFormat(applied, 'angewandte');
eq(rebond.journal, 'angewandte', 'changer de journal change l’identifiant');
eq(rebond.order, JOURNAL_FORMATS.angewandte.order, '…et l’ordre des sections');
eq(rebond.preset, 'springer', '…et le preset de citation');
eq(applyJournalFormat(mine, 'nulle-part'), mine, 'un identifiant inconnu rend le format INTACT');
eq(applyJournalFormat(mine, ''), mine, '…comme un identifiant vide');
eq(journalOf(mine), '', 'un format sans journal ne prétend pas en avoir un');
eq(journalSectionOrder(mine), [], '…et n’impose aucun ordre de sections');
eq(journalSectionOrder(applied), JOURNAL_FORMATS.jacs.order, 'un format de journal, lui, en impose un');
const cleared = clearJournalFormat(applied, buildPubLayout());
eq(cleared.journal, undefined, '« As in the app » détache le journal');
eq(cleared.order, undefined, '…et son ordre de sections');
eq('bibLabel' in cleared, false, '…et le titre de bibliographie du journal');
eq(cleared.layout.body.font, '', '…et le caractère redevient vide (aucune règle écrite)');
eq(cleared.inTextStyle, 'superscript', '…mais le reste du format est conservé');
eq(PUB_LAYOUT_PARTS.length, 7, 'les sept parties du document sont toujours celles du panneau');

/* ══ 3. L'ORDRE DES SECTIONS SUR UN DOCUMENT RÉEL ═════════════════════════ */
const H2 = (t) => `<h2 class="pf-heading">${t}</h2>`;
const doc = [
  '<h1>Titre</h1>',
  H2('Introduction'), '<p>intro</p>',
  H2('Materials and Methods'), '<p>methods</p>',
  H2('Results and Discussion'), '<p>results</p>',
  H2('Conclusion'), '<p>conclusion</p>',
  H2('References (12)'), '<ol class="pf-bib"><li>ref</li></ol>',
].join('');
eq(reorderDocHtml(doc, JOURNAL_FORMATS.jacs.order), doc,
  'JACS : un document déjà dans l’ordre du journal ne bouge pas');
const ang = reorderDocHtml(doc, JOURNAL_FORMATS.angewandte.order);
const posOf = (html, t) => html.indexOf(t);
ok(posOf(ang, 'Results and Discussion') < posOf(ang, 'Materials and Methods'),
  'Angewandte : les résultats remontent AVANT le matériel et méthodes');
ok(posOf(ang, 'Conclusion') < posOf(ang, 'References'),
  '…et la conclusion reste avant la bibliographie');
ok(posOf(ang, '<h1>Titre</h1>') === 0, 'le titre du document ne bouge pas');
['Introduction', 'Materials and Methods', 'Results and Discussion', 'Conclusion', 'References (12)',
  '<p>intro</p>', '<p>methods</p>', '<p>results</p>', '<p>conclusion</p>', '<li>ref</li>']
  .forEach((piece) => ok(ang.includes(piece), `« ${piece} » survit au réordonnancement`));
eq(ang.length, doc.length, 'la taille du document est identique (rien n’est coupé ni dupliqué)');
const withFunding = doc.replace(H2('Conclusion'), `${H2('Conclusion')}<p>c</p>${H2('Funding')}<p>f</p>`);
const ang2 = reorderDocHtml(withFunding, JOURNAL_FORMATS.angewandte.order);
ok(ang2.includes('Funding') && ang2.length === withFunding.length,
  'une section que le journal ne nomme pas reste dans le document, sans rien perdre');
eq(reorderDocHtml(doc, []), doc, 'sans ordre, le document est rendu TEL QUEL');
eq(reorderDocHtml(doc, null), doc, '…comme sans ordre du tout (null)');
const foreign = '<h2>Mes propres titres</h2><p>a</p><h2>Et un autre</h2><p>b</p>';
eq(reorderDocHtml(foreign, JOURNAL_FORMATS.jacs.order), foreign,
  'des titres que le journal ne connaît pas : le document sort IDENTIQUE');
eq(reorderDocHtml('', JOURNAL_FORMATS.jacs.order), '', 'une chaîne vide ne casse rien');

/* LE JOURNAL CHANGE AUSSI LES INTITULÉS DES SECTIONS — la demande : « if in the journal
   science the scientific background is called introduction, this must change in the
   “Document sections (order & titles)” section » — ET PEUT LAISSER UNE SECTION SANS
   INTITULÉ : « if in the style of science references have no title then the title tick
   must be unchecked in the “References (citation & bibliography)” section ». */
{
  const scie = applyJournalFormat(buildPubFormat('nature'), 'science');
  eq(scie.docTitles.background, 'Introduction',
    'Science appelle le contexte « Introduction » : la rangée « Scientific background » du panneau suit (« scientific background is called introduction »)');
  eq(scie.docNoTitle, ['references'],
    '…et sa bibliographie n’écrit pas d’intitulé : la case du panneau est décochée');
  eq(scie.bibLabel, '', '…ce que le format dit aussi par `bibLabel` vide (il voyage avec lui)');
  JOURNAL_IDS.filter((id) => id !== 'science').forEach((id) => {
    const fmt = applyJournalFormat(buildPubFormat('nature'), id);
    eq(fmt.docNoTitle, [], `${id} : sa bibliographie a un intitulé (la case reste cochée)`);
    eq(pubDocTitleKeywords(fmt).references === '', false,
      `${id} : …donc le document écrit bien un « <h2> » au-dessus de sa liste`);
  });
  eq(pubDocTitleKeywords(scie).references, '',
    'un style sans intitulé retire le `<h2>` de la bibliographie sur un document déjà écrit (voir reorderDocHtml)');
  eq(clearJournalFormat(scie, buildPubLayout()).docNoTitle, [],
    '« ↺ As in the app » rallume l’intitulé de la bibliographie');
}

/* ══ 4. LE BRANCHEMENT DANS L'APPLICATION ═════════════════════════════════ */
const PUB = readFileSync('./src/components/Publications.jsx', 'utf8');
const DOC = readFileSync('./src/components/AppModules/projectDetailModule.jsx', 'utf8');
ok(PUB.includes("from './journalFormats'"), 'le panneau importe les formats de journal');
ok(PUB.includes('const pubSetJournal = (id) => {'), '…et le changement de journal a son geste');
ok(PUB.includes('Journal preset:'), '…avec la ligne « Journal preset » dans le panneau Publication format');
ok(PUB.includes('{JOURNAL_IDS.map((id) => ('), '…qui liste les journaux');
ok(PUB.includes('Journal — references, typography, section order and titles'),
  '…dans un groupe à part : choisir un journal refait la citation, le caractère, l’ordre des sections ET leurs intitulés (« it does not seem to act on the styles and order of the sections »)');
ok(!PUB.includes('<optgroup label="Bibliography style — the references only">'),
  '…et le groupe « Bibliography style — the references only » a disparu (« you can remove … because now it has become obsolete »)');
ok(PUB.includes('onChange={(e) => pubSetJournalChoice(e.target.value)}'),
  '…les deux passent par UN SEUL contrôle');
ok(!PUB.includes('Submit to:'), '…l’ancienne ligne « Submit to », dont la fonction était unclear, est retirée');
ok(PUB.includes('const style = fmt && fmt.style && pubStyles[fmt.style] ? fmt.style : \'\';'),
  '…dont la valeur affichée suit le STYLE rappelé, puis le journal choisi, et sinon le style de bibliographie');
ok(PUB.includes('My styles — saved by you (Custom)') === false && PUB.includes('User defined')
  && PUB.includes('💾 Save style…')
  && PUB.includes('const pubRecallStyle = (name) => {'),
'…et un groupe « User defined » pour les styles que l’utilisateur sauvegarde (sauver, rappeler, oublier)');
ok(PUB.includes('setActiveFormat({ ...withPreset, layout: normalizePubLayout(withPreset.layout) })'),
  '…et applique le tout au format ACTIF (défaut ou projet)');
ok(PUB.includes('journalOf(activeFormat) && (') && PUB.includes("journalSectionOrder(activeFormat).join(' → ')"),
  '…en rappelant l’ordre des sections du journal choisi (dans l’infobulle)');
ok(PUB.includes('📰 {journalLabelOf(journalOf(activeFormat))}'),
  '…et sans phrase explicative : la demande « remove all this explanatory text » a retiré les paragraphes du panneau');
ok(DOC.includes('bodyHtml = reorderDocHtml(bodyHtml, docOrderWords(pubFormat), pubDocTitleKeywords(pubFormat));'),
  'le document EXPORTÉ / IMPRIMÉ suit l’ORDRE CHOISI au panneau (celui du journal vient après, voir docOrderWords) et les intitulés choisis');
ok(DOC.indexOf('bodyHtml = reorderDocHtml(') > DOC.indexOf('const projectDocBodyHtml = () => {'),
  '…dans la fabrication du corps exporté (impression, PDF et .docx — voir _pub_docx_export_test.mjs)');
ok(DOC.indexOf('bodyHtml = reorderDocHtml(') < DOC.indexOf('const title = `${project.name} — project document`;'),
  '…après la réparation des références et avant l’écriture de la page');
ok(DOC.includes('const bodyHtml = projectDocBodyHtml();'),
  '…et l’impression / le PDF en descend (la page écrite est celle-là)');
ok(DOC.includes('journalSectionOrder, reorderDocHtml'), '…grâce au ré-export de Publications');
ok(PUB.includes('JOURNAL_FORMATS, JOURNAL_IDS, applyJournalFormat, clearJournalFormat,'),
  'les formats de journal sont ré-exportés par le bloc du paquet');

/* ══ 5. LA ZONE « REFERENCES » SUIT LE JOURNAL ═══════════════════════════════
   Signalé : « se imposto uno stile di giornale nel publication format, questo non
   ha effetto sulla zona delle references. Per esempio in Science il title non
   viene messo, ma se imposto su Science il tick sul title rimane e quindi nel
   documento finale ho i titoli che non dovrebbero esserci. » Deux choses suivent
   donc le journal : LES CHAMPS d'une référence (les ticks du panneau) et
   L'ÉCRITURE DES NOMS d'auteurs. */
{
  const scie = journalPubFields(JOURNAL_FORMATS.science);
  const titleRow = scie.find((f) => f.id === 'title');
  ok(titleRow && titleRow.enabled === false,
    'Science : le champ « Title » est ÉTEINT — le tick de la rubrique « References (citation & bibliography) » s\'éteint');
  ok(scie.some((f) => f.id === 'title'),
    '…mais la LIGNE du titre reste dans le panneau : elle est décochée, pas retirée (on peut la rallumer)');
  eq(scie.filter((f) => f.enabled).map((f) => f.id), ['authors', 'journal', 'volume', 'pages', 'year'],
    '…et les autres champs de la référence sont intacts');
  JOURNAL_IDS.filter((id) => id !== 'science').forEach((id) => {
    ok(journalPubFields(JOURNAL_FORMATS[id]).every((f) => f.enabled),
      `${id} : aucun champ de référence n'est éteint (Science est la seule à ne pas imprimer le titre)`);
  });
  const applied = applyJournalFormat(buildPubFormat('nature'), 'science');
  eq(applied.fields.map((f) => `${f.id}${f.enabled ? '' : '(off)'}`),
    ['authors', 'title(off)', 'journal', 'volume', 'pages', 'year'],
    'un journal arrivé au format écrit ses champs : ceux qu\'il porte, et ceux qu\'il éteint');
  const pub = {
    authors: 'Rossi M, Bianchi A', year: '2024', title: 'Un titre qui ne doit pas sortir',
    journal: 'Science', volume: '1', pages: '2'
  };
  const cited = pubCitationText(pub, applied, []);
  ok(!cited.includes('Un titre'),
    '…et la citation n\'imprime plus le titre : « nel documento finale ho i titoli che non dovrebbero esserci »');
  ok(cited.includes('Rossi'), '…les auteurs, eux, sont bien là');
  const jacs = applyJournalFormat(buildPubFormat('nature'), 'jacs');
  ok(pubCitationText(pub, jacs, []).includes('Un titre'),
    'JACS, lui, garde le titre (et prend le DOI de son preset : la citation change vraiment)');
  ok(journalPubFields(JOURNAL_FORMATS.jacs).some((f) => f.id === 'doi'),
    '…le champ DOI existe dans sa liste de champs');
}

/* ══ 6. L'ÉCRITURE DES NOMS D'AUTEURS EST CELLE DU JOURNAL ═══════════════════
   « se cito una pubblicazione a volte c'è nome e cognome e a volte solo cognome
   ed iniziali. Quindi la parte di autori rimane nel formato del giornale dove è
   stato pubblicato. » Une liste importée de Crossref (« John A. Smith ») et une
   liste importée de PubMed (« Smith JA ») s'écrivent désormais comme LE JOURNAL
   CHOISI le demande. */
{
  JOURNAL_IDS.forEach((id) => {
    const fmt = applyJournalFormat(buildPubFormat('nature'), id);
    ok(NAME_STYLE_IDS.includes(fmt.nameStyle), `${id} : le journal porte une écriture de noms connue (${fmt.nameStyle})`);
  });
  const pub = {
    authors: 'John A. Smith, Maria Rossi', year: '2024', title: 'T',
    journal: 'J', volume: '1', pages: '2'
  };
  const textOf = (id) => pubCitationText(pub, applyJournalFormat(buildPubFormat('nature'), id), []);
  ok(textOf('science').startsWith('J. A. Smith, M. Rossi'), 'Science écrit « J. A. Smith » (initiales d\'abord)');
  ok(textOf('jacs').startsWith('Smith, J. A., Rossi, M.'), 'JACS écrit « Smith, J. A. » (nom, virgule, initiales)');
  ok(textOf('pnas').startsWith('Smith JA, Rossi M'), 'PNAS écrit « Smith JA » (nom puis initiales)');
  eq(normalizeNameStyle(buildPubFormat('nature').nameStyle), 'asis',
    'un format qui n\'a choisi AUCUN journal ne réécrit rien (« as written » : les citations d\'avant sont intactes)');
  eq(applyJournalFormat(buildPubFormat('nature'), 'science').nameStyle,
    JOURNAL_FORMATS.science.names, '…et le choix du journal revient à son entrée `names`');
}

/* LE PANNEAU PORTE CES DEUX RÉGLAGES (la rubrique « References ») */
ok(PUB.includes('Author names'),
  'le panneau a sa ligne « Author names » dans la rubrique « References (citation & bibliography) »');
ok(PUB.includes('{NAME_STYLES.map((s) => {') && PUB.includes('pubPatchFormat({ nameStyle: s.id })'),
  '…avec un bouton par écriture (« as written », « Smith JA », « Smith J. A. », « J. A. Smith », « Smith, J. A. »)');
ok(PUB.includes('nameStyle: normalizeNameStyle(activeFormat.nameStyle)'),
  '…et le choix survit au réglage d\'un champ de la citation (pubCustomFormat)');
ok(PUB.includes('NAME_STYLES, normalizeNameStyle'),
  '…le panneau importe les écritures du paquet (comme le reste du format)');

console.log(`_journal_formats_test.mjs — ${passed} assertions passed`);
