/* =========================================================================
   _nmr_nuclei_table_test.mjs — 🎯 « TARGET NUCLEI », LA FORMULE 2D ET LE
   VIEWER 3D DE LA PAGE NMR.

   Demandé mot pour mot :
     • « remove the empty lines between the "sequence and structure" section and
       the viewer » ;
     • « Make the 3D Viewer section collapsible and independent of the 2D
       formula. » ;
     • « Include the 2D formula in the "sequence and structure" section. » ;
     • « the insert "target nuclei" does not act on the table as it should. Move
       its atom ticks in horizontal before the button "publication table". If
       ticked the corresponding nuclei must appear in the table. »

   Ce qui doit rester vrai :
     • la FORMULE 2D (StructureSVGView pour une séquence, OrganicViewer pour un
       SMILES) est DANS la sous-section « Sequence and structure » — celle qui
       porte la peinture 🖌️ — et le VIEWER 3D a SA PROPRE sous-section repliable :
       aucun sélecteur 2D ⇄ 3D ne fait plus disparaître l'un quand on montre
       l'autre ;
     • replier le viewer 3D ne le DÉMONTE pas (`keepMounted`) : le dépliage ne
       relit pas la structure, et `onToggle` fait recaler le viewer et les tracés
       sur la largeur (replier / déplier n'émet aucun « resize ») ;
     • plus de grand blanc (« mt-6 » + filet + « pt-6 ») entre la bande de
       séquence et le viewer ;
     • les cases H / N / C (/ P) sont à l'HORIZONTALE, juste AVANT le bouton
       « 📄 Publication Table », et une case cochée fait APPARAÎTRE les lignes de
       ce noyau dans la table des déplacements (décochée, elles disparaissent) ;
     • la règle est RÉELLEMENT exécutée : elle lit le noyau sur l'étiquette que
       la table affiche (« Ala1 HN (¹H) », « Ala1 N (¹⁵N) », « Ala1 Cα (¹³C) »,
       « P (³¹P) »), garde une étiquette sans noyau reconnu et ne cache rien
       quand la sélection est absente (conditions d'avant la demande).

   Les pages sont du JSX : leurs sites de rendu sont vérifiés sur le TEXTE,
   comme _residue_numbering_panels_test.mjs ; la règle du filtre, elle, est
   extraite de la source et EXÉCUTÉE.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const SEC = read('src/components/NMRSections.jsx');
const UI = read('src/components/ui.jsx');

let passed = 0;
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const eq = (a, b, what) => {
  assert.deepEqual(a, b, `${what}\n  attendu : ${JSON.stringify(b)}\n  obtenu  : ${JSON.stringify(a)}`);
  passed += 1;
};
const has = (src, needle, what) => {
  assert.ok(src.includes(needle), `${what}\n  cherche : ${needle}`);
  passed += 1;
};
const gone = (src, needle, what) => {
  assert.ok(!src.includes(needle), `${what}\n  encore présent : ${needle}`);
  passed += 1;
};
const count = (src, needle) => src.split(needle).length - 1;
const at = (src, needle, what) => {
  const i = src.indexOf(needle);
  assert.ok(i >= 0, `${what}\n  introuvable : ${needle}`);
  passed += 1;
  return i;
};

/* ════════════ 1. LA RÈGLE DU FILTRE, EXTRAITE ET EXÉCUTÉE ════════════════ */
const grab = (name, end) => {
  const m = SEC.match(new RegExp(`^const ${name} = [\\s\\S]*?${end}$`, 'm'));
  assert.ok(m, `NMRSections.jsx : ${name} introuvable`);
  return m[0];
};
const { ATOM_NUCLEUS_TAG, atomNucleusOf, atomInSelectedNuclei } = new Function(
  [grab('ATOM_NUCLEUS_TAG', ';'),
   grab('atomNucleusOf', '\\n};'),
   grab('atomInSelectedNuclei', '\\n};')].join('\n')
  + '\nreturn { ATOM_NUCLEUS_TAG, atomNucleusOf, atomInSelectedNuclei };'
)();

eq(ATOM_NUCLEUS_TAG, { '(¹H)': 'H', '(¹³C)': 'C', '(¹⁵N)': 'N', '(³¹P)': 'P' },
  'les quatre étiquettes de noyau de la table sont reconnues');
const opt = (label) => ({ key: '12-CA', label });
const nucleus = (label) => atomNucleusOf(opt(label));
const shown = (label, selNuc) => atomInSelectedNuclei(opt(label), selNuc);

