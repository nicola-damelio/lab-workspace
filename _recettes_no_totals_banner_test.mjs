/* =========================================================================
   _recettes_no_totals_banner_test.mjs — la page « Recettes » s’ouvre
   DÉSORMAIS directement sur ses actions et sur sa grande table : le bandeau de
   cartes de synthèse a été retiré (budget total, mis à disposition (univ.),
   prestations internes, OM payés / prévus / en signature, achats prévus,
   devis en signature, soldes restant et prévu).

   Demande : « nella pagina recettes elimina i riquadri in alto con il totale
   delle varie linee budgetarie, lascia solo i pulsanti e la tabella grande ».

   Ce qui doit rester vrai :
     • plus aucune carte de synthèse NI le calcul d’agrégats qui les alimentait
       (`const totals = useMemo(...)`, composant local `SummaryCard`) ;
     • la phrase d’aide « Chaque ligne affiche ses montants … » de la barre
       d’actions disparaît dans la même passe : l’information est déjà portée
       par les infobulles des en-têtes et des cases de la table ;
     • les BOUTONS (📥 Importer, + Nouvelle ligne budgétaire), les ONGLETS
       (Lignes budgétaires / Salaires) et la GRANDE TABLE (SmartTable « hauteur
       d’écran ») sont intacts ;
     • les montants restent lisibles LIGNE PAR LIGNE : les agrégats de chaque
       ligne (`aggFor` → `__agg`) et leur mise en forme `euro.format(...)`
       restent dans la table, qui est désormais la seule source des totaux.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let passed = 0;
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};
const eq = (a, b, what) => {
  assert.equal(a, b, what);
  passed += 1;
};
const count = (src, re) => (src.match(re) || []).length;
const has = (src, needle, what) => {
  assert.ok(src.includes(needle), `${what}\n  introuvable : ${needle}`);
  passed += 1;
};
const gone = (src, needle, what) => {
  assert.ok(!src.includes(needle), `${what}\n  encore présent : ${needle}`);
  passed += 1;
};

const PAGE = readFileSync('src/administration/recettesPage.jsx', 'utf8').replace(/\r\n/g, '\n');

/* ── 1. Le bandeau de cartes de synthèse a disparu ─────────────────────────
   Le composant local `SummaryCard` et le useMemo `totals` qui l’alimentait
   sont partis ENSEMBLE : sans les cartes, ce calcul ne servait plus à rien
   (et le lint signalerait une variable morte). */
eq(count(PAGE, /<SummaryCard/g), 0, 'plus aucune carte de synthèse rendue dans la page');
gone(PAGE, 'const SummaryCard =', 'le composant local SummaryCard a été retiré');
eq(count(PAGE, /const totals = useMemo/g), 0, 'le calcul des totaux de page a été retiré');
eq(count(PAGE, /totals/gi), 0, 'plus la moindre référence à `totals` dans la page');
gone(PAGE, 'Cartes de synthèse', 'le commentaire du bandeau de synthèse a disparu');
gone(PAGE, 'bandeau compact', 'aucun bandeau « compact » de synthèse ne subsiste');
gone(PAGE, 'grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-10 gap-1.5',
  'la grille à 10 colonnes du bandeau de totaux a disparu');

/* Les libellés qui n’existaient QUE dans ce bandeau (les autres — « Budget
   total », « Solde prévu », « OM payés », « Achats prévus », « Prestations
   internes »… — subsistent comme colonnes de la table). */
gone(PAGE, 'Mis à disposition (univ.)', 'la carte « Mis à disposition (univ.) » a disparu');
gone(PAGE, 'OM payés (Dépenses)', 'la carte « OM payés (Dépenses) » a disparu');
gone(PAGE, 'OM prévus (acceptés)', 'la carte « OM prévus (acceptés) » a disparu');
gone(PAGE, 'Solde restant', 'la carte « Solde restant » a disparu');

/* ── 2. La phrase d’aide de la barre d’actions a disparu ─────────────────── */
gone(PAGE, 'Chaque ligne affiche ses montants', 'la phrase d’aide de la barre d’actions a disparu');
gone(PAGE, 'survolez une case pour le détail', 'aucun reste de la phrase d’aide (2e moitié)');
has(PAGE, 'flex items-center justify-end gap-3 flex-wrap',
  'la barre d’actions n’a plus que ses boutons, alignés à droite');
