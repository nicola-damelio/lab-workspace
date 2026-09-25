/* =========================================================================
   _pub_style_presets_test.mjs — LE JOURNAL CHANGE TOUT, LES SECTIONS DE FIN ONT
   LEUR RANGÉE, ET « CUSTOM » SE SAUVEGARDE ET SE RAPPELLE.

   La demande, mot pour mot :
     • « when I select the journal preset, all the elements of the publication format
       must adapt to it, including the order of the sections. »
     • « when I click on custom I will be able to define other styles that I must be
       able to save and recall. »
     • « Note that conclusions, funding and supporting informations are at present not
       included in the sections of the publication format and they should. »

   CE QUI EST MESURÉ ICI, sur le code livré :
     §1 LES TROIS SECTIONS DE FIN sont des BLOCS du document (rangée, intitulé,
        déplacement, `section` = la section de texte du projet qu'elles impriment), et
        l'ordre du programme imprime TOUJOURS le même document qu'avant ;
     §2 LE VOCABULAIRE : `pubDocOrderKeywords` place chaque section à SA rangée, et le
        bloc « Text sections » ne porte plus que celles qui n'en ont pas (sinon elles
        seraient nommées deux fois) ;
     §3 LES INTITULÉS des trois nouvelles rangées s'écrivent sur un document déjà
        enregistré (`pubDocTitleKeywords` → `reorderDocHtml`) ;
     §4 LE JOURNAL ÉCRIT L'ORDRE DES SECTIONS (`docOrder`) et les intitulés qu'il nomme
        (`docTitles`) — JACS met l'Experimental Section avant la Conclusion, Nature
        après ; « ↺ As in the app » remet l'ordre du programme ;
     §5 LES STYLES « CUSTOM » : sauver, rappeler, oublier, et le nettoyage de ce qui
        arrive du stockage ;
     §6 LE CÂBLAGE : le panneau (Publications.jsx) offre le groupe « My styles » et ses
        deux gestes, et la page du projet (projectDetailModule.jsx) rend les trois
        nouvelles rangées.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

// Les sources de src/ s'importent sans extension (résolues par Vite) — même
// crochet que _pub_doc_sections_test.mjs.
register('./_esm_test_hook.mjs', import.meta.url);

/* UN localStorage DE BANC : les styles vivent dedans (voir PUB_STYLES_KEY). Il est
   posé AVANT l'import du module, comme dans la page. */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
  setItem: (k, v) => { store.set(String(k), String(v)); },
  removeItem: (k) => { store.delete(String(k)); },
  clear: () => { store.clear(); },
  key: (i) => [...store.keys()][i] || null,
  get length() { return store.size; },
};

const {
  PUB_DOC_BLOCKS, PUB_DOC_BLOCK_IDS, PUB_DOC_TITLED_IDS, PUB_DOC_FIXED_IDS,
  PUB_DOC_SECTION_BLOCKS, PUB_DOC_SECTION_IDS, PUB_DOC_HEAD_IDS, PUB_DOC_BLOCK_WORDS,
  buildPubDocOrder, buildPubDocTitles, buildPubFormat, normalizePubFormat,
  pubDocBlockOf, pubDocBlockOfSection, docBlockOfWord,
  pubDocOrderKeywords, pubDocTitleKeywords, pubDocOrderMoved, pubDocOrderDropped,
  pubDocOrderForWords, pubDocTitlesForWords,
  PUB_STYLES_KEY, normalizePubStyleName, normalizePubStyles,
  loadPubStyles, writePubStyles, savePubStyle, removePubStyle,
} = await import('./src/components/pubCitation.js');
const { JOURNAL_FORMATS, JOURNAL_IDS, applyJournalFormat, clearJournalFormat, journalSectionOrder } =
  await import('./src/components/journalFormats.js');
const { PROJECT_TEXT_SECTIONS } = await import('./src/utils/manuscriptImport.js');

let passed = 0;
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const eq = (a, b, what) => {
  assert.deepEqual(a, b, `${what}\n  attendu : ${JSON.stringify(b)}\n  obtenu  : ${JSON.stringify(a)}`);
  passed += 1;
};
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const PANEL = read('./src/components/Publications.jsx');
const PROJ = read('./src/components/AppModules/projectDetailModule.jsx');

