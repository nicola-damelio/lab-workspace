/* =========================================================================
   _pub_author_style_test.mjs — format de citation des publications.

   Le module RÉEL est importé (src/components/pubCitation.js, sans React) :
   toutes les règles qui comptent pour le laboratoire sont vérifiées ici.

   Règle annoncée : TOUS les auteurs d'un article restent cités — la seule règle
   qui raccourcit la liste est le « et al. » après N auteurs — et le format
   choisit seulement le STYLE des membres du laboratoire : chacun peut être
   souligné (U), en gras (B) ou laissé normal (Aa), partout où son nom apparaît
   dans la liste des auteurs.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

/* Les sources de src/ s'importent sans extension (résolues par Vite) : le
   crochet rend le module RÉEL importable par node (voir _esm_test_hook.mjs). */
register('./_esm_test_hook.mjs', import.meta.url);
const {
  AUTHOR_STYLES, AUTHOR_STYLE_IDS, PUB_FORMAT_KEY, PUB_FORMAT_PRESETS,
  authorMatchesCandidate, authorStyleOf, buildPubFormat, labMemberOf,
  loadPubFormat, matchCoauthors, normalizePubFormat, pubCitationHtml,
  pubCitationText, pubDoiUrl, pubFieldValue, renderAuthorNames,
  sanitizeScientistStyles, scientistStyleOf
} = await import('./src/components/pubCitation.js');

let passed = 0;
const eq = (actual, expected, what) => {
  assert.deepEqual(actual, expected, `${what}\n  attendu : ${JSON.stringify(expected)}\n  obtenu  : ${JSON.stringify(actual)}`);
  passed += 1;
};
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};

/* ── 1. Jeu de données : trois membres du laboratoire parmi sept auteurs ─── */
/* « Rossi M », « Bianchi A » et « Ramos MJ » ont un compte (liste des
   scientifiques) ; Smith, Verdi, Müller et Costa ne sont PAS du laboratoire. */
const scientists = ['Rossi M', 'Bianchi A', 'Ramos MJ'];
const pub = {
  authors: 'Rossi M, Smith J, Bianchi A, Verdi G, Müller K, Ramos MJ, Costa L',
  year: '2024', title: 'Antimicrobial peptides in lipid bilayers',
  journal: 'J. Biol. Chem.', volume: '300', pages: '105678', doi: '10.1016/j.jbc.2024.105678'
};
const ALL = 'Rossi M, Smith J, Bianchi A, Verdi G, Müller K, Ramos MJ, Costa L';
const fmt = (patch = {}) => ({ ...buildPubFormat('nature'), ...patch });

eq(labMemberOf('Rossi M', scientists), 'Rossi M', 'auteur reconnu comme membre du laboratoire');
eq(labMemberOf('Smith J', scientists), '', 'auteur extérieur : aucun membre reconnu');
eq(authorMatchesCandidate('Bianchi A', 'Bianchi A'), true, 'comparaison nom ↔ compte utilisateur');
eq(matchCoauthors(pub.authors, scientists, 'Rossi M'), ['Bianchi A', 'Ramos MJ'],
  'les co-auteurs du laboratoire sont retrouvés (hors titulaire)');

/* ── 2. Tous les auteurs sont cités : rien n'est jamais retiré ──────────── */
eq(renderAuthorNames(pub, fmt(), scientists).text, ALL,
  'sans « et al. » : les 7 auteurs, dont 4 extérieurs, restent tous cités');
eq(renderAuthorNames(pub, fmt({ etAlLimit: 3 }), scientists).text, 'Rossi M, Smith J, Bianchi A, et al.',
  '« et al. » après 3 auteurs : règle inchangée');
eq(renderAuthorNames(pub, fmt({ etAlLimit: 3, alwaysShowScientists: true }), scientists).text,
  'Rossi M, Smith J, Bianchi A, Ramos MJ, et al.',
  '« toujours afficher les membres » : Ramos MJ (6e auteur) est conservé');
eq(renderAuthorNames(pub, fmt({ etAlLimit: 3, scientistStyles: { 'Ramos MJ': 'bold' } }), scientists).text,
  'Rossi M, Smith J, Bianchi A, et al.',
  'un membre stylé mais coupé par le « et al. » n’apparaît pas pour autant');
eq(renderAuthorNames(pub, fmt(), []).text, ALL, 'aucun membre connu ⇒ liste complète inchangée');
ok(pubCitationText(pub, fmt(), scientists).startsWith(`${ALL} `),
  'la citation complète commence par la liste intégrale des auteurs');

/* ── 3. Le membre du laboratoire est souligné ou en gras, seul ──────────── */
const html = (patch) => renderAuthorNames(pub, fmt(patch), scientists).html;
ok(html({ scientistStyles: { 'Rossi M': 'underline' } }).includes('<u>Rossi M</u>'),
  'U sur Rossi M : son nom est souligné');