has(PAGE, 'Plus de bandeau de TOTAUX en tête de page',
  'un commentaire explique pourquoi la page n’a plus de bandeau de totaux');

/* ── 3. Les actions restent (les « pulsanti » de la demande) ─────────────── */
has(PAGE, '<span className="text-base leading-none">📥</span> Importer',
  'le bouton « 📥 Importer » est toujours là');
has(PAGE, 'onClick={() => setImportOpen(true)}', 'le bouton Importer ouvre toujours la modale d’import');
has(PAGE, '<AdminImportModal kind="recettes"', 'la modale d’import « recettes » reste montée');
has(PAGE, 'Nouvelle ligne budgétaire', 'le bouton « + Nouvelle ligne budgétaire » est toujours là');
has(PAGE, "onClick={() => setModal({ mode: 'new' })}", 'le bouton « + » ouvre toujours la fiche de création');
has(PAGE, 'onCancel={() => setModal(null)} onSave={onSaveLine}',
  'la fiche de ligne budgétaire reste branchée (création / modification)');

/* ── 4. Les onglets et la grande table restent ───────────────────────────── */
has(PAGE, "{ id: 'budgets', icon: '📈', label: 'Lignes budgétaires', count: budgets.length }",
  'l’onglet « Lignes budgétaires » (avec son compteur) est intact');
has(PAGE, "{ id: 'salaires', icon: '👤', label: 'Salaires', count: salaires.length }",
  'l’onglet « Salaires » (avec son compteur) est intact');
has(PAGE, '<div className="h-full min-h-0 w-full min-w-0 mx-auto flex flex-col gap-4">',
  'la page occupe toujours exactement la hauteur de l’écran');
has(PAGE, '<div className="flex-1 min-h-[280px] flex flex-col">',
  'la table garde son enveloppe « hauteur restante » (barre de défilement visible)');
has(PAGE, 'columns={recetteCols}', 'la table reçoit toujours ses colonnes');
has(PAGE, 'rows={recetteRows}', 'la table reçoit toujours ses lignes enrichies');
has(PAGE, 'minWidth="1600px"', 'la table garde sa largeur minimale (aucune colonne perdue)');
has(PAGE, 'fillHeight', 'la table garde le mode « remplir la hauteur »');
has(PAGE, 'searchPlaceholder="Rechercher une ligne, un porteur, une note…"',
  'la recherche de la table est intacte');
has(PAGE, 'Aucune ligne budgétaire pour le moment', 'l’état vide de la table est intact');

/* ── 5. Les montants vivent maintenant LIGNE PAR LIGNE (dans la table) ───── */
has(PAGE, 'const aggFor = (rec) => {', 'les agrégats par ligne sont toujours calculés');
has(PAGE, '() => activeRecettes.map((rec) => ({ ...rec, __agg: aggFor(rec) }))',
  'chaque ligne du tableau porte ses agrégats (`__agg`)');
has(PAGE, "key: 'budgetTotal', label: 'Budget total'", 'la colonne « Budget total » est toujours là');
ok(count(PAGE, /euro\.format\(/g) >= 10,
  'les montants restent mis en forme par `euro.format(...)` (colonne, infobulles, fiche)');
ok(count(PAGE, /__agg/g) >= 20, 'les cellules agrégées (__agg) alimentent toujours la table');

/* ── 6. Entre les onglets et la table, plus rien d’autre ────────────────── */
const between = PAGE.slice(PAGE.indexOf("id: 'budgets'"), PAGE.indexOf('{/* Table des lignes budgétaires */}'));
ok(!between.includes('SummaryCard') && !between.includes('grid'),
  'entre les onglets et la table il ne reste aucune carte ni grille de synthèse');

/* ── Bilan ────────────────────────────────────────────────────────────── */
console.log(`_recettes_no_totals_banner_test.mjs — ${passed} assertions OK (page Recettes : plus de bandeau de totaux, seulement les boutons et la table)`);
