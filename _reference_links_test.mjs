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
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);

const RL = await import('./src/utils/referenceLinks.js');
const MS = await import('./src/utils/manuscriptImport.js');
const REF = await import('./src/utils/referenceImport.js');
/* La page projet est lue telle quelle : les branchements (import → numérotation,
   export → réparation d'un document enregistré) doivent y être VÉRIFIABLES. */
const PAGE = readFileSync('./src/components/AppModules/projectDetailModule.jsx', 'utf8');

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

/* ── 5 bis. Les AUTRES écritures d'une citation : (12) et l'exposant ─────────
   Le bouton ne servait à rien sur un article écrit au style EndNote/Word : ses
   renvois sont « (12) » ou un exposant — « previously¹² », « previously<sup>12>
   </sup> » — jamais des crochets. Ces trois écritures doivent donc être
   reconnues, et GARDER leur apparence (le numéro reste à sa place).          */
const endnote = RL.linkCitationNumbers('<p>As shown previously (2) and (1,2).</p>', { numbers: NUMBERS });
eq((endnote.match(/data-ref="2"/g) || []).length, 2, '« (2) » et « (1,2) » sont liés (style EndNote/Word)');
ok(endnote.includes('(<a class="cite-ref" href="#ref-2" data-ref="2">2</a>)'),
  '…et la parenthèse reste une parenthèse autour du numéro');
eq(RL.linkCitationNumbers('<p>See (9) there.</p>', { numbers: NUMBERS }), '<p>See (9) there.</p>',
  'un numéro inconnu entre parenthèses reste intact (aucun lien mort)');

const sup = RL.linkCitationNumbers('<p>As shown previously<sup>2</sup>.</p>', { numbers: NUMBERS });
eq(sup, '<p>As shown previously<sup><a class="cite-ref" href="#ref-2" data-ref="2">2</a></sup>.</p>',
  'un exposant HTML reste un exposant, avec le lien DEDANS');
const uni = RL.linkCitationNumbers('<p>As shown previously¹,².</p>', { numbers: NUMBERS });
eq(uni, '<p>As shown previously<a class="cite-ref" href="#ref-1" data-ref="1">¹</a>,'
  + '<a class="cite-ref" href="#ref-2" data-ref="2">²</a>.</p>',
  'un exposant en chiffres Unicode devient un lien qui reste en exposant');

/* Le piège : un manuscrit est plein d’exposants qui ne sont PAS des citations.
   Les lier abîmerait le texte de l’auteur — ils doivent rester intacts. */
eq(RL.linkCitationNumbers('<p>Area in m<sup>2</sup>.</p>', { numbers: NUMBERS }), '<p>Area in m<sup>2</sup>.</p>',
  '« m<sup>2</sup> » (mètre carré) n’est pas une citation, même si la référence 2 existe');
eq(RL.linkCitationNumbers('<p>The 2<sup>nd</sup> time.</p>', { numbers: NUMBERS }), '<p>The 2<sup>nd</sup> time.</p>',
  '« 2<sup>nd</sup> » (ordinal) non plus');
eq(RL.linkCitationNumbers('<p>Area in m² and Ca²⁺.</p>', { numbers: NUMBERS }), '<p>Area in m² and Ca²⁺.</p>',
  'ni « m² » ni « Ca²⁺ » (exposants Unicode collés à une unité ou un ion)');
eq(RL.linkCitationNumbers('<p>Diluted 10⁻³.</p>', { numbers: NUMBERS }), '<p>Diluted 10⁻³.</p>',
  'ni « 10⁻³ » (une puissance, pas un renvoi)');
eq(RL.linkCitationNumbers('<p>Amplitude sin(2) units.</p>', { numbers: NUMBERS }), '<p>Amplitude sin(2) units.</p>',
  'ni « sin(2) » : une parenthèse collée à un mot court est un appel de fonction');