ok(!html({ scientistStyles: { 'Rossi M': 'underline' } }).includes('<u>Bianchi A</u>'),
  'U sur Rossi M : les autres membres ne sont pas soulignés');
ok(html({ scientistStyles: { 'Bianchi A': 'bold' } }).includes('<b>Bianchi A</b>'),
  'B sur Bianchi A : son nom est en gras');
ok(!html({ scientistStyles: { 'Bianchi A': 'bold' } }).includes('<b>Rossi M</b>'),
  'B sur Bianchi A : les autres membres ne sont pas en gras');
const three = html({ scientistStyles: { 'Rossi M': 'bold', 'Bianchi A': 'underline', 'Ramos MJ': 'bold' } });
ok(three.includes('<b>Rossi M</b>') && three.includes('<u>Bianchi A</u>') && three.includes('<b>Ramos MJ</b>'),
  'trois membres, styles indépendants : gras / souligné / gras');
eq((html({ scientistStyles: { 'Rossi M': 'bold', 'Bianchi A': 'underline', 'Ramos MJ': 'none' } })
  .match(/<(u|b)>/g) || []).length, 2,
  'deux balises de style seulement : « none » n’ajoute rien');
ok(html({ scientistStyles: { 'Rossi M': 'bold' } }).includes('Smith J') &&
   !/<\/?[ub]>[^<]*Smith[^<]*<\/(u|b)>/.test(html({ scientistStyles: { 'Rossi M': 'bold' } })),
  'un auteur extérieur au laboratoire n’est jamais stylé');
ok(pubCitationHtml(pub, fmt({ scientistStyles: { 'Rossi M': 'bold' } }), scientists).includes('<b>Rossi M</b>'),
  'la citation HTML complète applique le style du membre');
ok(pubCitationText(pub, fmt({ scientistStyles: { 'Rossi M': 'bold' } }), scientists).includes('<') === false,
  'la citation texte reste sans balise (style HTML uniquement)');

/* ── 4. Ancien réglage « souligner leurs noms » conservé, mais surchargé ── */
ok(html({ underlineScientists: true }).includes('<u>Rossi M</u>') &&
   html({ underlineScientists: true }).includes('<u>Bianchi A</u>') &&
   html({ underlineScientists: true }).includes('<u>Ramos MJ</u>'),
  'format existant « souligner tout le laboratoire » : rendu identique à avant');
eq(scientistStyleOf('Rossi M', fmt({ underlineScientists: true })), 'underline',
  'sans choix explicite, l’ancien réglage sert de défaut');
eq(scientistStyleOf('Rossi M', fmt({ underlineScientists: true, scientistStyles: { 'Rossi M': 'bold' } })), 'bold',
  'un choix explicite remplace l’ancien réglage');
eq(scientistStyleOf('Rossi M', fmt({ underlineScientists: true, scientistStyles: { 'Rossi M': 'none' } })), 'none',
  '« normal » explicite neutralise l’ancien réglage (cas du bouton Aa)');
eq(authorStyleOf('Smith J', fmt({ underlineScientists: true }), scientists), 'none',
  'un auteur hors du laboratoire n’est jamais stylé, même avec l’ancien réglage');
eq(authorStyleOf('Rossi M', fmt({ underlineScientists: true }), scientists), 'underline',
  'un membre du laboratoire, lui, suit l’ancien réglage');
ok(!html({ underlineScientists: true, scientistStyles: { 'Rossi M': 'bold', 'Bianchi A': 'none' } }).includes('<u>Rossi M</u>'),
  'mélange : le style explicite gagne pour Rossi M');
ok(html({ underlineScientists: true, scientistStyles: { 'Rossi M': 'bold', 'Bianchi A': 'none' } }).includes('<u>Ramos MJ</u>'),
  'mélange : Ramos MJ (aucun choix) reste souligné par l’ancien réglage');

/* ── 5. Formats déjà enregistrés / de projet : lecture tolérante ────────── */
eq(sanitizeScientistStyles({ 'Rossi M': 'bold', ' ': 'underline', X: 'junk', Y: 3 }), { 'Rossi M': 'bold' },
  'styles inconnus ou noms vides ignorés');
eq(sanitizeScientistStyles(null), {}, 'aucun style enregistré ⇒ objet vide');
const legacy = normalizePubFormat({
  preset: 'acs', etAlLimit: '4', underlineScientists: true, alwaysShowScientists: 1,
  fields: [{ id: 'authors', enabled: true, order: 0, style: 'normal' }]
});
eq([legacy.etAlLimit, legacy.underlineScientists, legacy.alwaysShowScientists, legacy.scientistStyles],
  [4, true, true, {}], 'ancien format (sans styles) relu sans perte : « et al. » 4 + souligné');
