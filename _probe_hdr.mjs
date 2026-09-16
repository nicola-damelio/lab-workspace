/* _probe_hdr.mjs — DIAGNOSTIC (comme _probe_cites.mjs) :
     • quelles en-têtes de manuscrit l'import reconnaît-il (titre / auteurs /
       affiliations), selon la façon dont chaque éditeur écrit ses marqueurs ?
     • le titre des références « … et al. Titre. Journal vol, pages (année). »
     • une AFFILIATION (même numérotée) n'est jamais une référence.
   Usage : node _probe_hdr.mjs */
import { register } from 'node:module';
register('./_esm_test_hook.mjs', import.meta.url);

const RI = await import('./src/utils/referenceImport.js');
const MI = await import('./src/utils/manuscriptImport.js');

const show = (label, value) => console.log(`  ${label} : ${value}`);

/* ── A. Les deux références signalées ──────────────────────────────────── */
const refs = [
  'Lu, W.-J. et al. Mortalin-p53 interaction in cancer cells is stress dependent and constitutes a selective target for cancer therapy. Cell Death Differ 18, 1046-1056 (2011).',
  'Kussie, P. H. et al. Structure of the MDM2 oncoprotein bound to the p53 tumor suppressor transactivation domain. Science 274, 948-953 (1996).',
  '1. Lu, W.-J. et al. Mortalin-p53 interaction in cancer cells is stress dependent and constitutes a selective target for cancer therapy. Cell Death Differ 18, 1046-1056 (2011).'
];
console.log('=== A. TITRE DES RÉFÉRENCES « et al. Titre. Journal » ===');
refs.forEach((r) => {
  const e = RI.bibliographyBlockToEntry(r);
  console.log(`  raw   : ${r}`);
  show('title', `« ${e.title} »`);
  show('auth ', `« ${e.authors} » | journal « ${e.journal} » | vol ${e.volume} | p ${e.pages} | ${e.year} | n°${e.number}`);
});

/* ── B. En-têtes de manuscrit ──────────────────────────────────────────── */
const headers = {
  'nature-sup': `Aphid transmission of a new potyvirus infecting pepper crops in Italy
Mario Rossi1, Anna Bianchi1, Jean Dupont2
1 Dipartimento di Agraria, Universita di Napoli Federico II, Portici, Italy
2 INRAE, UMR Biologie du Fruit, Villenave d'Ornon, France
mario.rossi@unina.it`,
  'wiley-letters': `Aphid transmission of a new potyvirus infecting pepper crops
Mario Rossia, Anna Bianchib, Jean Dupontc
aDipartimento di Agraria, Universita di Napoli, Portici, Italy
bINRAE, Villenave d'Ornon, France`,
  'elsevier-spaced-letters': `Aphid transmission of a new potyvirus in pepper
Mario Rossi a, Anna Bianchi b,*, Jean Dupont c
a Dipartimento di Agraria, Universita di Napoli, Italy
b INRAE, Villenave d'Ornon, France
* Corresponding author: mario.rossi@unina.it`,
  'one-author-per-line': `Aphid transmission of a new potyvirus in pepper crops
Mario Rossi1
Anna Bianchi2
Jean Dupont1
1 Dipartimento di Agraria, Universita di Napoli, Italy
2 INRAE, Villenave d'Ornon, France`,
  'correspondance-last': `Aphid transmission of a new potyvirus in pepper crops of southern Italy
Mario Rossi1, Anna Bianchi1, Jean Dupont2
1 Dipartimento di Agraria, Universita di Napoli, Portici, Italy
2 INRAE, UMR Biologie du Fruit, Villenave d'Ornon, France
Correspondence: mario.rossi@unina.it
Abstract
The potyvirus was transmitted by aphids.`,
  'docx-brackets': `Aphid transmission of a new potyvirus in pepper crops
Mario Rossi[1], Anna Bianchi[1], Jean Dupont[2]
1 Dipartimento di Agraria, Universita di Napoli, Portici, Italy
2 INRAE, Villenave d'Ornon, France`,
  'no-markers-three': `Aphid transmission of a new potyvirus in pepper crops
Mario Rossi, Anna Bianchi, Jean Dupont
Dipartimento di Agraria, Universita di Napoli, Portici, Italy
INRAE, Villenave d'Ornon, France`,
  'two-authors-no-marker': `Aphid transmission of a new potyvirus in pepper crops
Mario Rossi, Anna Bianchi
Dipartimento di Agraria, Universita di Napoli, Portici, Italy`
};
console.log('\n=== B. EN-TÊTES DE MANUSCRIT ===');
Object.entries(headers).forEach(([name, text]) => {
  const h = MI.parseManuscriptHeader(MI.blocksFromText(text));
  console.log(`  ── ${name}`);
  show('title', `« ${h.title} »`);
  show('auth ', `« ${h.authors} »`);
  show('affil', `« ${(h.affiliations || '').replace(/\n/g, ' | ')} »`);
});

/* ── C. Les AFFILIATIONS : jamais des références ───────────────────────── */
const affilText = `1 Dipartimento di Agraria, Universita di Napoli Federico II, Portici, Italy
2 INRAE, UMR Biologie du Fruit, Villenave d'Ornon, France
3 Department of Plant Pathology, 2015 Upper Street, Raleigh, NC 27695, USA
* Corresponding author: mario.rossi@unina.it`;
console.log('\n=== C. AFFILIATIONS LUES COMME BIBLIOGRAPHIE (attendu : rien) ===');
const asRefs = RI.parseReferences(affilText, { split: 'line', keepAll: true });
console.log(asRefs.length
  ? asRefs.map((e) => `  title « ${e.title} » | n°${e.number}`).join('\n')
  : '  aucune référence : c’est le comportement voulu');