eq(RL.linkCitationNumbers('<p>Published (2021) here.</p>', { numbers: NUMBERS }), '<p>Published (2021) here.</p>',
  'ni une année « (2021) » : un numéro de référence n’a jamais 4 chiffres');
ok(RL.linkCitationNumbers('<p>See<sup>1,2</sup> now.</p>', { numbers: NUMBERS }).includes('data-ref="1"'),
  'mais un exposant qui porte PLUSIEURS numéros est bien une citation');
eq(RL.linkCitationNumbers(endnote, { numbers: NUMBERS }), endnote, 'rejouer la transformation ne double pas les liens de (12)');
eq(RL.linkCitationNumbers(sup, { numbers: NUMBERS }), sup, '…ni ceux d’un exposant HTML');
eq(RL.linkCitationNumbers(uni, { numbers: NUMBERS }), uni, '…ni ceux d’un exposant Unicode');

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

/* Le même import, avec les deux autres écritures du document (EndNote/Word :
   parenthèses et exposant) : elles doivent arriver AU MÊME marqueur [n]. */
const convertedEndnote = MS.convertCitationsInText(
  'Aphids transmit it (3) as shown previously² and elsewhere [2].',
  new Map([['#2', 1], ['#3', 2]])
);
eq(convertedEndnote.text, 'Aphids transmit it [2] as shown previously[1] and elsewhere [1].',
  'parenthèses et exposants sont réécrits comme les [n] — le document exporté n’a plus qu’une écriture');
eq(convertedEndnote.replaced, 3, 'les trois renvois ont été convertis');
eq(convertedEndnote.unresolved, [], 'aucun renvoi laissé de côté');

/* ── 7. Une bibliographie IMPORTÉE (Paperpile, Word…) devient numérotée ─────
      Le défaut réparé : la bibliographie arrivait dans « Project bibliography »
      mais le projet n'avait aucune référence 12 — le « [12] » du texte menait
      dans le vide et le document exporté n'imprimait rien.               */
const paper = (title, extra = {}) => ({ title, authors: 'Rossi M', year: '2019', ...extra });
const fresh = RL.numberImportedReferences(
  [paper('First'), paper('Second'), paper('Third')], [], { hints: [1, 2, 3] }
);
eq(fresh.list.map((r) => r.number), [1, 2, 3],
  'une bibliographie numérotée « 1. … 2. … 3. … » reçoit CES numéros : le [1] du texte tombe juste');
eq(fresh.added, 3, 'les trois papiers sont annoncés comme ajoutés');
eq(fresh.created.length, 3, 'seules les références NOUVELLES sont rendues à part');
eq([fresh.list[0].title, fresh.list[0].year], ['First', '2019'], 'chaque référence garde son papier');
ok(fresh.list[0].id && fresh.list[0].id !== fresh.list[1].id, 'chaque référence reçoit un id unique');

const parsed = RL.numberImportedReferences([{ ...paper('Parsed'), number: 4 }], [], { makeId: () => 'r_new' });
eq([parsed.list[0].number, parsed.list[0].id], [4, 'r_new'],
  'le numéro lu devant l’entrée (« 12. Rossi… ») devient le numéro de la référence');

const after = RL.numberImportedReferences([paper('Later', { doi: '10.1/x' })], REFS);
eq(after.list.map((r) => r.number), [1, 2, 5, 6],
  'sans numéro dans le document, la référence prend le premier numéro APRÈS le plus grand (règle de l’import de manuscrit)');
eq(after.list[3].doi, '10.1/x', 'le DOI de l’entrée est conservé (les Publications le retrouvent)');

const clash = RL.numberImportedReferences([paper('Clashing')], [{ id: 'r2', number: 2, title: 'Taken' }], { hints: [2] });
eq(clash.list.map((r) => r.number), [2, 3], 'un numéro déjà pris n’est JAMAIS volé : l’entrée prend le suivant');
eq(clash.list[0].title, 'Taken', '…et la référence du projet n’est ni renommée ni renumérotée');