eq(nucleus('Ala1 HN (¹H)'), 'H', 'une étiquette ¹H donne le noyau H');
eq(nucleus('Ala1 N (¹⁵N)'), 'N', '…¹⁵N donne N');
eq(nucleus("Ala1 C' (¹³C)"), 'C', '…¹³C donne C');
eq(nucleus('POPC P (³¹P)'), 'P', '…³¹P donne P');
eq(nucleus('Atom-7'), null, 'une étiquette sans noyau reconnu ne rend aucun noyau');
eq(nucleus('Ala1 Hα (¹H)'), 'H', 'une étiquette ¹H de chaîne latérale aussi');
eq(atomNucleusOf(null), null, 'une option absente ne fait pas planter la règle');

/* La table d'un peptide : H, N, C et (lipide) P. */
const LABELS = ['Ala1 HN (¹H)', 'Ala1 N (¹⁵N)', 'Ala1 Cα (¹³C)', 'POPC P (³¹P)'];
eq(LABELS.map((l) => shown(l, ['H', 'C', 'N'])), [true, true, true, false],
  'les trois noyaux cochés par défaut montrent H / C / N et cachent ³¹P');
eq(LABELS.map((l) => shown(l, ['H', 'C', 'N', 'P'])), [true, true, true, true],
  'cocher ³¹P fait APPARAÎTRE ses lignes');
eq(LABELS.map((l) => shown(l, ['H', 'N', 'C'])).filter(Boolean).length, 3,
  'décocher ³¹P enlève ses lignes de la table');
eq(shown('Ala1 N (¹⁵N)', ['H', 'C']), false, 'décocher ¹⁵N enlève les lignes N');
eq(shown('Ala1 HN (¹H)', []), false, 'aucune case cochée → plus aucune ligne');
eq(shown('Ala1 N (¹⁵N)', ['N']), true, 'une seule case cochée garde son propre noyau');
eq(shown('Atom-7', ['H']), true, 'une étiquette sans noyau n’est JAMAIS cachée');
eq(shown('Ala1 HN (¹H)', undefined), true,
  'sans sélection (condition enregistrée avant la demande) on ne cache rien');
eq(shown('Ala1 HN (¹H)', 'H'), true, 'une sélection illisible (texte) ne cache rien non plus');

/* ════════════ 2. LES CASES SONT À L'HORIZONTALE, AVANT LE BOUTON ═════════ */
const bar = at(SEC, '<div className="flex items-center justify-between flex-wrap gap-2 mb-3">',
  'la barre de commandes de la table est identifiable');
const ticks = at(SEC, "{['H', 'N', 'C', ...(d.hasPhosphorus ? ['P'] : [])].map((n) => (",
  'les cases des noyaux sont dans la page');
const pub = at(SEC, '>📄 Publication Table</button>', 'le bouton de la table de publication est là');
ok(ticks > bar && ticks < pub,
  'les cases sont dans la barre, JUSTE AVANT « 📄 Publication Table »');
has(SEC, '<div className="flex items-center gap-1 mr-2">',
  '…et à l’HORIZONTALE (une seule rangée de pastilles)');
gone(SEC, '<div className="w-full md:w-64 flex flex-col gap-4">',
  'l’ancien encadré vertical « Target Nuclei » a disparu du haut de la page');
gone(SEC, 'Target Nuclei</label>', '…avec son titre vertical');
eq(count(SEC, 'checked={d.selNuc.includes(n)}'), 1,
  'les cases des noyaux n’existent plus qu’à UN endroit');
has(SEC, 'selectedNuclei: d.selNuc.includes(n) ? d.selNuc.filter((x) => x !== n) : [...d.selNuc, n]',
  '…et elles écrivent bien activeTest.selectedNuclei (l’état des spectres aussi)');

/* ════════════ 3. LA TABLE NE MONTRE QUE LES NOYAUX COCHÉS ════════════════ */
const filter = at(SEC, '.filter((opt) => atomInSelectedNuclei(opt, d.selNuc));',
  'la table des déplacements filtre ses lignes par noyau');
has(SEC, 'const atomInSelectedNuclei = (opt, selNuc) => {',
  '…par une règle NOMMÉE (celle que ce test exécute)');
const rowspan = at(SEC, 'rowSpan={displayAtoms.length}',
  'la cellule « Residue » s’étend sur les lignes VISIBLES');
ok(filter < rowspan, 'le filtre s’applique AVANT le dessin des lignes');
has(SEC, "const displayAtoms = (effTableMode === 'backbone'",
  '…après le mode Backbone / All Atoms (le filtre ne le remplace pas)');
const bodyIdx = at(SEC, '{d.estSeq.map((res, idx) => {', 'la table des déplacements est celle du corps');
ok(bodyIdx < filter, 'c’est bien la table des déplacements qui filtre (pas un autre tableau)');

/* ════════════ 4. LA FORMULE 2D DANS « SEQUENCE AND STRUCTURE » ════════════ */
const seqOpen = at(SEC, '<CollapsibleSection title="Sequence and structure" icon="🖌️" defaultOpen>',
  '« Sequence and structure » est OUVERTE par défaut (c’est là que la formule 2D se voit)');