/* ══ 1. LES TROIS SECTIONS DE FIN SONT DES BLOCS DU DOCUMENT ═════════════════ */
eq(PUB_DOC_BLOCK_IDS, ['title', 'authors', 'affiliations', 'meta', 'sections',
  'conclusions', 'funding', 'supporting', 'methods', 'experiments', 'references'],
'les conclusions, le financement et les informations supplémentaires ont leur rangée, entre les sections de texte et « Materials and Methods »');
eq(PUB_DOC_BLOCKS.length, 11, '…onze blocs nommés (huit avant)');
eq(PUB_DOC_TITLED_IDS, ['conclusions', 'funding', 'supporting', 'methods', 'experiments', 'references'],
'…et le programme écrit leur intitulé, comme celui de « Materials and Methods »');
eq(PUB_DOC_SECTION_IDS, ['conclusions', 'funding', 'supporting'],
'chaque rangée dit QUELLE section de texte du projet elle imprime');
eq(pubDocBlockOfSection('conclusions').id, 'conclusions', 'la section « conclusions » a sa rangée');
eq(pubDocBlockOfSection('supporting').label, 'Supporting information', '…comme les informations supplémentaires');
eq(pubDocBlockOfSection('background'), null, 'le contexte n’en a pas : il s’imprime dans « Text sections »');
eq(pubDocBlockOfSection('discussion'), null, '…et les résultats non plus');
eq(PUB_DOC_HEAD_IDS, ['title', 'authors', 'affiliations', 'meta'], 'les quatre blocs de tête sont nommés à part (un ordre de journal ne les touche pas)');
eq(PUB_DOC_FIXED_IDS, ['references'], 'la liste vivante des références reste le seul bloc fixe');
eq(!!pubDocBlockOf('funding').fixed, false, '…et le financement se déplace, lui');
eq(buildPubDocTitles(), {
  conclusions: 'Conclusions', funding: 'Funding', supporting: 'Supporting information',
  methods: 'Materials and Methods', experiments: 'Experiments', references: 'References',
}, 'un format neuf porte l’intitulé de chaque rangée');
eq(buildPubDocOrder(), PUB_DOC_BLOCK_IDS, 'l’ordre du programme suit celui du panneau');
/* L'ORDRE PAR DÉFAUT N'A PAS CHANGÉ POUR LE DOCUMENT : les trois blocs sont juste
   APRÈS « Text sections », donc le document s'imprime comme avant — le contexte, les
   résultats, les conclusions, le financement, les informations supplémentaires. */
const TEXT_ORDER = ['scientific background', 'results and discussion', 'conclusions', 'funding', 'supporting information'];
eq(pubDocOrderKeywords(buildPubDocOrder(), PROJECT_TEXT_SECTIONS).filter((w) => TEXT_ORDER.includes(w)),
  TEXT_ORDER,
  'l’ordre du programme imprime les cinq sections de texte dans le même ordre qu’avant (contexte et résultats par « Text sections », les trois autres par leur rangée)');
ok(PUB_DOC_BLOCK_WORDS.conclusions.includes('conclusion')
  && PUB_DOC_BLOCK_WORDS.funding.includes('acknowledgements')
  && PUB_DOC_BLOCK_WORDS.supporting.includes('supplementary information'),
'les mots des trois nouvelles rangées connaissent leurs synonymes (Conclusion, Acknowledgements, Supplementary information)');
eq(docBlockOfWord('experimental section'), 'methods', '« experimental section » désigne la rangée « Materials and Methods »');
eq(docBlockOfWord('acknowledgements'), 'funding', '…« acknowledgements » le financement');
eq(docBlockOfWord('abstract'), 'sections', '…et « abstract » / « introduction » désignent le bloc des sections de texte (un manuscrit importé nomme ainsi le contexte)');
ok(PUB_DOC_TITLED_IDS.every((id) => !!pubDocBlockOf(id).title), 'chaque rangée à intitulé en porte un (le champ du panneau a son repli)');

const has = (hay, needle, what) => ok(String(hay).includes(needle), `${what}\n  introuvable : ${needle}`);


/* ══ 2. LE VOCABULAIRE DE L'ORDRE ════════════════════════════════════════════
   Les mots que `reorderDocHtml` cherche dans un document : chaque section de texte
   est nommée À SA RANGÉE, et jamais deux fois. */
