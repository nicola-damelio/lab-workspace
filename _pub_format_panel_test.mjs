/* =========================================================================
   _pub_format_panel_test.mjs — L'ORDRE ET LE CONTENU DES RUBRIQUES DU
   PANNEAU « Publication format ».

   La demande, rubrique par rubrique :
     • « Format for » reste (inchangé) ;
     • « Journal preset » est OK mais il doit agir sur le CARACTÈRE et l'ORDRE
       des sections → c'est désormais LE contrôle du journal (un style de
       bibliographie dans un groupe, un journal entier dans l'autre) ;
     • « the “submit to” is unclear its function » → la ligne est RETIRÉE ;
     • « Live preview — default » est OBSOLÈTE → remplacée par
       « Live preview — project document » ;
     • « document layout » est FUSIONNÉE avec « document sections », et ces
       éléments se déplacent au glisser-déposer (plus de flèches) ;
     • « the settings of references must follow, followed by the "Lab members in
       the citation" ».

   L'ordre se mesure sur le texte du panneau : chaque rubrique doit suivre la
   précédente. (Les mesures d'exécution — ordre, intitulés, feuille de style —
   sont dans _pub_doc_sections_test.mjs, _pub_author_style_test.mjs et
   _journal_formats_test.mjs.)
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const PANEL = readFileSync(new URL('./src/components/Publications.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

let passed = 0;
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const at = (needle) => {
  const i = PANEL.indexOf(needle);
  assert.ok(i >= 0, `rubrique introuvable dans le panneau : ${needle}`);
  passed += 1;
  return i;
};

/* ══ 1. L'EN-TÊTE : « Format for » puis UN SEUL contrôle de journal ═════════ */
ok(PANEL.includes('Format for:'), 'l’en-tête garde « Format for: »');
ok(PANEL.includes('Journal preset:'), '…et garde « Journal preset: » (il est OK)');
ok(!PANEL.includes('Submit to'), '…mais la ligne « Submit to » (fonction unclear) est retirée');
const yFormat = at('Format for:');
const yPreset = at('Journal preset:');
ok(yFormat < yPreset, '« Format for » vient avant « Journal preset »');
ok(!PANEL.includes('<optgroup label="Bibliography style — the references only">'),
  'le groupe « Bibliography style — the references only » est RETIRÉ (« you can remove … because now it has become obsolete »)');
ok(!PANEL.includes('value={`preset:${id}`}'), '…et ses options « style de bibliographie seul », avec lui');
ok(at('Journal — references, typography, section order and titles') > yPreset,
  'le contrôle garde un groupe pour les JOURNAUX, qui refont aussi le caractère, l’ordre ET les intitulés des sections');
ok(PANEL.includes('User defined'), '…puis le groupe « User defined », les styles que l’utilisateur sauvegarde');
ok(PANEL.includes('value={`style:${name}`}'), '…dont chaque nom rappelle son format');
ok(PANEL.includes('value={`journal:${id}`}'), '…chaque journal aussi');
ok(PANEL.includes('onChange={(e) => pubSetJournalChoice(e.target.value)}'), '…un seul gestionnaire pour les deux');

/* ══ 2. L'APERÇU : l'ancien « — default » a disparu ═══════════════════════ */
ok(!PANEL.includes('Live preview {pubFormatScope'), 'l’ancien « Live preview — default » n’est plus dans le panneau');
ok(!PANEL.includes("'— default'"), '…et son libellé non plus');
at('Live preview — project document');
ok(PANEL.includes("pubLayoutCss(activeFormat, '#pub-layout-preview')"),
  'l’aperçu montré est bien le DOCUMENT DU PROJET, rendu par la feuille de style réelle');
ok(PANEL.includes('className="pf-title'), '…avec la tête d’un vrai document (titre, auteurs, affiliations)');
ok(PANEL.includes('className="pf-bib'), '…ses sections, sa figure et sa bibliographie');

/* ══ 3. LA FUSION « document layout » + « document sections » ═══════════════ */
const yLayout = at('Document layout & sections (project document)');
ok(PANEL.includes('Formatting of every part'), 'la carte porte la mise en forme de chaque partie');
ok(PANEL.includes('Document sections (order & titles)'), '…et l’ordre et les intitulés des sections');
const yFormatting = at('Formatting of every part');
const ySections = at('Document sections (order & titles)');
ok(yFormatting > yLayout && yFormatting < ySections, 'la mise en forme précède les sections, dans la même carte');
ok(PANEL.includes('draggable={!block.fixed}') && PANEL.includes('pubDropDocBlock(id);'),
  'les rangées se déplacent au glisser-déposer');
ok(!PANEL.includes('pubMoveDocBlock'), '…et non par des flèches');
const yRefs = at('References (citation &amp; bibliography)');
ok(ySections < yRefs, 'la carte fusionnée est refermée avant la rubrique suivante');

/* ══ 4. LES RÉFÉRENCES, PUIS LES MEMBRES DU LABORATOIRE ════════════════════ */
const yFields = at('Fields of a reference');
const yLab = at('Lab members in the citation (');
const yCitationPreview = at('Live preview — citation');
ok(yRefs < yFields, '« the settings of references must follow » — le titre précède ses champs');
ok(yFields < yLab, '…« followed by the “Lab members in the citation” »');
ok(yLab < yCitationPreview, '…et l’aperçu de la citation (les noms habillés) est dans SA rubrique');
ok(PANEL.includes('et al. after'), 'les références portent la règle « et al. »');
ok(PANEL.includes('In-text citations (project document)'), '…la forme des renvois dans le texte');
ok(PANEL.includes('+ Add field:'), '…et les champs de la citation, ajout compris');
ok(PANEL.includes('Set all to'), 'les membres du laboratoire ont leur réglage en bloc');

/* ══ 5. CE QUI N'A PAS BOUGÉ ══════════════════════════════════════════════ */
ok(PANEL.includes("else pubSetJournal(v.slice('journal:'.length));"), 'la valeur choisie route les deux familles d’options (un journal, un style sauvé)');
/* LA CASE DU TITRE DE LA BIBLIOGRAPHIE (la demande : « if in the style of science
   references have no title then the title tick must be unchecked in the “References
   (citation & bibliography)” section ») : la rubrique des références la porte, et elle
   lit `docNoTitle` du format. */
ok(PANEL.includes("checked={!docNoTitle.includes('references')}"),
  'la rubrique « References (citation & bibliography) » a la case « imprimer l’intitulé », décochée quand le style n’en écrit pas');
ok(PANEL.includes('docNoTitle: e.target.checked') && PANEL.includes('? docNoTitle.filter((id) => id !== \'references\')'),
  '…et la décocher écrit « pas d’intitulé » dans le format (le document suivra)');
ok(PANEL.includes('const pubSetJournal = (id) => {'), 'le journal entier aussi');
ok(PANEL.includes('const pubResetDocSections = () => pubPatchFormat({ docOrder: buildPubDocOrder(), docTitles: buildPubDocTitles() });'),
  'le ↺ de l’ordre et des intitulés est toujours là');
ok(PANEL.includes('const pubResetAllLayout = () => setActiveFormat({ ...pubCustomFormat(activeFormat.fields), layout: buildPubLayout() });'),
  '…comme celui de la mise en forme');

console.log(`_pub_format_panel_test.mjs — ${passed} assertions OK (l’ordre des rubriques du panneau)`);
