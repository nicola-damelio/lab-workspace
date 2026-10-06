/* =========================================================================
   _admin_header_boxes_test.mjs — les PAVÉS D’EXPLICATION en haut des pages
   « OM prévus / souhaités », « Achats prévus / souhaités », « Congés » et
   « Budget overview » ont été retirés.

   Ces quatre pages ouvraient sur un paragraphe de mode d’emploi (pavé bleu /
   vert « Fonctionnement : », « OM prévus / souhaités : », « Achats prévus /
   souhaités : », ou le texte de la carte d’en-tête du studio budgétaire) qui
   doublonnait le mode d’emploi déjà à sa place : la documentation des pages
   (blurbs / champs de Setup) et les infobulles des colonnes et des champs.
   La page s’ouvre donc directement sur sa barre d’action, puis le tableau /
   les graphiques.

   Dans la même passe, la page « OM prévus » a perdu l’aide verrou qui
   doublonnait l’infobulle de ses boutons de transfert : « 🔒 “Pour signature”
   est inactif tant que TOUS les postes “Commande” n’ont pas un N° de devis +
   un fichier… ». Le VERROU reste (le bouton reste désactivé tant que les postes
   « Commande » sont incomplets) et il reste EXPLIQUÉ, une fois, par les deux
   infobulles : celle de « Pour signature » (ce qu’il faut pour l’activer) et
   celle de « ✎ Révision » (la voie à suivre quand des devis manquent).

   Vérifications : le SOURCE des quatre pages — les pavés ont disparu ET ce qui
   doit rester (titre, barre d’action, états vides, câblage du tableau
   « hauteur d’écran ») est intact.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let passed = 0;
const SRC = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const has = (src, needle, what) => {
  assert.ok(src.includes(needle), `${what}\n  introuvable : ${needle}`);
  passed += 1;
};
const gone = (src, needle, what) => {
  assert.ok(!src.includes(needle), `${what}\n  encore présent : ${needle}`);
  passed += 1;
};

const om = SRC('src/administration/omPage.jsx');
const desiderata = SRC('src/administration/desiderataPage.jsx');
const conges = SRC('src/administration/congesPage.jsx');
const budget = SRC('src/administration/budgetPage.jsx');

/* ── 1. Les pavés ont disparu ──────────────────────────────────────────────
   Le pavé se reconnaît à sa classe (bordure + fond très clair + texte 11px
   « leading-relaxed ») : plus aucun de ces fichiers n’en porte. */
const PAVES = ['bg-blue-50/60 px-4 py-2.5', 'bg-teal-50/60 px-4 py-2.5'];
[['OM prévus', om], ['Achats prévus', desiderata], ['Congés', conges]].forEach(([label, src]) => {
  PAVES.forEach((cls) => gone(src, cls, `${label} : le pavé d’explication « ${cls} » a disparu`));
});

/* Les phrases qui n’existaient QUE dans ces pavés. */
gone(om, 'chaque OM décrit une mission à préparer', 'OM prévus : la première phrase du pavé a disparu');
gone(
  om,
  '« ✏️ Modifier » ouvre la fiche, « 🗑️ » supprime, « 📥 Importer » rejoue la feuille',
  'OM prévus : la dernière phrase du pavé a disparu',
);
gone(desiderata, 'chaque membre déclare ses achats souhaités', 'Achats prévus : la première phrase du pavé a disparu');
gone(
  desiderata,
  'la <b>ligne budgétaire</b> et le <b>demandeur</b> sont des liens vers la Librerie',
  'Achats prévus : la dernière phrase du pavé a disparu',
);
gone(conges, 'chacun pose sa demande (statut « Demande »)', 'Congés : la première phrase du pavé a disparu');
gone(conges, 'Quota par défaut : 47 jours pour un Doctorant', 'Congés : la dernière phrase du pavé a disparu');

/* Budget overview : le mode d’emploi vivait dans la carte d’en-tête. */
gone(
  budget,
  'Composez vos propres graphiques de suivi budgétaire',
  'Budget overview : le mode d’emploi de la carte d’en-tête a disparu',
);
gone(
  budget,
  'Chaque membre retrouve son tableau de bord à l’ouverture de la page.',
  'Budget overview : …jusqu’à sa dernière phrase',
);

/* ── 2. Ce qui doit RESTER ─────────────────────────────────────────────────
   Le pavé était posé entre la barre d’action et le tableau / les graphiques :
   ces deux voisins se suivent désormais directement. */
