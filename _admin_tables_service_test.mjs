/* =========================================================================
   _admin_tables_service_test.mjs — trois demandes sur le dataset
   « administration », et ce qui doit rester vrai après :

   1. RECETTES / OM PRÉVUS / ACHATS PRÉVUS : la barre de défilement
      HORIZONTALE des grands tableaux doit rester visible en permanence — plus
      besoin de faire défiler la page entière pour aller la rejoindre au bas du
      tableau. Les trois pages adoptent donc la convention déjà en place sur la
      page « Dépenses » : la page occupe EXACTEMENT la hauteur de l’écran
      (`h-full min-h-0`), le tableau est le seul élément extensible
      (`flex-1 min-h-[280px]`) et reçoit `fillHeight` (SmartTable) — le bloc
      défilant prend alors la hauteur restante et sa barre horizontale reste à
      l’écran.

   2. ACHATS PRÉVUS : le champ « Demandeur » propose « Service » (demandeur
      collectif) et une demande déposée à ce nom est VISIBLE PAR TOUS les
      membres — même règle que la page « Approbation devis & BC ». La règle vit
      dans UN endroit testable : src/administration/ownScope.js
      (`scopeIsServiceDemandeur`).

   3. APPROBATION DEVIS & BC : la table affiche la LIGNE BUDGÉTAIRE de chaque
      devis / BC (intitulé enregistré, sinon l’intitulé à jour de la recette
      liée).

   Vérifications : le CODE PUR des règles (imports réels) + le câblage JSX
   (les sources), comme les autres suites du dépôt.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);

const { scopeIsServiceDemandeur, scopeCanSeeItem, scopeSameName, scopeNameKey } =
  await import('./src/administration/ownScope.js');
const { SERVICE_DEMANDEUR } = await import('./src/administration/adminSchema.js');

let passed = 0;
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};
const eq = (a, b, what) => {
  assert.equal(a, b, what);
  passed += 1;
};
const SRC = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const has = (src, needle, what) => {
  assert.ok(src.includes(needle), `${what}\n  introuvable : ${needle}`);
  passed += 1;
};
const gone = (src, needle, what) => {
  assert.ok(!src.includes(needle), `${what}\n  encore présent : ${needle}`);
  passed += 1;
};

const recettes = SRC('src/administration/recettesPage.jsx');
const om = SRC('src/administration/omPage.jsx');
const desiderata = SRC('src/administration/desiderataPage.jsx');
const approbation = SRC('src/administration/approbationPage.jsx');
const smartTable = SRC('src/administration/smartTable.jsx');
const schema = SRC('src/administration/adminSchema.js');

/* ── 1. Barre de défilement horizontale TOUJOURS visible ─────────────────── */
eq(SERVICE_DEMANDEUR, 'Service', 'le demandeur collectif s’appelle bien « Service »');

const FILL_WRAP = '<div className="flex-1 min-h-[280px] flex flex-col">';
const PAGE_ROOT = 'h-full min-h-0 w-full min-w-0 mx-auto flex flex-col gap-4';
const OLD_ROOT = '<div className="max-w-full mx-auto flex flex-col gap-4">';

[['Recettes', recettes], ['OM prévus', om], ['Achats prévus', desiderata]].forEach(([label, src]) => {
  has(src, PAGE_ROOT, `${label} : la page occupe exactement la hauteur de l’écran (h-full + min-h-0)`);
  gone(src, OLD_ROOT, `${label} : l’ancienne racine (hauteur libre) a disparu`);
  has(src, FILL_WRAP, `${label} : le tableau est le seul élément extensible (flex-1 min-h-[280px])`);
  has(src, 'fillHeight', `${label} : le tableau reçoit fillHeight (la barre horizontale reste à l’écran)`);
});

/* Le mode fillHeight est bien celui qui garde la barre horizontale visible :
   le bloc défilant prend la hauteur restante (`flex-1 min-h-0`) et n’a plus de
   plafond `maxHeight` ; le conteneur externe devient une colonne flex. */
has(smartTable, "fillHeight ? 'flex-1 min-h-0'", 'SmartTable : en fillHeight, le bloc défilant prend la hauteur restante');
has(smartTable, "style={!fillHeight && maxHeight ? { maxHeight } : undefined}", 'SmartTable : le plafond maxHeight est désactivé en fillHeight');
has(smartTable, "fillHeight ? 'flex flex-1 min-h-0 flex-col'", 'SmartTable : en fillHeight, la carte est une colonne flex extensible');

/* ── 2. « Service » dans Achats prévus, visible par tous ─────────────────── */