const dup = RL.numberImportedReferences(
  [{ title: 'Aphid transmission of viruses', authors: 'Dupont J' }, paper('Brand new')], REFS
);
eq([dup.added, dup.reused], [1, 1], 'un papier déjà référencé n’est pas dupliqué (même titre = même papier)');
eq(dup.list.length, REFS.length + 1, 'la liste complète ne gagne qu’une référence');
eq(RL.numberImportedReferences([paper('Twice'), paper('Twice')], []).added, 1,
  'le même papier deux fois dans un seul import ne fait qu’une référence');
eq(REFS.length, 3, 'les références du projet ne sont pas modifiées (copie)');

/* ── 8. Le document DÉJÀ ENREGISTRÉ reçoit les références manquantes ─────── */
const SAVED = '<div><h2 class="text-base">Bibliography (1)</h2><ol class="list-decimal pl-5">'
  + '<li id="ref-1" value="1">Rossi 2018</li></ol></div>';
const TO_ADD = [{ number: 2, html: 'Dupont 2020' }, { number: 3, html: 'Bianchi 2021' }];
const patched = RL.ensureReferenceEntries(SAVED, TO_ADD);
eq(patched.added, 2, 'les deux références absentes d’un document enregistré sont ajoutées');
ok(patched.html.includes('<li id="ref-2" value="2">Dupont 2020</li>'),
  'chaque entrée porte son ancre #ref-n et son numéro réel (l’ordre d’impression reste juste)');
ok(patched.html.indexOf('id="ref-2"') < patched.html.indexOf('</ol>'), 'elles entrent DANS la liste « Bibliography » existante');
ok(patched.html.includes('<li id="ref-1" value="1">Rossi 2018</li>'), '…sans toucher au texte déjà enregistré');
eq(RL.ensureReferenceEntries(patched.html, TO_ADD).added, 0, 'la réparation est idempotente (réexporter ne double rien)');
eq(RL.ensureReferenceEntries(SAVED, [{ number: 1, html: 'Rossi 2018' }]).added, 0,
  'une référence déjà présente (ancre #ref-1) n’est pas ajoutée deux fois');
const noBib = RL.ensureReferenceEntries('<p>Text</p>', [{ number: 9, html: 'Ninth' }]);
ok(noBib.added === 1 && noBib.html.includes('id="ref-9"'),
  'sans bibliographie dans le document enregistré, la référence est quand même ajoutée');
ok(noBib.html.indexOf('Bibliography') > noBib.html.indexOf('<p>Text</p>'), '…dans une bibliographie placée à la fin');
eq(RL.ensureReferenceEntries('<p>Text</p>', [{ number: 0, html: '' }, null]).added, 0,
  'une entrée sans numéro ou sans texte est ignorée');

/* ── 8 bis. LE DOCUMENT FIGÉ PERD SA BIBLIOGRAPHIE (elle est rendue À VIVANT) ─
   « ✏️ Edit text » → « 💾 Save changes » fige le document ENTIER, liste des
   références comprise : le « Publication format » choisi depuis ne s'y voyait
   donc jamais (« le publication format ne modifie pas le format des références
   dans le texte du projet »). La page affiche le document figé SANS sa
   bibliographie et imprime à sa place la liste vivante, rendue avec le format
   courant (voir withoutBibliographySection). */
const FROZEN = `<div class="mb-4"><h1>Titre</h1><p>Texte [1].</p></div>\n`
  + `<div class="mb-4"><h2 class="text-base">Bibliography (1)</h2>`
  + `<ol class="list-decimal pl-5"><li id="ref-1" value="1">Rossi 2018, ANCIEN FORMAT</li></ol></div>`;
