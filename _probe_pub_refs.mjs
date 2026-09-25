/* sonde jetable : que fait VRAIMENT le choix d'un journal sur la zone « References » ? */
import { register } from 'node:module';
register('./_esm_test_hook.mjs', import.meta.url);
const { JOURNAL_FORMATS, applyJournalFormat, reorderDocHtml } = await import('./src/components/journalFormats.js');
const {
  buildPubFormat, pubDocTitleKeywords, normalizePubLayout,
  pubCitationText, pubCitationData, pubFieldValue
} = await import('./src/components/pubCitation.js');

const active = { ...buildPubFormat('nature') };
const show = (label, fmt) => {
  console.log(`\n== ${label}`);
  console.log('  docNoTitle :', JSON.stringify(fmt.docNoTitle));
  console.log('  bibLabel   :', JSON.stringify(fmt.bibLabel));
  console.log('  preset     :', fmt.preset);
  console.log('  fields     :', (fmt.fields || []).map((f) => `${f.id}${f.enabled ? '' : '(off)'}[${f.style}|${f.prefix}|${f.suffix}]`).join(' '));
  console.log('  titles map :', JSON.stringify(pubDocTitleKeywords(fmt)));
};

show('nature (partenza)', active);
['science', 'jacs', 'cell', 'nature', 'pnas'].forEach((id) => {
  const def = JOURNAL_FORMATS[id];
  const withPreset = applyJournalFormat({
    ...active,
    ...buildPubFormat(def.preset),
    docOrder: active.docOrder,
    docTitles: active.docTitles
  }, id);
  show(`journal ${id}`, { ...withPreset, layout: normalizePubLayout(withPreset.layout) });
});

/* LE DOCUMENT : le <h2> de la bibliographie est-il vraiment retiré ? */
const scie = { ...applyJournalFormat({ ...active, ...buildPubFormat('science') }, 'science') };
const DOC = '<h1 class="pf-title">T</h1><h2 class="pf-heading">Introduction</h2><p>a</p>'
  + '<h2 class="pf-heading">References</h2><ol class="pf-bib"><li>r1</li></ol>';
console.log('\n== reorderDocHtml avec le format Science');
console.log(reorderDocHtml(DOC, JOURNAL_FORMATS.science.order, pubDocTitleKeywords(scie)));
console.log('\n== reorderDocHtml avec le format Science et l’ordre du PROGRAMME (aucun mot de journal)');
console.log(reorderDocHtml(DOC, [], pubDocTitleKeywords(scie)));

/* LES AUTEURS : ce qu’une citation imprime selon la provenance de la liste */
const conventions = [
  'Smith JA, Rossi M',                       // PubMed / RIS (convention du labo)
  'John A. Smith, Maria Rossi',              // Crossref / OpenAlex
  'Smith, John A.; Rossi, Maria',            // éditeur « Nom, Prénom »
  'J. A. Smith and M. Rossi'                 // Science / Elsevier
];
console.log('\n== auteurs : ce que la citation imprime (preset science)');
conventions.forEach((raw) => {
  const pub = pubCitationData({ authors: raw, year: '2024', title: 'A title', journal: 'X', volume: '1', pages: '2' }, []);
  console.log(`  ${raw.padEnd(34)} -> ${pubCitationText(pub, scie, [])}`);
});
console.log('\n  valeur du champ « authors » dans pubCitationData :', pubFieldValue(pubCitationData({ authors: 'John A. Smith' }, []), 'authors'));
