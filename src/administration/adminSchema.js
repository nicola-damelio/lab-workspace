/* =========================================================================
   src/administration/adminSchema.js — source de vérité du module
   Administration (JS pur : les typedefs JSDoc servent d’interfaces du
   modèle). ADMIN_PAGES pilote la navigation latérale + la matrice d’accès.
   ========================================================================= */

/* ── Clés de contenu d’une base d’administration ──────────────────────────
   Une base d’administration est un dataset de kind 'administration' créé
   depuis la page d’accueil comme un dataset scientifique. Tout son contenu
   vit DANS le document du dataset (datasets/<id>) sous un payload
   `administration` { recettes, librerie, personnel, depenses, om,
   desiderate, questioni, sicurezza, settings }. Aucune sous-collection.    */
export const ADMIN_COLLECTIONS = {
  recettes: 'recettes',     // lignes budgétaires
  librerie: 'librerie',     // fournisseurs
  personnel: 'personnel',   // personnel + stagiaires
  depenses: 'depenses',     // dépenses / bons de commande (BC)
  om: 'om',                 // ordres de mission
  desiderate: 'desiderate', // souhaits d’achat
  questioni: 'questioni',   // questions ouvertes
  sicurezza: 'sicurezza',   // hygiène & sécurité
};

/* Types de base proposés sur la page d’accueil. */
export const DATASET_KINDS = ['scientific', 'administration'];
export const DATASET_KIND_META = {
  scientific: { label: 'Données scientifiques', icon: '🧪', blurb: 'Expériences, projets, cahier de laboratoire, bibliothèque, stockage, publications…' },
  administration: { label: 'Administration', icon: '🏛️', blurb: 'Recettes, fournisseurs, Personnel, Dépenses, OM, Spese Desiderate, Questioni, Igiene e Sicurezza + Paramètres' },
};
export const isAdministrationKind = (kind) => kind === 'administration';

/* Conservé pendant la migration ; le magasin d’options vit dans le payload
   de la base d’administration (administration.settings). */
export const ADMIN_SETTINGS_DOC = 'global';

/* ── Registre des pages + matrice d’accès ─────────────────────────────────
   superuserOnly = true  → page masquée hors superutilisateur, SAUF bootstrap
                           (aucun superutilisateur défini) pour Paramètres.
   superuserOnly = false → visible pour tout scientifique connecté.         */