eq(normalizePubFormat({ etAlLimit: -3 }).etAlLimit, 0, '« et al. » négatif ramené à « jamais »');
const dflt = loadPubFormat();
ok(dflt && dflt.preset === 'nature' && Array.isArray(dflt.fields) && dflt.scientistStyles && Object.keys(dflt.scientistStyles).length === 0,
  'format par défaut : Nature, aucune personne stylée');
eq(AUTHOR_STYLE_IDS, ['none', 'underline', 'bold'], 'trois styles : normal, souligné, gras');
eq(AUTHOR_STYLES.map((s) => s.label), ['Aa', 'U', 'B'], 'libellés des boutons du panneau');
ok(PUB_FORMAT_KEY.includes('pubFormat') && !!PUB_FORMAT_PRESETS[dflt.preset],
  'clé de stockage et presets journal exposés par le module');

/* ── 6. Reste du moteur (champs, DOI, échappement) inchangé ────────────── */
eq(pubFieldValue({ title: 'T' }, 'title'), 'T', 'lecture d’un champ');
eq(pubFieldValue({ title: 'T' }, 'inconnu'), '', 'champ inconnu ⇒ vide');
eq(pubDoiUrl('10.1016/j.bcp.2024.1'), 'https://doi.org/10.1016/j.bcp.2024.1', 'DOI transformé en lien');
eq(pubDoiUrl('https://doi.org/10.1/x'), 'https://doi.org/10.1/x', 'URL déjà complète conservée');
const apa = pubCitationHtml(pub, buildPubFormat('apa'), scientists);
ok(apa.includes('class="pub-doi-link"') && apa.includes('https://doi.org/10.1016/j.jbc.2024.105678'),
  'preset APA : le DOI reste un lien cliquable');
ok(pubCitationHtml({ ...pub, authors: 'Rossi & Cie <b>' }, fmt(), scientists).includes('Rossi &amp; Cie &lt;b&gt;'),
  'les noms sont échappés (pas d’injection HTML dans la citation)');

/* ── 7. Câblage de l'écran « Publication format » (Publications.jsx) ───── */
const src = readFileSync(new URL('./src/components/Publications.jsx', import.meta.url), 'utf8');
const mod = readFileSync(new URL('./src/components/pubCitation.js', import.meta.url), 'utf8');
const pdm = readFileSync(new URL('./src/components/AppModules/projectDetailModule.jsx', import.meta.url), 'utf8');

ok(/from '\.\/pubCitation';/.test(src), 'Publications.jsx importe le moteur depuis ./pubCitation');
ok(/const citationScientists = useMemo\(/.test(src), 'les membres cités = scientifiques + noms ajoutés à la main');
ok(/\(extraScientists \|\| \[\]\)\.forEach/.test(src), 'les scientifiques ajoutés manuellement sont inclus');
eq((src.match(/pubCitationHtml\(p, pubFormat, citationScientists\)/g) || []).length, 1,
  'le tableau des publications rend la citation avec ces membres');
eq((src.match(/pubCitationHtml\(samplePub, activeFormat, citationScientists\)/g) || []).length, 1,
  'l’aperçu du format utilise ces mêmes membres');
ok(/AUTHOR_STYLES\.map/.test(src), 'le panneau itère sur les styles (boutons Aa / U / B)');
ok(/pubSetScientistStyle\(name, s\.id\)/.test(src) && /pubSetAllScientistStyles\(s\.id\)/.test(src),
  'choix par membre et « Set all to » branchés');
ok(/scientistStyleOf\(name, activeFormat\)/.test(src), 'le style effectif de chaque membre est affiché');
ok(/scientistStyles: \{ \.\.\.\(activeFormat\.scientistStyles \|\| \{\}\) \}/.test(src),
  'les styles sont conservés à chaque modification du format');
ok(!/underlineScientists: e\.target\.checked/.test(src), 'l’ancienne case « Underline their names » est retirée du panneau');
ok(/The old “Underline their names” setting of this format is still on/.test(src),
  'un format existant souligné est signalé, sans être réécrit en douce');
ok(!/renderAuthorNames|PUB_FORMAT_PRESETS = \{|const buildPubFormat/.test(src),
  'le moteur n’est plus dupliqué dans Publications.jsx');
ok(/export \{\r?\n  AUTHOR_STYLES/.test(src) && /\} from '\.\/pubCitation';/.test(src),
  'Publications.jsx réexporte le moteur (les imports existants continuent de marcher)');
ok(/import \{ loadPubFormat, pubCitationHtml \} from '\.\.\/Publications';/.test(pdm),
  'la bibliographie des projets continue d’importer depuis Publications');
ok(!/from 'react'/.test(mod), 'le moteur ne dépend pas de React (testable hors navigateur)');

console.log(`_pub_author_style_test: ${passed} passed`);