has(
  om,
  'consoleUrl={notice.consoleUrl} onClose={() => setNotice(null)} />}\n\n      {visibleRows.length === 0 ? (',
  'OM prévus : la barre d’action (et sa notice) précède directement le tableau / l’état vide',
);
has(
  desiderata,
  '      )}\n\n      {visibleSorted.length === 0 ? (',
  'Achats prévus : la notice précède directement le tableau / l’état vide',
);
has(
  conges,
  '      )}\n\n      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">',
  'Congés : les soldes précèdent directement la carte « Jours fériés »',
);

/* Les barres d’action, titres et états vides des quatre pages sont intacts. */
has(om, '<span className="text-base leading-none">＋</span> Ajouter un OM', 'OM prévus : le bouton « Ajouter un OM » reste');
has(om, 'Aucun OM prévu / souhaité', 'OM prévus : l’état vide reste');
has(desiderata, 'Ajouter un achat prévu / souhaité', 'Achats prévus : le bouton « Ajouter » reste');
has(desiderata, 'Aucun achat prévu / souhaité', 'Achats prévus : l’état vide reste');
has(conges, 'Ajouter une demande', 'Congés : le bouton « Ajouter une demande » reste');
has(conges, 'Jours fériés en France cette année', 'Congés : la carte des jours fériés reste');
has(budget, '<h2 className="text-xl font-black text-slate-800">Budget overview</h2>', 'Budget overview : le titre de la carte d’en-tête reste');
has(budget, 'espace personnel de {meName}', 'Budget overview : le badge « espace personnel » reste');
has(budget, 'Exemples prêts à l’emploi', 'Budget overview : les exemples en un clic restent');
has(budget, 'Créer un graphique', 'Budget overview : le bouton « Créer un graphique » reste');

/* ── 3. Le câblage « hauteur d’écran » des tableaux est intact ───────────── */
const FILL_WRAP = '<div className="flex-1 min-h-[280px] flex flex-col">';
[['OM prévus', om], ['Achats prévus', desiderata]].forEach(([label, src]) => {
  has(src, FILL_WRAP, `${label} : le tableau reste le seul élément extensible (fillHeight)`);
  has(src, 'fillHeight', `${label} : la table reçoit toujours fillHeight`);
});

/* ── 4. OM prévus : plus d’aide verrou sous les boutons de transfert ───────
   La ligne ambre « 🔒 “Pour signature” est inactif tant que… » a été retirée :
   elle répétait, en clair, ce que disent déjà les infobulles des deux boutons. */
gone(om, '🔒 « Pour signature » est inactif', 'OM prévus : l’aide verrou de la cellule Transfert a disparu');
gone(om, 'TOUS les postes « Commande » n’ont pas un N° de devis + un fichier', 'OM prévus : …et sa première phrase');
gone(om, 'Utilisez « ✎ Révision » : les devis partent', 'OM prévus : …et sa dernière phrase');
gone(om, 'leading-tight max-w-[300px]', 'OM prévus : le pavé ambre qui la portait a disparu');

/* Le VERROU, lui, reste en place : « Pour signature » est toujours désactivé
   tant que les postes « Commande » sont incomplets (dernier argument de
   transferButton). */
has(
  om,
  'const readyAll = !omTransferSummary(r).commande.some((p) => !omPartComplete(r, p.key));',
  'OM prévus : le calcul « tous les postes Commande sont complets » reste',
);
has(om, '!readyAll,', 'OM prévus : le bouton « Pour signature » reste verrouillé tant que les postes ne sont pas complets');

/* …et il reste EXPLIQUÉ : les infobulles des deux boutons couvrent les deux cas
   (« tout est complet » → signature ; « il manque des devis » → révision). */
has(
  om,
  'Tous les postes « Commande » ont un N° devis + fichier : créés « en attente de signature »',
  'OM prévus : l’infobulle de « Pour signature » dit ce qu’il faut pour l’activer',
);
has(
  om,
  'Les postes sans N° devis / fichier partent « En gestion » pour être complétés',
  'OM prévus : l’infobulle de « ✎ Révision » dit la voie à suivre pour compléter',
);

console.log(`_admin_header_boxes_test.mjs — ${passed} assertions OK (pavés d’explication retirés des pages OM prévus, Achats prévus, Congés et Budget overview ; aide verrou retirée sous les boutons de transfert d’OM prévus)`);