const byObjects = pubDocOrderKeywords(buildPubDocOrder(), PROJECT_TEXT_SECTIONS);
const byLabels = pubDocOrderKeywords(buildPubDocOrder(), PROJECT_TEXT_SECTIONS.map((s) => s.label));
eq(byObjects, byLabels,
  'le vocabulaire est le même que l’appelant donne les sections du projet avec leur id (la page) ou leurs seuls intitulés (le panneau, un test)');
TEXT_ORDER.forEach((word) => {
  eq(byObjects.filter((w) => w === word).length, 1, `« ${word} » n’est nommée qu’UNE fois (le bloc « Text sections » ne reprend pas les rangées dédiées)`);
});
ok(byObjects.indexOf('conclusions') < byObjects.indexOf('funding')
  && byObjects.indexOf('funding') < byObjects.indexOf('supporting information'),
'…et dans l’ordre du panneau : conclusions, financement, informations supplémentaires');
/* DÉPLACER UNE RANGÉE DÉPLACE SON MOT (c'est ce que le panneau montre). */
const supportFirst = (() => {
  let o = buildPubDocOrder();
  for (let i = 0; i < 3; i += 1) o = pubDocOrderMoved(o, 'supporting', -1);
  return o;
})();
eq(supportFirst.indexOf('supporting'), 4, 'la rangée « Supporting information » remonte de trois crans (elle passe devant les sections de texte)');
eq(supportFirst.slice(4, 7), ['supporting', 'sections', 'conclusions'], '…et se pose juste après la ligne d’information du projet');
const supportWords = pubDocOrderKeywords(supportFirst, PROJECT_TEXT_SECTIONS);
ok(supportWords.indexOf('supporting information') < supportWords.indexOf('scientific background'),
  '…et le mot des informations supplémentaires passe devant celui du contexte : le document suivra');
eq(pubDocOrderKeywords(['funding', 'sections', 'methods'], PROJECT_TEXT_SECTIONS).slice(0, 6),
  ['funding', 'funding statement', 'acknowledgements', 'acknowledgments', 'financial support', 'scientific background'],
  'un ordre sans les rangées des sections de texte les remet à leur place du programme (normalizePubDocOrder), sans les perdre');

/* ══ 3. LES INTITULÉS DES NOUVELLES RANGÉES ══════════════════════════════════ */
const { reorderDocHtml } = await import('./src/components/journalFormats.js');
const H2 = (t) => `<h2 class="pf-heading">${t}</h2>`;
const frozen = [
  '<h1 class="pf-title">Titre</h1>',
  H2('Scientific background'), '<p>contexte</p>',
  H2('Results and Discussion'), '<p>résultats</p>',
  H2('Conclusions'), '<p>ce qu’on conclut</p>',
  H2('Funding'), '<p>PRIN 2022</p>',
  H2('Supporting information'), '<p>Table S1</p>',
  H2('Materials and Methods'), '<p>comment</p>',
  H2('References (3)'), '<ol class="pf-bib"><li>ref</li></ol>',
].join('');
eq(pubDocTitleKeywords({ docTitles: { conclusions: 'Perspectives', supporting: 'Supplementary material' } }),
  {
    conclusions: 'Perspectives', conclusion: 'Perspectives', 'concluding remarks': 'Perspectives', perspectives: 'Perspectives',
    'supporting information': 'Supplementary material', 'supplementary information': 'Supplementary material',
    'supporting material': 'Supplementary material', 'supplementary material': 'Supplementary material',
    'supplementary data': 'Supplementary material'
  },
  'un intitulé choisi sur les nouvelles rangées part avec TOUS les mots qui les nomment');
const renamed = reorderDocHtml(frozen, byObjects,
  pubDocTitleKeywords({ docTitles: { conclusions: 'Perspectives', supporting: 'Supplementary material' } }));
ok(renamed.includes('>Perspectives</h2>') && renamed.includes('>Supplementary material</h2>'),
  '…et un document DÉJÀ ENREGISTRÉ suit ces intitulés (le texte de l’auteur ne bouge pas)');
ok(renamed.includes('<p>ce qu’on conclut</p>') && renamed.includes('<p>PRIN 2022</p>'),
  '…le texte de chaque section reste attaché à son intitulé');
