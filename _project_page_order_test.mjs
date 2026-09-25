/* =========================================================================
   _project_page_order_test.mjs — « 📎 Useful files » est la DERNIÈRE carte de la
   page d'un projet, et les cartes d'EXPÉRIENCES passent AVANT la fiche du titre.

   Ce que l'utilisateur demande :
     « in the project move the useful files section at the end » ;

   puis, la demande qui a déplacé les deux cartes d'expériences :
     « in the project page the experiment planner and the experiment in this
       project must be moved before the section of the title. »
   — le plan d'expériences et les expériences du projet se lisent donc AVANT
   « 🧾 Title, authors & affiliations » (la section du titre), qui garde tout ce
   qu'elle portait.

   Pourquoi « 📎 Useful files » est à la fin : les fichiers utiles d'un projet
   (protocoles, PDF, tableurs, spectres…) sont des PIÈCES JOINTES. Ils coupaient
   la lecture de l'article — ils se trouvaient entre « 📋 Materials and Methods » et
   « 💬 Results and Discussion » — alors qu'ils se rangent après le texte, ses
   sections et sa revue.

   Vérifié ici sur la page RÉELLE (projectDetailModule.jsx) : l'ordre des
   cartes, et le fait que les sections déplacées n'ont pas été vidées en
   déménageant (mêmes branchements : index des fichiers, dossier Drive, droits
   d'écriture, types de tests, expériences liées).
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const PAGE = readFileSync('./src/components/AppModules/projectDetailModule.jsx', 'utf8');

let passed = 0;
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const eq = (actual, expected, what) => {
  assert.deepEqual(actual, expected, `${what}\n  attendu : ${JSON.stringify(expected)}\n  obtenu  : ${JSON.stringify(actual)}`);
  passed += 1;
};

/* ── 0. La région du RENDU (les cartes déclarées dans les fonctions d'aide ne
      comptent pas : renderCommentsSection est écrit plus haut dans le fichier
      mais son appel est ce qui décide de sa place dans la page). ───────────── */
const HEADER = '{/* ---------- Header ---------- */}';
const start = PAGE.indexOf(HEADER);
ok(start !== -1, 'le rendu de la page projet est bien localisé (repère « Header »)');
const render = PAGE.slice(start);

/* ── 1. L'ordre attendu des cartes ───────────────────────────────────────── */
const CARDS = [
  ['🧪 Experiment planner', 'le plan d’expériences — AVANT la section du titre (la demande)'],
  ['🧪 Experiments in this project', 'les expériences du projet'],
  ['🧾 Title, authors & affiliations', 'la fiche de l’article'],
  ['🖼 Saved canvases', 'les toiles enregistrées'],
  ['🔬 Scientific background', 'le contexte scientifique'],
  ['📋 Materials and Methods', 'le Matériel et méthodes'],
  ['💬 Results and Discussion', 'les résultats'],
  ['✅ Conclusions', 'les conclusions'],
  ['💰 Funding', 'le financement'],
  ['📎 Supporting information', 'les informations supplémentaires'],
  ['📚 References', 'la liste des références'],
  ['💬 Comments & review', 'la revue (appel de renderCommentsSection)'],
  ['📎 Useful files', 'les fichiers utiles — EN DERNIER']
];

const COMMENTS_CALL = '{renderCommentsSection()}';
ok(render.includes(COMMENTS_CALL), 'la revue est toujours rendue par renderCommentsSection()');

const positionOf = (label) => {
  if (label === '💬 Comments & review') return render.indexOf(COMMENTS_CALL);
  const single = render.indexOf(`'${label}'`);
  return single === -1 ? render.indexOf(`"${label}"`) : single;
};

const positions = CARDS.map(([label, what]) => ({ label, what, at: positionOf(label) }));
positions.forEach(({ label, at }) => ok(at !== -1, `la carte « ${label} » est présente`));
const shown = positions.map((p) => p.label);
eq(shown.slice().sort((a, b) => positionOf(a) - positionOf(b)), shown,
  'les cartes se lisent dans l’ordre de la page : expériences → article → contexte → méthodes → texte → annexes → revue → fichiers utiles');

/* ── 1bis. LES DEUX CARTES D'EXPÉRIENCES PRÉCÈDENT LA SECTION DU TITRE ─────
   La demande : « in the project page the experiment planner and the experiment in
   this project must be moved before the section of the title. » */
