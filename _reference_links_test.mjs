/* =========================================================================
   _reference_links_test.mjs — les « [12] » d'un texte deviennent des LIENS.

   Ce qui a coûté le plus cher à l'import d'un manuscrit : la bibliographie
   arrivait bien, mais les numéros qu'elle explique restaient des NOMBRES MORTS
   dans le texte. Le module src/utils/referenceLinks.js les rattache à leur
   référence — et cette vérification couvre les pièges qui rendraient la
   fonction nuisible plutôt qu'utile :
     • un numéro que le projet NE CONNAÎT PAS doit rester intact (pas de lien mort) ;
     • la transformation doit être IDEMPOTENTE (les sections sont réenregistrées
       à chaque import, et « 🔗 Link citations » peut être pressé dix fois) ;
     • elle ne doit JAMAIS toucher aux balises ni au contenu d'un lien existant.
   ========================================================================= */
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);

const RL = await import('./src/utils/referenceLinks.js');
const MS = await import('./src/utils/manuscriptImport.js');

let passed = 0;
const eq = (actual, expected, what) => {
  assert.deepEqual(actual, expected, what);
  passed += 1;
};
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };

const REFS = [
  { id: 'r1', number: 1, title: 'Characterization of a potyvirus', authors: 'Rossi M, Bianchi A', year: '2018' },
  { id: 'r2', number: 2, title: 'Aphid transmission of viruses', authors: 'Dupont J', year: '2020' },
  { id: 'r5', number: 5, title: 'Pepper crops and their viruses', authors: 'Bianchi A', year: '2021' }
];
const NUMBERS = RL.referenceNumbers(REFS);

/* ── 1. La mécanique : un numéro connu devient un lien vers son ancre ─────── */
eq(RL.referenceNumbers(REFS), new Set([1, 2, 5]), 'les numéros du projet sont une liste de travail');
eq(RL.referenceNumbers([{ number: 0 }, { number: '' }, null]), new Set([]),
  'un numéro vide ou 0 n’est pas une référence');
eq(RL.citationAnchorId(12), 'ref-12', 'l’ancre d’une référence est #ref-n');
const one = RL.linkCitationNumbers('<p>As shown before [2].</p>',
  { numbers: NUMBERS, titleFor: RL.citationTitleGetter(REFS) });
ok(one.includes('<a class="cite-ref" href="#ref-2" data-ref="2"'), 'une citation devient un lien vers son ancre');
ok(one.includes('title="Dupont J · Aphid transmission of viruses (2020)"'), '…avec la référence en infobulle');
ok(one.includes('[<a') && one.includes('</a>]'), 'le numéro reste VISIBLE entre ses crochets (lisible à l’impression)');

/* ── 2. Les formes réelles : [1,2], [1;2], [5-7] ──────────────────────────── */
const list = RL.linkCitationNumbers('Text [1,2] and [1;2] and [5-7].', { numbers: NUMBERS });
eq((list.match(/data-ref="1"/g) || []).length, 2, '« [1,2] » et « [1;2] » sont deux fois liés');
ok(list.includes('data-ref="2"'), '…et chacun de leurs numéros');
eq(RL.linkCitationNumbers('See [5-7].', { numbers: NUMBERS }).includes('data-ref="7"'), false,
  'une plage n’est liée que si TOUS ses numéros existent (5-7 : 6 et 7 manquent)');
eq(RL.linkCitationNumbers('See [2-3].', { numbers: NUMBERS }), 'See [2-3].',
  '…et le texte reste alors EXACTEMENT tel quel');

/* ── 3. Aucun lien mort, aucun dégât ─────────────────────────────────────── */
eq(RL.linkCitationNumbers('As shown in [12].', { numbers: NUMBERS }), 'As shown in [12].',
  'un numéro absent du projet reste un nombre (pas de lien mort)');
eq(RL.linkCitationNumbers('As shown in [2].', { numbers: new Set() }), 'As shown in [2].',
  'sans aucune référence, rien n’est touché');
eq(RL.linkCitationNumbers('', { numbers: NUMBERS }), '', 'un champ vide reste vide');
eq(RL.linkCitationNumbers('<p>No citation here.</p>', { numbers: NUMBERS }), '<p>No citation here.</p>',
  'un texte sans citation n’est pas réécrit');
const already = '<p><a href="https://doi.org/10.1000/xyz">[1]</a> is linked already.</p>';
eq(RL.linkCitationNumbers(already, { numbers: NUMBERS }), already,
  'le contenu d’un lien existant n’est jamais retouché');

/* ── 4. Idempotence : rejouer la transformation ne change rien ───────────── */
const source = '<p>First [1], then [2] and finally [1,2].</p>';
const once = RL.linkCitationNumbers(source, { numbers: NUMBERS });
eq(RL.linkCitationNumbers(once, { numbers: NUMBERS }), once, 'la transformation est idempotente (deux fois = une fois)');
eq([...RL.linkedCitationNumbers(once)].sort(), [1, 2], 'on sait compter les citations déjà liées');
eq(RL.linkedCitationNumbers(source).size, 0, '…et zéro avant');

/* ── 5. Toutes les sections d'un coup (bouton « 🔗 Link citations ») ─────── */
const sections = [
  { id: 'background', html: '<p>Introduction [1].</p>' },
  { id: 'discussion', html: '<p>Discussion [2] and [9].</p>' },
  { id: 'funding', html: '' },
  { id: 'conclusions', html: '<p>Nothing to link.</p>' }
];
const res = RL.linkCitationsInSections(sections, REFS);
eq(Object.keys(res.patch).sort(), ['background', 'discussion'], 'seules les sections qui changent sont réécrites');
eq(res.updated, 2, '…et on sait combien');
eq(res.added, 2, 'le nombre de citations nouvellement liées est annoncé');
ok(res.patch.discussion.includes('data-ref="2"') && res.patch.discussion.includes('[9]'),
  'le numéro inconnu (9) reste dans le texte, sans lien');
eq(res.patch.background, sections[0].html.replace('[1].', '[<a class="cite-ref" href="#ref-1" data-ref="1" '
  + 'title="Rossi M, Bianchi A · Characterization of a potyvirus (2018)">1</a>].'),
  'le texte attendu est produit, citation par citation');
eq(RL.linkCitationsInSections(sections, []).updated, 0, 'sans référence, le bouton ne touche à rien');
const onceMore = RL.linkCitationsInSections(
  [{ id: 'background', html: RL.linkCitationNumbers('<p>Already [1].</p>', { numbers: NUMBERS }) }], REFS
);
eq([onceMore.updated, onceMore.added], [0, 0], 'un texte déjà lié n’est plus retravaillé');

/* ── 6. Le marqueur [n] est bien celui que produit l'import du manuscrit ──── */
const converted = MS.convertCitationsInText(
  'Pepper crops are affected [3] and aphids transmit it [2,4].',
  new Map([['#2', 1], ['#3', 2], ['#4', 5]])
);
eq(converted.text, 'Pepper crops are affected [2] and aphids transmit it [1,5].',
  'l’import a réécrit les citations du document avec les numéros du projet');
const linkedImport = RL.linkCitationNumbers(`<p>${converted.text}</p>`, { numbers: NUMBERS });
ok(linkedImport.includes('data-ref="2"') && linkedImport.includes('data-ref="1"') && linkedImport.includes('data-ref="5"'),
  'les marqueurs du manuscrit importé deviennent donc des liens (bout en bout)');

console.log(`✅ ${passed} tests passés (liens de citation [n] ↔ références)`);