ok(!pubDocTitleKeywords({ docTitles: { conclusions: 'Conclusions' } }).conclusions,
'…un intitulé laissé à celui du programme n’écrit rien (le document a déjà le bon)');
ok(!pubDocTitleKeywords({ docTitles: { funding: 'Funding' } }).funding, '…idem pour le financement');


/* ══ 4. LE JOURNAL ÉCRIT L'ORDRE DES SECTIONS ════════════════════════════════
   « when I select the journal preset, all the elements of the publication format must
   adapt to it, including the order of the sections. » */
const fresh = { ...buildPubFormat('nature'), docOrder: buildPubDocOrder(), docTitles: buildPubDocTitles() };
const jacs = applyJournalFormat(fresh, 'jacs');
eq(jacs.docOrder, ['title', 'authors', 'affiliations', 'meta', 'sections',
  'methods', 'conclusions', 'funding', 'supporting', 'experiments', 'references'],
'JACS : « Materials and Methods » remonte DEVANT la conclusion (la convention ACS), sans déranger la tête ni les blocs que le journal ne nomme pas');
eq(jacs.docTitles.methods, 'Materials and Methods', '…et son mot est déjà celui du programme : rien à renommer');
eq(jacs.order, JOURNAL_FORMATS.jacs.order, '…l’ordre du journal voyage avec le format, comme avant');
const ang = applyJournalFormat(fresh, 'angewandte');
eq(ang.docOrder, ['title', 'authors', 'affiliations', 'meta', 'sections',
  'conclusions', 'methods', 'funding', 'supporting', 'experiments', 'references'],
'Angewandte : la conclusion AVANT l’Experimental Section (c’est écrit dans ses notes)');
eq(ang.docTitles.methods, 'Experimental Section',
'…et l’intitulé que le journal emploie (« experimental section ») devient celui du bloc');
eq(applyJournalFormat(fresh, 'nature').docTitles.methods, 'Methods',
'Nature : son mot « methods » devient l’intitulé (Nature imprime « Methods »)');
eq(applyJournalFormat(fresh, 'nature').docOrder.slice(0, 4), PUB_DOC_HEAD_IDS,
'Nature non plus ne touche pas la tête du document (titre, auteurs, affiliations, ligne d’information)');
/* POUR TOUS LES JOURNAUX : la séquence des blocs qu'il NOMME est exactement celle de
   ses mots, les autres ne bougent pas, rien ne se perd, la bibliographie reste dernière. */
JOURNAL_IDS.forEach((id) => {
  const fmt = applyJournalFormat(fresh, id);
  eq(fmt.docOrder.slice(0, 4), PUB_DOC_HEAD_IDS, `${id} : la tête reste la tête`);
  eq(fmt.docOrder[fmt.docOrder.length - 1], 'references', `${id} : la bibliographie reste en dernier`);
  eq(fmt.docOrder.slice().sort(), PUB_DOC_BLOCK_IDS.slice().sort(), `${id} : aucun bloc perdu (les onze sont là)`);
  const named = [];
  JOURNAL_FORMATS[id].order.forEach((w) => {
    const b = docBlockOfWord(w);
    if (b && !named.includes(b)) named.push(b);
  });
  eq(fmt.docOrder.filter((b) => named.includes(b)), named,
    `${id} : les blocs qu’il nomme suivent SA séquence (${named.join(' → ')})`);
});
/* LES BLOCS QU'UN JOURNAL NE NOMME PAS ne bougent pas d'une rangée. */
eq(jacs.docOrder.indexOf('experiments'), buildPubDocOrder().indexOf('experiments'),
'« Experiments » (le bloc du laboratoire) garde sa rangée : le journal n’en parle pas');
eq(applyJournalFormat(fresh, 'jacs').style, '', '…et un style enregistré ne décrit plus ce format (on vient d’en choisir un autre)');
/* ↺ « As in the app » : le journal part, SON ORDRE AUSSI. */
const cleared = clearJournalFormat(jacs, {});
eq(cleared.docOrder, buildPubDocOrder(), '« ↺ As in the app » remet l’ordre du programme');
eq(cleared.docTitles, buildPubDocTitles(), '…et ses intitulés');
eq(cleared.journal, undefined, '…le journal est détaché');
eq(cleared.style, '', '…et le format n’est plus « un style »');
eq(pubDocOrderForWords([], buildPubDocOrder()), buildPubDocOrder(), 'sans mot de journal, l’ordre est rendu INTACT');
eq(pubDocOrderForWords(['introduction'], buildPubDocOrder()), buildPubDocOrder(), '…et un seul bloc nommé ne réordonne rien (il n’y a rien à échanger)');
eq(pubDocTitlesForWords(JOURNAL_FORMATS.jacs.order, { methods: 'Ma méthode' }).methods, 'Ma méthode',
'…un intitulé choisi par l’utilisateur n’est PAS écrasé par le journal');
eq(pubDocTitlesForWords(JOURNAL_FORMATS.angewandte.order, {}).methods, 'Experimental Section', '…mais un bloc resté au défaut prend le mot du journal');
eq(journalSectionOrder(jacs), JOURNAL_FORMATS.jacs.order, 'l’ordre du journal reste lisible pour la note du panneau');