export const ADMIN_PAGES = [
  { id: 'overview', label: 'Vue d’ensemble', icon: '📊', superuserOnly: false, kind: null,
    blurb: 'Vue d’ensemble des autres pages : lignes budgétaires, personnel, demandes, missions et questions ouvertes.',
    fields: [] },
  { id: 'recettes', label: 'Recettes', icon: '📈', superuserOnly: true, kind: 'recettes',
    blurb: 'Lignes budgétaires (Fonctionnement / Investissement) : porteur, budget total, montant mis à disposition, engagements, OM et souhaits.',
    fields: ['Ligne budgétaire', 'Type : Fonctionnement / Investissement', 'Porteur du projet', 'Budget total', 'Montant mis à disposition par l’université', 'Dépenses ordonnées (BC signés)', 'Ordres de mission (acceptés / à prévoir)', 'Spese Desiderate liées', 'Solde disponible', 'Date de fin d’engagement', 'Commentaires'] },
  { id: 'librerie', label: 'Librerie', icon: '📇', superuserOnly: false, kind: 'librerie',
    blurb: 'Catalogue des fournisseurs utilisé par les Dépenses et les Spese Desiderate.',
    fields: ['Nom du fournisseur', 'Contact', 'Email · Téléphone · Adresse', 'Catégories associées', 'Site web', 'Notes'] },
  { id: 'personnel', label: 'Personnel', icon: '👥', superuserOnly: true, kind: 'personnel',
    blurb: 'Personnel Permanent / Technique / Temporaire, corps & grades, missions, formations et bloc stagiaire lié à une Recette.',
    fields: ['Nom', 'Type : Permanent / Technique / Temporaire', 'Corps (PR, MCF, DR, CR, IR, IE, ASI, TECH, ATRF…)', 'Grade — sous-classification du corps (PR2, PR1, CE2, CE1, CN, HC, DR2, DR1…)', 'BAP · HDR · Catégorie · Échelon · Chevron', 'Dates contrat', 'Promotion · RIPEC', 'Missions · Formations', 'Stagiaire : encadrants · ligne budgétaire · dates · durée', 'Commentaires'] },
  { id: 'depenses', label: 'Dépenses', icon: '🧾', superuserOnly: false, kind: 'depenses',
    blurb: 'Dépenses / commandes avec pipeline complet (devis, SIFAC, BC, fournisseur, facture) et livraisons en plusieurs phases.',
    fields: ['Description', 'Demandeur', 'Catégorie Fonct. / Invest. · Nature', 'Ligne budgétaire liée (Recette)', 'Montant + frais de port', 'Devis · SIFAC · N° BC & dates', 'Fournisseur + contact', 'N° facture', 'Livraisons : arrivée, BL, Service Fait', 'Livraison complète'] },
  { id: 'om', label: 'OM', icon: '✈️', superuserOnly: false, kind: 'om',
    blurb: 'Ordres de mission : dates, demandeur, destination, coûts, statut (En attente / Acceptée…).',
    fields: ['Description', 'Demandeur', 'Date de demande · Départ · Retour', 'Destination', 'Transport · Hébergement · Repas · Inscription', 'Coût total (calculé)', 'Statut : En attente / Acceptée / Refusée / Terminée', 'Estimé vs Exact', 'Ligne budgétaire liée (Recette)', 'Commentaires'] },
  { id: 'desiderate', label: 'Spese Desiderate', icon: '🛒', superuserOnly: false, kind: 'desiderate',
    blurb: 'Souhaits d’achat. Le changement de statut est réservé au superutilisateur.',
    fields: ['Description', 'Urgence : Urgent / Important / Souhaitable', 'Demandeur', 'Catégorie', 'Ligne budgétaire suggérée (Recette)', 'Frais de port · Montant estimé', 'Fournisseur + contact · N° devis · Code produit', 'Commentaires', 'Statut — réservé au superutilisateur'] },
  { id: 'questioni', label: 'Questioni Aperte', icon: '❓', superuserOnly: false, kind: 'questioni',
    blurb: 'Tableau des questions ouvertes (A faire / En cours / Fait), responsable, tags.',
    fields: ['Description', 'Statut : A faire / En cours / Fait', 'Responsable', 'Tags / classification'] },
  { id: 'sicurezza', label: 'Igiene e Sicurezza', icon: '🛡️', superuserOnly: false, kind: 'sicurezza',
    blurb: 'Tâches d’hygiène & de sécurité du laboratoire, conservées dans leur section dédiée.',
    fields: ['Description', 'Statut : A faire / En cours / Fait', 'Responsable', 'Tags / classification', 'Sévérité (optionnelle)'] },
  { id: 'settings', label: 'Paramètres', icon: '⚙️', superuserOnly: true, kind: null,
    blurb: 'Rôles (scientifiques / superutilisateur) et options des listes déroulantes du module.',
    fields: ['Rôles (drapeau superutilisateur)', 'Options des listes déroulantes (natures, BAP, corps & grades…)'] },
];

/* ── Enveloppe commune de chaque enregistrement ─────────────────────────── */
/** @typedef {Object} AdminEnvelope
 * @property {string} id
 * @property {number} createdAt
 * @property {{name:string, role:string}} createdBy
 * @property {number} updatedAt
 * @property {{name:string, role:string}} updatedBy */