const stripped = RL.withoutBibliographySection(FROZEN);
ok(!stripped.includes('ANCIEN FORMAT') && !stripped.includes('Bibliography'),
  'la bibliographie figée sort du document (titre, liste ET son cadre)');
ok(stripped.includes('<h1>Titre</h1>') && stripped.includes('Texte [1].'),
  '…et le texte de l’auteur reste intact, au caractère près');
ok(!stripped.includes('</div></div>') && stripped.trim().endsWith('</div>'),
  'le conteneur vide de la bibliographie ne reste pas non plus');
eq(RL.withoutBibliographySection(stripped), stripped, 'le nettoyage est idempotent');
eq(RL.withoutBibliographySection('<p>Un document sans bibliographie.</p>'), '<p>Un document sans bibliographie.</p>',
  'un document sans bibliographie ressort tel quel');
eq(RL.withoutBibliographySection(''), '', 'un document vide ne casse rien');
/* Une bibliographie sans cadre (document écrit à la main) est retirée aussi. */
const bare = RL.withoutBibliographySection('<p>Texte.</p><h2>Bibliography (2)</h2><ol><li id="ref-1">A</li></ol>');
ok(!bare.includes('Bibliography') && bare.includes('<p>Texte.</p>'),
  'un titre « Bibliography » sans cadre emporte quand même sa liste');

/* ── 9. La page projet applique bien ces deux branchements ──────────────── */
const has = (needle, what) => ok(PAGE.includes(needle), what);
has('const pickedEntries = (bibImport.picked || [])', 'l’import garde l’ORDRE du document pour numéroter');
has('const numbered = numberImportedReferences(completed.list, refs)',
  'le bouton « Import references » numérote les entrées importées (après les avoir complétées)');
has('references: numbered.list', '…et les enregistre dans les références du projet (donc imprimées)');
has('PROJECT_TEXT_SECTIONS.map((s) => ({ id: s.id, html: project[s.id] || \'\' })),',
  '…puis il lie les citations déjà écrites dans les sections');
has('ensureReferenceEntries(bodyHtml, refs.map((r) => ({', 'à l’export, un document enregistré est complété');
has('bodyHtml = linkCitations(repaired.html)', '…et ses citations sont liées avant l’impression');
has('<body>${bodyHtml}</body>', 'c’est bien ce document réparé qui part à l’imprimante');
has("the text sections hold no numbered citation — [1], (1) or a superscript 1 —",
  'et quand il n’y a rien à lier, le message DIT les trois écritures reconnues (et l’autre cause : un numéro absent des références)');

/* ── 10. Une référence ÉCRITE PARTIELLEMENT se lie comme les autres ──────────
   « 5. Lu W-J, et al. (2011). » — une entrée SANS TITRE, comme il en arrive
   dans une bibliographie abrégée. Elle était JETÉE à l'import : le « [5] » du
   texte n'avait donc plus rien à quoi se lier (« Nothing to link »). */
const partialEntries = REF.parseReferences('5. Lu W-J, et al. (2011).', { split: 'line' });
eq(partialEntries.length, 1, 'une référence numérotée sans titre est importée (elle ne disparaît plus)');
const partialNumbered = RL.numberImportedReferences(partialEntries, [], { makeId: () => 'r_partial' });
eq(partialNumbered.list[0].number, 5, '…et elle garde le numéro que le document lui donnait');
eq(partialNumbered.list[0].title, 'Untitled',
  '…son titre reste vide dans le projet (« Untitled » à l’affichage : rien n’est inventé)');
const partialLinked = RL.linkCitationNumbers('<p>As shown previously [5].</p>',
  { numbers: RL.referenceNumbers(partialNumbered.list) });
ok(partialLinked.includes('data-ref="5"'),
  '…donc « [5] » devient un lien vers elle (bout en bout) au lieu de « Nothing to link »');

console.log(`✅ ${passed} tests passés (liens de citation [n] ↔ références, import bibliographique numéroté, document exporté réparé)`);