/* ══ 5. LES STYLES « CUSTOM » : SAUVER, RAPPELER, OUBLIER ════════════════════
   « when I click on custom I will be able to define other styles that I must be able to
   save and recall. » */
store.clear();
eq(PUB_STYLES_KEY.startsWith('lab'), true,
'la clé des styles porte le préfixe des clés du poste (« lab… ») : le miroir du Drive l’emporte avec le reste');
const { isSyncableKey } = await import('./src/utils/workspaceKeyStore.js');
eq(isSyncableKey(PUB_STYLES_KEY), true, '…et le miroir la reconnaît comme une clé de l’application (sauver ici = rappeler d’un autre poste)');
eq(loadPubStyles(), {}, 'sans style enregistré, la liste est vide');
const mine = { ...fresh, preset: 'acs', inTextStyle: 'bracket', docTitles: { ...buildPubDocTitles(), conclusions: 'Perspectives' } };
const saved = savePubStyle('My JACS', mine);
ok(!!saved['My JACS'], 'un style sauvé apparaît sous son nom');
eq(saved['My JACS'].style, 'My JACS', '…et se sait être ce style-là (la liste peut dire lequel est actif)');
eq(saved['My JACS'].preset, 'acs', '…avec la citation choisie');
eq(saved['My JACS'].inTextStyle, 'bracket', '…la forme des renvois du texte');
eq(saved['My JACS'].docTitles.conclusions, 'Perspectives', '…et l’intitulé choisi sur les nouvelles rangées');
eq(Object.keys(loadPubStyles()), ['My JACS'], 'il est bien ÉCRIT (relu du stockage, pas seulement rendu)');
savePubStyle('Sans bordures', { ...fresh, preset: 'apa' });
eq(Object.keys(loadPubStyles()).length, 2, 'un second style s’ajoute (sauver ne remplace que le même nom)');
savePubStyle('My JACS', { ...fresh, preset: 'science' });
eq(Object.keys(loadPubStyles()), ['My JACS', 'Sans bordures'], '…et sauvé à nouveau, le même nom REMPLACE le sien');
eq(loadPubStyles()['My JACS'].preset, 'science', '…avec ce qu’on vient de sauver');
eq(removePubStyle('Sans bordures'), { 'My JACS': loadPubStyles()['My JACS'] }, 'oublier un style rend la liste sans lui');
eq(Object.keys(loadPubStyles()), ['My JACS'], '…et l’écrit');
eq(removePubStyle('jamais sauvé'), { 'My JACS': loadPubStyles()['My JACS'] }, 'oublier un nom inconnu ne casse rien');
eq(savePubStyle('   ', mine), { 'My JACS': loadPubStyles()['My JACS'] }, 'un nom vide ne sauve RIEN (aucun style anonyme)');
eq(normalizePubStyleName('  <b>My</b>  JACS '), 'bMy/b JACS', 'un nom de style ne peut pas apporter de HTML (les chevrons tombent)');
eq(normalizePubStyleName('x'.repeat(80)).length, 40, '…et un nom démesuré est coupé (40 caractères)');
/* RAPPELER un style, c’est REMETTRE son format : le panneau pose l’objet enregistré et
   la liste affiche son nom. */
