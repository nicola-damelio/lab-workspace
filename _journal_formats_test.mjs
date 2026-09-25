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
  journalLayoutPatches, journalOf, journalSectionOrder, reorderDocHtml
} = await import('./src/components/journalFormats.js');
const {
  PUB_FORMAT_PRESETS, PUB_LAYOUT_PARTS, PUB_LAYOUT_PART_IDS,
  buildPubFormat, buildPubLayout, normalizePubLayout, pubTextStyleIsSet
} = await import('./src/components/pubCitation.js');

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

/* ══ 4. LE BRANCHEMENT DANS L'APPLICATION ═════════════════════════════════ */
const PUB = readFileSync('./src/components/Publications.jsx', 'utf8');
const DOC = readFileSync('./src/components/AppModules/projectDetailModule.jsx', 'utf8');
ok(PUB.includes("from './journalFormats'"), 'le panneau importe les formats de journal');
ok(PUB.includes('const pubSetJournal = (id) => {'), '…et le changement de journal a son geste');
ok(PUB.includes('Journal preset:'), '…avec la ligne « Journal preset » dans le panneau Publication format');
ok(PUB.includes('{JOURNAL_IDS.map((id) => ('), '…qui liste les journaux');
ok(PUB.includes('Journal — references, typography and section order'),
  '…dans un groupe à part : choisir un journal refait la citation, le caractère ET l’ordre des sections (« it does not seem to act on the styles and order of the sections »)');
ok(PUB.includes('Bibliography style — the references only'),
  '…et un STYLE de bibliographie, dans son propre groupe, ne touche que les références');
ok(PUB.includes('onChange={(e) => pubSetJournalChoice(e.target.value)}'),
  '…les deux passent par UN SEUL contrôle');
ok(!PUB.includes('Submit to:'), '…l’ancienne ligne « Submit to », dont la fonction était unclear, est retirée');
ok(PUB.includes('const style = fmt && fmt.style && pubStyles[fmt.style] ? fmt.style : \'\';'),
  '…dont la valeur affichée suit le STYLE rappelé, puis le journal choisi, et sinon le style de bibliographie');
ok(PUB.includes('My styles — saved by you (Custom)') && PUB.includes('💾 Save style…')
  && PUB.includes('const pubRecallStyle = (name) => {'),
'…et un TROISIÈME groupe pour les styles que l’utilisateur sauvegarde (sauver, rappeler, oublier)');
ok(PUB.includes('setActiveFormat({ ...withPreset, layout: normalizePubLayout(withPreset.layout) })'),
  '…et applique le tout au format ACTIF (défaut ou projet)');
ok(PUB.includes('journalOf(activeFormat) && (') && PUB.includes("journalSectionOrder(activeFormat).join(' → ')"),
  '…en rappelant l’ordre des sections du journal choisi (dans l’infobulle)');
ok(PUB.includes('📰 {journalLabelOf(journalOf(activeFormat))}'),
  '…et sans phrase explicative : la demande « remove all this explanatory text » a retiré les paragraphes du panneau');
ok(DOC.includes('return reorderDocHtml(bodyHtml, docOrderWords(pubFormat), pubDocTitleKeywords(pubFormat));'),
  'le document EXPORTÉ / IMPRIMÉ suit l’ORDRE CHOISI au panneau (celui du journal vient après, voir docOrderWords) et les intitulés choisis');
ok(DOC.indexOf('bodyHtml = reorderDocHtml(') > DOC.indexOf('const projectDocBodyHtml = () => {'),
  '…dans la fabrication du corps exporté (impression, PDF et .docx — voir _pub_docx_export_test.mjs)');
ok(DOC.indexOf('bodyHtml = reorderDocHtml(') < DOC.indexOf('const title = `${project.name} — project document`;'),
  '…après la réparation des références et avant l’écriture de la page');
ok(DOC.includes('const bodyHtml = docExportBodyHtml();'),
  '…et l’impression / le PDF en descend (la page écrite est celle-là)');
ok(DOC.includes('journalSectionOrder, reorderDocHtml'), '…grâce au ré-export de Publications');
ok(PUB.includes('JOURNAL_FORMATS, JOURNAL_IDS, applyJournalFormat, clearJournalFormat,'),
  'les formats de journal sont ré-exportés par le bloc du paquet');

console.log(`_journal_formats_test.mjs — ${passed} assertions passed`);