const planner = positionOf('🧪 Experiment planner');
const expWindow = positionOf('🧪 Experiments in this project');
const titleCard = positionOf('🧾 Title, authors & affiliations');
ok(planner < titleCard, 'le plan d’expériences passe AVANT la fiche du titre');
ok(expWindow < titleCard, '…et les expériences du projet aussi');
ok(expWindow > planner, '…dans leur ordre : le plan d’abord, la fenêtre des tests ensuite');
/* Le déménagement n'a rien débranché : la carte du titre garde son contenu, et
   les deux cartes d'expériences gardent les leurs (types de tests, expériences
   liées, « Include » dans le document). */
const titleCardHtml = render.slice(render.lastIndexOf('<SectionCard', titleCard), render.indexOf('</SectionCard>', titleCard));
ok(titleCardHtml.includes('title="🧾 Title, authors & affiliations"'), 'la fiche du titre garde son intitulé');
ok(titleCardHtml.includes('project.paperTitle'), '…et son champ de titre');
const expCards = render.slice(render.lastIndexOf('<SectionCard', planner), render.indexOf('</SectionCard>', expWindow) + '</SectionCard>'.length);
ok(expCards.includes("title=\"🧪 Experiment planner\""), 'le plan d’expériences garde son intitulé');
ok(expCards.includes("title=\"🧪 Experiments in this project\""), '…et la fenêtre des expériences le sien');
ok(expCards.includes('toggleSection(\'experiments\')'), '…son pliage');
ok(expCards.includes('experimentsGrouped(project.experiments, tests)'), '…et la liste des tests liés du projet');

/* ── 2. « 📎 Useful files » est la DERNIÈRE carte de la page ─────────────── */
const useful = positionOf('📎 Useful files');
const after = CARDS
  .filter(([label]) => label !== '📎 Useful files')
  .filter(([label]) => positionOf(label) > useful)
  .map(([label]) => label);
eq(after, [], 'aucune carte ne suit « 📎 Useful files » (elle est bien à la fin)');

/* Elle n'est plus EN PLEIN MILIEU : ni entre « Materials and Methods » et
   « Results and Discussion », ni avant la bibliographie. */
const mm = positionOf('📋 Materials and Methods');
const discussion = positionOf('💬 Results and Discussion');
const bib = positionOf('📚 References');
ok(useful > discussion, 'les fichiers utiles ne coupent plus la lecture avant les résultats');
ok(useful > bib, '…ni avant la bibliographie');
eq([mm < discussion, useful > mm], [true, true],
  'le Matériel et méthodes garde sa place dans le fil de l’article');

/* ── 3. Déménager n'a rien débranché ─────────────────────────────────────── */
const card = render.slice(render.lastIndexOf('<SectionCard', useful), render.indexOf('</SectionCard>', useful));
ok(card.includes('<UsefulFilesSection'), 'la carte rend toujours la section des fichiers utiles');
ok(card.includes("title=\"📎 Useful files\""), 'avec son intitulé');
ok(card.includes('{normalizeProjectFiles(project.usefulFiles).length}'),
  'et son compteur de fichiers');
ok(card.includes('projectName={project.name}'), 'elle connaît le projet (dossier Drive)');
ok(card.includes('files={project.usefulFiles}'), 'elle lit l’index du projet');
ok(card.includes("folderUrl={project.usefulFilesFolderUrl || ''}"), 'et le lien du dossier Drive');
ok(card.includes('canModify={canModify}') && card.includes('currentUser={currentUser}'),
  'les droits d’écriture / l’auteur courant sont conservés');
ok(card.includes('onChange={(next) => updateProject({ usefulFiles: next })}'),
  'l’ajout / retrait d’un fichier met toujours l’index du projet à jour');
ok(card.includes('onFolderUrl={(url) => updateProject({ usefulFilesFolderUrl: url })}'),
  '…et l’URL du dossier Drive aussi');
ok(PAGE.includes('const [openSections, setOpenSections] = useState({')
  && /usefulFiles: (true|false)/.test(PAGE),
  'la carte reste pliable (openSections.usefulFiles)');
ok(PAGE.includes('const [openSections, setOpenSections] = useState({') && PAGE.includes('usefulFiles: true'),
  'elle est ouverte par défaut — à la fin de la page, elle reste donc visible sans clic');

console.log(`_project_page_order_test.mjs — ${passed} assertions passed`);