/* (a) La règle de visibilité (code pur). */
eq(scopeIsServiceDemandeur({ demandeur: 'Service' }), true, 'une demande « demandeur = Service » est collective');
eq(scopeIsServiceDemandeur({ demandeur: 'service' }), true, 'la casse ne change rien (« service »)');
eq(scopeIsServiceDemandeur({ porteur: '  SERVICE ' }), true, 'les espaces/la casse ne changent rien (« SERVICE »)');
eq(scopeIsServiceDemandeur({ demandeur: 'Marie Curie' }), false, 'une personne n’est pas le demandeur collectif');
eq(scopeIsServiceDemandeur({ demandeur: 'Service comptable' }), false, '« Service comptable » n’est pas « Service »');
eq(scopeIsServiceDemandeur({}), false, 'une ligne sans demandeur n’est pas collective');
eq(scopeIsServiceDemandeur(null), false, 'une ligne absente n’est pas collective');
eq(scopeSameName('Service', 'service'), true, 'scopeSameName compare le demandeur collectif sans tenir compte de la casse');
eq(scopeNameKey('Service'), scopeNameKey('  service  '), 'la clé de nom du demandeur collectif est stable');

/* Preuve du besoin : la règle habituelle (« chacun ne voit que ses demandes »)
   NE rend PAS visible une demande du Service → la page doit l’ajouter. */
eq(
  scopeCanSeeItem({ demandeur: 'Service' }, { isSuper: false, meNames: ['Marie Curie'], mePersonId: 'p1' }),
  false,
  'scopeCanSeeItem seul ne montre pas la demande du Service au membre',
);

/* (b) Le câblage de la page. */
has(desiderata, 'scopeIsServiceDemandeur, scopeSameName', 'desiderataPage importe la règle de visibilité du Service');
has(desiderata, 'SERVICE_DEMANDEUR,', 'desiderataPage importe le libellé SERVICE_DEMANDEUR');
has(
  desiderata,
  'scopeIsServiceDemandeur(r) || scopeCanSeeItem(r, { isSuper, meNames, mePersonId })',
  'la liste mêle les demandes du Service à ses propres demandes',
);
has(desiderata, 'set.add(SERVICE_DEMANDEUR);', '« Service » est proposé dans le champ Demandeur');
has(
  desiderata,
  "'Service (au nom de l’équipe — visible par tous)'",
  'le formulaire du membre propose « Service » (demandeur collectif)',
);
has(
  desiderata,
  'scopeSameName(patch.demandeur, SERVICE_DEMANDEUR)',
  'à l’enregistrement, une demande du Service n’est attribuée à aucune fiche Personnel',
);
has(desiderata, 'patch.demandeurPersonId = null;', 'l’attribution personnelle est effacée pour une demande du Service');
has(desiderata, 'demandeurChoices', 'le choix « vous-même / Service » est construit pour le formulaire du membre');
gone(desiderata, 'readOnly={lockDemandeurToMe}', 'le champ Demandeur du membre n’est plus figé : « Service » est sélectionnable');

/* (c) La page « Approbation devis & BC » applique déjà la même règle. */
has(approbation, 'sameName(txt(r.demandeur), SERVICE_DEMANDEUR)', 'Approbation : les devis / BC « Service » sont visibles par tous');

/* (d) La documentation in-code (blurb / champs) suit la règle. */
has(schema, 'VISIBLE PAR TOUS les membres', 'adminSchema : le blurb des Achats prévus décrit la visibilité du Service');
has(schema, 'Demandeur — soi-même ou « Service »', 'adminSchema : le champ Demandeur documente « Service »');

/* ── 3. Ligne budgétaire dans la table « Approbation devis & BC » ────────── */
has(approbation, "key: 'ligne', label: 'Ligne budgétaire'", 'la table devis & BC expose la colonne « Ligne budgétaire »');
has(approbation, 'const recettesById = useMemo(', 'l’intitulé à jour de la recette liée est indexé (recettesById)');
has(approbation, 'recettesById,', 'recettesById est passé au constructeur de colonnes');
has(
  approbation,
  'const found = r && r.recetteId && recettesById ? recettesById.get(r.recetteId) : null;',
  'la colonne résout la recette liée (recetteId) quand l’intitulé manque',
);
has(approbation, "quickFilters={['description', 'fournisseur', 'ligne']}", 'le filtre rapide « Ligne budgétaire » est disponible');
has(schema, "'Ligne budgétaire (Recettes)'", 'adminSchema : les champs de la page devis & BC listent la ligne budgétaire');

/* Ordre des colonnes : Décision · N° · Objet · Fournisseur · LIGNE BUDGÉTAIRE
   · Montant … (la ligne budgétaire se lit avant le montant). */
const iFournisseur = approbation.indexOf("key: 'fournisseur', label: 'Fournisseur'");
const iLigne = approbation.indexOf("key: 'ligne', label: 'Ligne budgétaire'");
const iMontant = approbation.indexOf("key: 'montant', label: 'Montant HT + port'");
ok(
  iFournisseur > -1 && iLigne > iFournisseur && iMontant > iLigne,
  'la colonne « Ligne budgétaire » est placée entre « Fournisseur » et « Montant »',
);

console.log(`_admin_tables_service_test.mjs — ${passed} assertions OK (barre horizontale visible, demandeur « Service » visible par tous, ligne budgétaire affichée)`);