export const AUDIT_FIELDS = ['id', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy'];

/* ── Entités (interfaces du modèle de données) ──────────────────────────── */
/**
 * @typedef {Object} Recette
 * @property {string} ligne             // intitulé de la ligne budgétaire
 * @property {('Fonctionnement'|'Investissement')} type
 * @property {string} porteur           // nom du porteur de projet
 * @property {?string} porteurId        // id du membre du personnel lié
 * @property {?number} budgetTotal      // budget total alloué à la ligne
 * @property {?number} budgetRenduDispo // montant mis à dispo par l’université
 * @property {?string} dateFinEngagement
 * @property {string} notes
 * @property {string} categorie         // (legacy)
 * @property {?number} budgetConsomme   // (legacy)
 * @property {?number} budgetDisponible // (legacy)
 * @property {Array<{nom:string, montant:number, date:string, statut:string}>} tranches // (legacy)
 */
/**
 * @typedef {Object} Depense
 * @property {string} description
 * @property {string} demandeur
 * @property {('Fonctionnement'|'Investissement')} categorie
 * @property {string} nature
 * @property {?string} recetteId        // ligne budgétaire imputée
 * @property {?number} montant
 * @property {?number} fraisPort
 * @property {?string} dateDemande
 * @property {?string} fournisseurId
 * @property {string} devisNo
 * @property {string} sifacNo
 * @property {?string} dateBC
 * @property {string} bcNo
 * @property {?string} dateSignatureBC  // « BC signé »
 * @property {?string} dateAcceptationFournisseur
 * @property {string} factureNo
 * @property {boolean} livraisonComplete
 * @property {Array<{dateArrivee:string, blNo:string, dateSF:string, sfNo:string}>} livraisons
 * @property {string} statut
 */
/**
 * @typedef {Object} MissionOrder
 * @property {string} description
 * @property {string} demandeur
 * @property {?string} recetteId        // ligne budgétaire imputée
 * @property {('En attente'|'Acceptée'|'Refusée'|'Terminée')} statut
 * @property {?string} dateDemande
 * @property {?string} dateDebut
 * @property {?string} dateRetour
 * @property {string} destination
 * @property {?number} coutTransport
 * @property {?number} coutHebergement
 * @property {?number} coutRepas
 * @property {?number} coutInscription
 * @property {number} coutTotal
 * @property {('Estimé'|'Exact')} coutStatut
 * @property {string} commentaires
 */
/**
 * @typedef {Object} Desiderata
 * @property {string} description
 * @property {('Urgent'|'Important'|'Souhaitable')} urgence
 * @property {string} demandeur
 * @property {('Fonctionnement'|'Investissement')} categorie
 * @property {?string} recetteSuggereeId
 * @property {?number} montantEstime
 * @property {?number} fraisPort
 * @property {?string} dateDemande
 * @property {string} fournisseurNom
 * @property {string} fournisseurContact
 * @property {string[]} devisNumbers
 * @property {string} codeProduit
 * @property {string} commentaires
 * @property {('Pending'|'Approved'|'En attente'|'Rejected / Pas maintenant')} statut
 * @property {?string} statutChangedBy
 * @property {?number} statutChangedAt
 */
/** @typedef {Object} IssueRecord
 * @property {string} description
 * @property {('A faire'|'En cours'|'Fait')} statut
 * @property {string} responsable
 * @property {string[]} tags
 * @property {string} severite
 * @property {?number} dateCreation
/* ── Listes d’options (listes déroulantes + magasin d’options Paramètres) ─ */
export const RECETTE_TYPES = ['Fonctionnement', 'Investissement'];
export const TRANCHES_STATUSES = ['Disponible', 'Engagé', 'Consommé'];
export const PERSONNEL_TYPES = ['Permanent', 'Technique', 'Temporaire'];
export const PERSONNEL_CORPS = ['PR', 'MCF', 'IR', 'IE', 'ASI', 'TECH', 'ATRF', 'DR', 'CR', 'PRAG', 'PRCE', 'Post-doc', 'ATER', 'Doctorant', 'Stagiaire'];
export const GRADES_BY_CORPS = {
  PR: ['PR2', 'PR1', 'CE2', 'CE1'], MCF: ['CN', 'HC'], IR: ['CN', 'HC'],
  IE: [], ASI: [], TECH: [], ATRF: [], DR: ['DR2', 'DR1'], CR: ['CR2', 'CR1'],
  PRAG: [], PRCE: [], 'Post-doc': [], ATER: [], Doctorant: [], Stagiaire: [],
};
export const BAP_LIST = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'J'];
export const DUTY_SUGGESTIONS = ['SST', 'ASV', 'Radioprotection', 'Sécurité incendie', 'Habilitations électriques', 'Prévention des risques chimiques'];
export const DEPENSE_NATURES = ['Consommables', 'Stages', 'Instrumentation', 'Meetings', 'Audit', 'Prestations', 'Autre'];
export const URGENCES = ['Urgent', 'Important', 'Souhaitable'];
export const DESIDERATE_STATUSES = ['Pending', 'Approved', 'En attente', 'Rejected / Pas maintenant'];
export const OM_COST_STATUSES = ['Estimé', 'Exact'];
export const ISSUE_STATUSES = ['A faire', 'En cours', 'Fait'];