const seqClose = SEC.indexOf('</CollapsibleSection>', seqOpen);
ok(seqClose > seqOpen, '…et elle se referme');
const svg = at(SEC, '<StructureSVGView structure={d.structure}', 'la formule 2D d’une séquence est dessinée');
const org = at(SEC, '<OrganicViewer smiles={activeTest.smiles', 'la formule 2D d’un SMILES aussi');
ok(svg > seqOpen && svg < seqClose, 'la formule 2D (StructureSVGView) est DANS « Sequence and structure »');
ok(org > seqOpen && org < seqClose, '…le viewer SMILES (OrganicViewer) aussi');
const strip = at(SEC, '<SequencePaintStrip ', 'la bande de séquence peinte est toujours là');
ok(strip > seqOpen && strip < seqClose, '…dans la MÊME sous-section (une seule carte à l’écran)');
eq(count(SEC, '<SequencePaintStrip '), 1, '…en UN SEUL exemplaire, comme avant');
gone(SEC, "structureMode === '2d' ? 'block' : 'none'",
  'plus aucun « display: none » piloté par un mode 2D ⇄ 3D');
gone(SEC, 'display: structureMode', '…ni le volet 3D caché par le mode 2D');
gone(SEC, '>2D Formula</button>', 'le bouton « 2D Formula » a disparu (la formule est dans la sous-section)');
gone(SEC, '>3D Viewer</button>', 'le bouton « 3D Viewer » a disparu (le viewer a sa sous-section)');
gone(SEC, 'const structureMode = activeTest.structureMode', '…ainsi que la variable de mode');
gone(SEC, 'hasOpened3D', '…et le montage piloté par ce mode (la sous-section s’en charge)');

/* ════════════ 5. LE VIEWER 3D, SA SOUS-SECTION, ZÉRO BLANC AVANT ═════════ */
gone(SEC, '<div className="mt-6 border-t border-slate-200 pt-6">',
  'plus de grand blanc ni de filet entre la bande de séquence et le viewer');
const viewer = at(SEC, 'title="3D viewer"', 'le viewer 3D a SA sous-section repliable');
ok(viewer > seqClose, '…après « Sequence and structure » (les deux sont INDÉPENDANTES)');
has(SEC, 'keepMounted', '…replier ne DÉMONTE pas le viewer (il relirait la structure)');
has(SEC, 'onToggle={setViewerOpen}', '…et la page est prévenue du repli / dépliage');
has(SEC, "openWhen={activeTest.structureMode === '3d'}",
  'une condition restée en mode 3D la rouvre toute seule (rien n’est perdu)');
const viewerSection = SEC.slice(viewer, SEC.indexOf('</CollapsibleSection>', viewer));
has(viewerSection, '🔍 Focus', 'le 🔍 Focus reste accessible — dans l’en-tête de la sous-section');
has(viewerSection, "headerExtra={d.moleculeType !== 'organic' ? (", '…et il y est vraiment');
has(viewerSection, '✖ Deselect', '…avec le ✖ Deselect');
has(viewerSection, 'onClick={() => updateActiveTest({ selectedAtomKeys: [] })}',
  '…qui déselectionne comme avant');
has(SEC, '<div className="flex flex-col">', 'les deux sous-sections sont empilées côte à côte');
has(SEC, 'const show2DFormula = d.moleculeType', 'la formule 2D a SA condition (SMILES ou structure)');
has(SEC, 'const showPaintStrip = !univTestMode && d.moleculeType', 
  'la peinture 🖌️ reste réservée à une protéine hors mode 🎓 University test');

/* ════════════ 6. CollapsibleSection : keepMounted / onToggle ════════════ */
has(UI, 'keepMounted = false, onToggle', 'CollapsibleSection accepte keepMounted / onToggle');
has(UI, 'const [everOpened, setEverOpened] = useState(isOpen);',
  'une sous-section ne monte son contenu qu’après sa PREMIÈRE ouverture');
has(UI, 'if (next) setEverOpened(true);', '…ouverture qui est retenue');
has(UI, "style={{ display: isOpen ? 'block' : 'none' }}",
  'repliée, elle garde son contenu MONTÉ mais masqué (aucune relecture au dépliage)');
has(UI, 'if (onToggle) onToggle(next);', 'la page est prévenue de chaque repli / dépliage');
has(UI, ': (isOpen && <div className="p-3">{children}</div>)}',
  'les autres sections gardent exactement leur comportement (monté / démonté)');

console.log(`_nmr_nuclei_table_test.mjs — ${passed} assertions OK (🎯 noyaux de la table, formule 2D dans « Sequence and structure », viewer 3D repliable)`);