const recalled = loadPubStyles()['My JACS'];
eq(recalled.preset, 'science', 'rappeler « My JACS » rend la citation qu’il portait');
eq(recalled.docOrder, buildPubDocOrder(), '…son ordre de sections');
eq(recalled.style, 'My JACS', '…et son nom, pour que la liste montre lequel est actif');
eq(normalizePubFormat(recalled).style, 'My JACS', '…un format relu d’un enregistrement garde ce nom (il voyage avec lui)');
const keep = normalizePubStyles({ 'Bon style': mine })['Bon style'];
eq(normalizePubStyles({ 'Bon style': mine, nul: null, vide: {}, '  ': mine, 'sans champs': { preset: 'apa' } }),
  { 'Bon style': keep },
'à la relecture, seuls les vrais formats passent : ni vide, ni sans liste de champs, ni nom blanc');
eq(writePubStyles({ 'Bon style': mine })['Bon style'].docOrder, buildPubDocOrder(), 'un style enregistré garde l’ordre de ses sections');
eq(loadPubStyles()['Bon style'].layout.body.size, 0, '…et la mise en forme vierge reste vierge (rien n’est inventé)');


/* ══ 6. LE CÂBLAGE : LE PANNEAU ET LA PAGE DU PROJET ═════════════════════════ */
/* Le panneau (Publications.jsx) : le troisième groupe du contrôle, ses deux gestes,
   et la valeur affichée qui suit le style rappelé. */
has(PANEL, 'My styles — saved by you (Custom)', 'le contrôle « Journal preset » a un groupe pour les styles sauvés');
has(PANEL, 'value={`style:${name}`}', '…dont chaque entrée rappelle SON format');
has(PANEL, 'const pubRecallStyle = (name) => {', '…par un geste qui remet le format enregistré');
has(PANEL, '💾 Save style…', '…un bouton pour sauver le format affiché');
has(PANEL, '🗑 Forget “{activeFormat.style}”', '…et un pour oublier le style affiché (le format en usage ne bouge pas)');
has(PANEL, 'const styles = savePubStyle(name, activeFormat);', '…qui écrit vraiment dans le stockage');
has(PANEL, 'setPubStyles(removePubStyle(key));', '…et l’oubli aussi');
has(PANEL, 'const [pubStyles, setPubStyles] = useState(() => loadPubStyles());', 'la liste est lue une fois, comme le format');
has(PANEL, "style: activeFormat.style || '',", 'un format retouché garde le nom du style dont il vient (le 💾 sait quoi réécrire)');
has(PANEL, 'v.startsWith(\'style:\')', 'la valeur choisie route les trois familles d’options (style sauvé, journal, preset)');
/* La page du projet (projectDetailModule.jsx) : les trois sections s’impriment à leur
   rangée, sous l’intitulé choisi, et les sections de texte gardent le reste. */
has(PROJ, 'const ownRowBlocks = sectionBlocksOf.filter((s) => !!pubDocBlockOfSection(s.id));',
  'la page du projet sépare les sections qui ont leur rangée des autres');
has(PROJ, 'const sectionBlocks = sectionBlocksOf.filter((s) => !pubDocBlockOfSection(s.id));',
  '…« Text sections » garde le contexte et les résultats');
has(PROJ, 'blocks[block.id] = renderSectionBlock(s, docHeading(block.id));',
  '…et chaque section dédiée s’imprime à SA place, sous l’intitulé choisi');
has(PROJ, 'PROJECT_TEXT_SECTIONS\n  );', '…les mots de l’ordre sont calculés avec les sections ET leur id (pas seulement leurs intitulés)');
has(PANEL, 'PUB_DOC_SECTION_BLOCKS, PUB_DOC_SECTION_IDS, pubDocBlockOfSection,', '…que la page reçoit par le ré-export de Publications');
ok(PUB_DOC_SECTION_BLOCKS.length === 3 && PUB_DOC_SECTION_IDS.includes('supporting'),
  '…et le catalogue des blocs-sections est bien celui des trois sections de fin');

/* ── Bilan ─────────────────────────────────────────────────────────────────── */
console.log(`_pub_style_presets_test.mjs — ${passed} assertions OK (le journal réordonne, les sections de fin ont leur rangée, les styles se sauvent et se rappellent)`);