/* Statuts ajoutés pour le suivi budgétaire des pages Dépenses / OM. */
export const DEPENSE_STATUSES = ['Devis en cours', 'SIFAC transmis', 'BC signé', 'Livré', 'Facturé', 'Clôturé'];
export const DEPENSE_BC_SIGNE = 'BC signé';
export const OM_STATUSES = ['En attente', 'Acceptée', 'Refusée', 'Terminée'];

/** Valeurs par défaut du magasin d’options Paramètres d’une base. */
export const DEFAULT_OPTIONS = {
  recetteTypes: RECETTE_TYPES,
  tranchesStatuses: TRANCHES_STATUSES,
  personnelTypes: PERSONNEL_TYPES,
  corps: PERSONNEL_CORPS,
  gradesByCorps: GRADES_BY_CORPS,
  bap: BAP_LIST,
  dutySuggestions: DUTY_SUGGESTIONS,
  depenseNatures: DEPENSE_NATURES,
  urgencies: URGENCES,
  desiderateStatuses: DESIDERATE_STATUSES,
  omCostStatuses: OM_COST_STATUSES,
  omStatuses: OM_STATUSES,
  depenseStatuses: DEPENSE_STATUSES,
  issueStatuses: ISSUE_STATUSES,
};

/* ── Aides ──────────────────────────────────────────────────────────────── */
/** Libellé lisible d’une collection (placeholders / vue d’ensemble). */
export const collectionLabel = (kind) => {
  const page = ADMIN_PAGES.find((p) => p.kind === kind);
  return page ? page.label : kind;
};

/**
 * Existe-t-il déjà un superutilisateur dans la liste des opérateurs ?
 * Accepte les entrées modernes ({id,name,role,passwordHash}) et legacy (string).
 */
export const hasDefinedSuperuser = (operators) =>
  (Array.isArray(operators) ? operators : []).some((op) =>
    typeof op === 'object' && op !== null ? op.role === 'superuser' : false
  );

/**
 * Matrice de visibilité d’une page d’administration pour un utilisateur donné.
 * En bootstrap (aucun compte ou aucun superutilisateur défini), la page
 * « Paramètres » reste accessible pour créer l’équipe / le superutilisateur.
 */
export const adminCanViewPage = (page, currentUser, operators) => {
  if (!page || !page.superuserOnly) return true;
  if (currentUser && currentUser.role === 'superuser') return true;
  if (page.id === 'settings' && !hasDefinedSuperuser(operators)) return true;
  return false;
};

/* ── Semence d’une base d’administration ────────────────────────────────── */
/** Contenu vide d’une nouvelle base d’administration (un objet par dataset). */
export const createAdministrationSeed = () => {
  const lists = {};
  Object.keys(ADMIN_COLLECTIONS).forEach((k) => { lists[k] = []; });
  lists.settings = JSON.parse(JSON.stringify(DEFAULT_OPTIONS));
  return lists;
};


