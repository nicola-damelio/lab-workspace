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
   desiderate, devisBc, conges, questioni, sicurezza, settings }. Aucune
   sous-collection.    */
export const ADMIN_COLLECTIONS = {
  recettes: 'recettes',     // lignes budgétaires
  librerie: 'librerie',     // fournisseurs
  personnel: 'personnel',   // personnel + stagiaires
  depenses: 'depenses',     // dépenses / bons de commande (BC)
  om: 'om',                 // ordres de mission
  reimbursements: 'reimbursements', // remboursements de frais — registre INDÉPENDANT des Dépenses (jamais de BC / SIFAC)
  conges: 'conges',     // congés & absences : demandes + approbation
  desiderate: 'desiderate', // souhaits d’achat
  devisBc: 'devisBc',       // devis & BC déposés pour approbation (signature superutilisateur)
  questioni: 'questioni',   // questions ouvertes
  sicurezza: 'sicurezza',   // hygiène & sécurité
};

/* Types de base proposés sur la page d’accueil. */
export const DATASET_KINDS = ['scientific', 'administration'];
export const DATASET_KIND_META = {
  scientific: { label: 'Données scientifiques', icon: '🧪', blurb: 'Expériences, projets, cahier de laboratoire, bibliothèque, stockage, publications…' },
  administration: { label: 'Administration', icon: '🏛️', blurb: 'Recettes, fournisseurs, Personnel, Dépenses (BC/PI), OM prévus / souhaités, Achats prévus / souhaités, Congés, questions ouvertes, hygiène & sécurité + Setup' },
};
export const isAdministrationKind = (kind) => kind === 'administration';

/* Conservé pendant la migration ; le magasin d’options vit dans le payload
   de la base d’administration (administration.settings). */
export const ADMIN_SETTINGS_DOC = 'global';

/* ── Registre des pages + matrice d’accès ─────────────────────────────────
   Le droit d’accès d’un scientifique N’EST PLUS un simple drapeau : il est
   calculé depuis sa fiche Personnel (voir adminAccessProfile / adminPageIdsForProfile
   plus bas). superuserOnly = true ne s’applique qu’aux pages réellement
   réservées au superutilisateur (Personnel, Paramètres) — Paramètres reste
   accessible en bootstrap (aucun superutilisateur défini) pour créer l’équipe.
   Récapitulatif de la matrice (validée avec l’équipe) :
     • Statut Permanent  (type Permanent ou Technique) sans fonction = socle :
         Recettes · OM prévus / souhaités · Achats prévus / souhaités · Approbation devis & BC · Librairie
     • Pages « Dépenses » et « Budget overview » = réservées aux fonctions AP et
         Gestionnaire (et au superutilisateur) ; les Permanents sans fonction
         ne les voient pas.
     • Statut Non permanent = onglet Congés uniquement.
     • Page Congés (demandes d’absence) = réservée aux profils Non permanent
         et au superutilisateur (rôle d’approbation) ; les Permanents ne la voient pas.
     • Fonction AP (agent de prévention)  → ajoute Dépenses + Budget overview + Hygiène & Sécurité.
     • Fonction Gestionnaire              → ajoute Dépenses + Budget overview + Questions ouvertes.
     • Personnel & Setup → superutilisateur uniquement.
   Le superutilisateur conserve, lui, l’accès intégral à toutes les pages.  */
export const ADMIN_PAGES = [
  { id: 'overview', label: 'Vue d’ensemble', icon: '📊', superuserOnly: false, kind: null,
    blurb: 'Vue d’ensemble des autres pages : lignes budgétaires, personnel, demandes, missions et questions ouvertes.',
    fields: [] },
  { id: 'recettes', label: 'Recettes', icon: '📈', superuserOnly: false, kind: 'recettes',
    blurb: 'Lignes budgétaires (Fonctionnement / Investissement) : porteur, budget total, montant mis à disposition, engagements, OM et souhaits.',
    fields: ['Ligne budgétaire', 'Type : Fonctionnement / Investissement', 'Porteur du projet', 'Budget total', 'Montant mis à disposition par l’université', 'Dépenses ordonnées (BC signés)', 'OM prévus / souhaités (acceptés / à prévoir)', 'Achats prévus / souhaités liés', 'Solde disponible', 'Date de fin d’engagement', 'Commentaires'] },
  { id: 'depenses', label: 'Dépenses', icon: '🧾', superuserOnly: false, kind: 'depenses',
    blurb: 'Dépenses / commandes avec pipeline complet (devis, SIFAC, BC, fournisseur, facture) et livraisons en plusieurs phases.',
    fields: ['Description', 'Demandeur', 'Catégorie Fonct. / Invest. · Nature', 'Ligne budgétaire liée (Recette)', 'Montant + frais de port', 'Devis · N° SIFAC/D.A. · N° BC & dates', 'Fournisseur + contact', 'N° facture', 'Livraisons : arrivée, BL, Service Fait', 'Livraison complète'] },
  { id: 'om', label: 'OM prévus / souhaités', icon: '✈️', superuserOnly: false, kind: 'om',
    blurb: 'Ordres de mission prévus / souhaités : dates, demandeur, destination, coûts, statut (En attente / Acceptée…). Un OM « Acceptée » peut être transféré en dépense réelle (page Dépenses › onglet OM).',
    fields: ['Description', 'Demandeur', 'Date de demande · Départ · Retour', 'Destination', 'Transport · Hébergement · Repas · Inscription', 'Coût total (calculé)', 'Statut : En attente / Acceptée / Refusée / Terminée', 'Estimé vs Exact', 'Ligne budgétaire liée (Recette)', 'Commentaires'] },
  { id: 'desiderate', label: 'Achats prévus / souhaités', icon: '🛒', superuserOnly: false, kind: 'desiderate',
    blurb: 'Achats prévus / souhaités de l’équipe : coût estimé et frais de port saisis par le demandeur, décision réservée au superutilisateur (Approuvé / En attente / Pas maintenant).',
    fields: ['Décision — réservée au superutilisateur : Approuvé / En attente / Pas maintenant', 'Souhait d’achat', 'Urgence : Urgent / Important / Souhaitable', 'Demandeur', 'Fournisseur', 'Ligne budgétaire suggérée', 'Coût estimé', 'Frais de port', 'N° devis · Lien du devis (Drive, facultatif) · Code produit', 'Date de demande', 'Commentaires'] },
  { id: 'devisBc', label: 'Approbation devis & BC', icon: '📝', superuserOnly: false, kind: 'devisBc',
    blurb: 'Dépôt des devis et bons de commande à faire signer par le superutilisateur (visibles par les Permanents). Les fichiers sont téléversés dans Budget_labo/<année>/Devis|BC ; l’approbation d’un devis crée la dépense « Devis en cours » et celle du BC la fait passer à « BC signé » (liens automatiques).',
    fields: ['Statut : En attente / Approuvé / Refusé (décision réservée au superutilisateur)', 'Type : Devis ou BC', 'Description', 'Fournisseur', 'N° devis · N° BC', 'Montant (optionnel)', 'Fichier téléversé (Budget_labo/<année>/Devis ou /BC)', 'Déposant', 'Date de dépôt', 'Dépense créée automatiquement à l’approbation'] },
  { id: 'budget', label: 'Budget overview', icon: '💶', superuserOnly: false, kind: null,
    blurb: 'Graphiques personnels de suivi budgétaire : dépenses par classification, ligne budgétaire, opérateur, mois / année / jour, budgets & soldes par ligne, OM et souhaits — chaque membre enregistre ses propres graphiques.',
    fields: ['Camembert / Barres / Courbe', 'Dépenses : classification, catégorie, statut, fournisseur, opérateur, ligne budgétaire, mois / année / jour', 'Budgets (Recettes) : budget total, mis à disposition, BC signés, OM, souhaits approuvés, solde', 'OM & souhaits : par période, statut, destination…'] },
  { id: 'questioni', label: 'Questions ouvertes', icon: '❓', superuserOnly: false, kind: 'questioni',
    blurb: 'Tableau des questions ouvertes (A faire / En cours / Fait), responsable, tags.',
    fields: ['Description', 'Statut : A faire / En cours / Fait', 'Responsable', 'Tags / classification'] },
  { id: 'sicurezza', label: 'Hygiène & Sécurité', icon: '🛡️', superuserOnly: false, kind: 'sicurezza',
    blurb: 'Tâches d’hygiène & de sécurité du laboratoire, conservées dans leur section dédiée.',
    fields: ['Description', 'Statut : A faire / En cours / Fait', 'Responsable', 'Tags / classification', 'Sévérité (optionnelle)'] },
  { id: 'conges', label: 'Congés', icon: '🏖️', superuserOnly: false, kind: 'conges',
    blurb: 'Demandes de congés de l’équipe : périodes, jours ouvrés, notes et approbation (réservée au superutilisateur).',
    fields: ['Demandeur', 'Premier jour · Dernier jour de congé', 'Jours ouvrés', 'Notes', 'Approuvation : Demande / Approuvé / Refusé / Présence autorisée pendant fermeture (réintègre les jours de fermeture travaillés)'] },
  { id: 'personnel', label: 'Personnel', icon: '👥', superuserOnly: true, kind: 'personnel',
    blurb: 'Personnel Permanent / Technique / Temporaire, corps & grades, missions, formations et bloc stagiaire lié à une Recette.',
    fields: ['Nom', 'Type : Permanent / Technique / Temporaire', 'Corps (PR, MCF, DR, CR, IR, IE, ASI, TECH, ATRF…)', 'Grade — sous-classification du corps (PR2, PR1, CE2, CE1, CN, HC, DR2, DR1…)', 'BAP · HDR · Catégorie · Échelon · Chevron', 'Dates contrat', 'Promotion · RIPEC', 'Missions · Formations', 'Stagiaire : encadrants · ligne budgétaire · dates · durée', 'Commentaires'] },
  { id: 'librerie', label: 'Librairie', icon: '📇', superuserOnly: false, kind: 'librerie',
    blurb: 'Catalogue des fournisseurs utilisé par les Dépenses (BC) et les achats prévus / souhaités (souhaits d’achat).',
    fields: ['Nom du fournisseur', 'Contact', 'Email · Téléphone · Adresse', 'Référence SIFAC (n° de tiers fournisseur)', 'Catégories associées', 'Site web', 'Commentaires'] },
  { id: 'settings', label: 'Setup', icon: '⚙️', superuserOnly: true, kind: null,
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
 * @property {?string} dateSignatureDevis // date de signature du devis → état « Devis signé »
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
 * @typedef {Object} Reimbursement
 * Registre « Remboursements » de la page Dépenses — collection INDÉPENDANTE de
 * `depenses` : un remboursement n’est JAMAIS un bon de commande (pas de devis,
 * N° SIFAC/D.A. ni N° BC) et ne migre pas vers la table Dépenses, quel que soit
 * son état. Formulaire sur le modèle d’un OM prévu (sans la partie statut
 * En attente / Acceptée / Refusée). La page Recettes les décompte dans sa
 * colonne « Remboursements » (déduite du solde de la ligne budgétaire).
 * @property {string} description       // objet du remboursement (obligatoire)
 * @property {string} demandeur         // bénéficiaire : membre qui a avancé les frais
 * @property {?string} destination      // lieu / contexte (optionnel)
 * @property {?string} numOM            // N° OM / référence (optionnel)
 * @property {?string} categorie        // Fonctionnement / Investissement
 * @property {?string} recetteId        // ligne budgétaire imputée
 * @property {?string} ligneBudgetaire  // intitulé/code de la ligne imputée
 * @property {?string} dateDemande
 * @property {?string} dateMission      // date de début de la période de frais
 * @property {?string} dateRetour
 * @property {?number} coutVoyage       // transport
 * @property {?number} coutLogement
 * @property {?number} coutRepas
 * @property {?number} coutInscription
 * @property {number} coutTotal         // total recalculé automatiquement
 * @property {('Estimé'|'Exact')} coutStatut
 * @property {string} commentaires
 */
/**
 * @typedef {Object} Desiderata
 * @property {string} description
 * @property {('Urgent'|'Important'|'Souhaitable')} urgence
 * @property {string} demandeur
 * @property {('Fonctionnement'|'Investissement')} categorie
 * @property {?string} recetteSuggereeId      // ligne budgétaire suggérée
 * @property {?number} montantEstime          // coût estimé (€)
 * @property {?number} fraisPort              // frais de port (€)
 * @property {?string} dateDemande
 * @property {string} fournisseurNom
 * @property {string} fournisseurContact
 * @property {string[]} devisNumbers
 * @property {?string} numDevisUrl           // lien Google Drive vers le devis (facultatif)
 * @property {string} codeProduit
 * @property {string} commentaires
 * @property {string} statut                // décision du superutilisateur : « Approuvé » / « En attente » / « Pas maintenant » (anciennes valeurs d’import toujours acceptées)
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

/* Positions « atteintes » lors d’une promotion (historique des promotions de
   la page Personnel) et intitulés de formations (lignes « intitulé | date »).
   Les deux listes sont modifiables dans Paramètres › Options des listes
   déroulantes — les valeurs déjà saisies dans les fiches restent toujours
   proposées dans le formulaire, même après retrait de la liste. */
export const PERSONNEL_POSITIONS = [
  'Doctorant', 'ATER', 'Post-doctorant', 'PRAG', 'PRCE',
  'Ingénieur d’études', 'Ingénieur de recherche', 'Assistant ingénieur', 'Technicien', 'Adjoint technique',
  'Maître de conférences', 'Professeur des universités',
  'Chargé de recherche', 'Directeur de recherche',
];
export const FORMATION_SUGGESTIONS = [
  'SST initial', 'SST recyclage', 'Habilitations électriques (initial)', 'Habilitations électriques (recyclage)',
  'Formation autoclave', 'Radioprotection', 'Équipier de première intervention', 'Secourisme',
  'Prévention des risques chimiques',
];
/* « Remboursements » n’est volontairement PAS une nature de Dépense : un
   remboursement n’est jamais un bon de commande — il vit dans le registre
   dédié (collection `reimbursements`, onglet « Remboursements » de la page
   Dépenses). Les anciennes lignes du classeur classées « Remboursements »
   sont rapatriées automatiquement vers ce registre. */
export const DEPENSE_NATURES = ['Consommables', 'Stages', 'Instrumentation', 'Meetings', 'Audit', 'Prestations', 'Autre'];
export const URGENCES = ['Urgent', 'Important', 'Souhaitable'];
/* Décisions (statuts) des « Achats prévus / souhaités » — le changement est réservé
   au superutilisateur. Cette liste reste modifiable dans Setup › Options des
   listes déroulantes. Les anciennes valeurs d’import (« Approved », « Pending »,
   « Rejected / Pas maintenant »…) restent reconnues et affichées dans leur
   équivalent français par `desiderataDecisionOf`. */
export const DESIDERATE_APPROVED = 'Approuvé';
export const DESIDERATE_PENDING = 'En attente';
export const DESIDERATE_REJECTED = 'Pas maintenant';
export const DESIDERATE_STATUSES = [DESIDERATE_APPROVED, DESIDERATE_PENDING, DESIDERATE_REJECTED];

/** Libellé français normalisé d’une décision (accepte les anciennes valeurs). */
export const desiderataDecisionOf = (raw) => {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const k = s.toLowerCase();
  if (/(approuv|approved|accept)/.test(k)) return DESIDERATE_APPROVED;
  if (/(pas maintenant|rejected|reject|refus|rejete)/.test(k)) return DESIDERATE_REJECTED;
  if (/(pending|attente|waiting)/.test(k)) return DESIDERATE_PENDING;
  return s;
};
export const isDesiderataApproved = (raw) => desiderataDecisionOf(raw) === DESIDERATE_APPROVED;
export const isDesiderataPending = (raw) => desiderataDecisionOf(raw) === DESIDERATE_PENDING;
export const isDesiderataRejected = (raw) => desiderataDecisionOf(raw) === DESIDERATE_REJECTED;
export const OM_COST_STATUSES = ['Estimé', 'Exact'];
export const ISSUE_STATUSES = ['A faire', 'En cours', 'Fait'];
/* Statuts d’une ligne Congés. La ligne « Présence autorisée pendant fermeture »
   n’est PAS une demande de congé : réservée au superutilisateur, elle
   réintègre au solde du membre les jours ouvrés de fermeture UPJV pendant
   lesquels il a travaillé avec autorisation (règle du labo : les jours de
   fermeture sont décomptés d’office du quota annuel). */
export const CONGE_STATUSES = ['Demande', 'Approuvé', 'Refusé', 'Présence autorisée pendant fermeture'];
export const CONGE_DEMANDE = 'Demande';
export const CONGE_APPROUVE = 'Approuvé';
export const CONGE_REFUSE = 'Refusé';
export const CONGE_PRESENCE = 'Présence autorisée pendant fermeture';

/* Statuts d’approbation des devis / BC déposés sur la page « Approbation
   devis & BC » — la décision (Approuvé / Refusé / Non retenu) est réservée
   au superutilisateur ; toute valeur absente/ancienne (« Demande »…) reste
   considérée « En attente ». Plusieurs devis peuvent être déposés pour un
   même produit (groupeAchatId commun) : à l’approbation d’un devis, les
   autres candidats encore « En attente » passent automatiquement
   « Non retenu » (statut distinct de « Refusé », conservé pour la
   traçabilité). */
export const APPROVAL_STATUSES = ['En attente', 'Approuvé', 'Refusé', 'Non retenu'];
export const APPROVAL_PENDING = 'En attente';
export const APPROVAL_APPROVED = 'Approuvé';
export const APPROVAL_REJECTED = 'Refusé';
export const APPROVAL_NOT_RETAINED = 'Non retenu';
/** Normalise une valeur stockée vers l’une des 3 décisions d’approbation. */
export const approvalStatusOf = (raw) => {
  const k = String(raw || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (/(approuv|accept|valid|oui|sign)/.test(k)) return APPROVAL_APPROVED;
  if (/(refus|rejet|non)/.test(k)) return APPROVAL_REJECTED;
  return APPROVAL_PENDING;
};
/** Vrai si la ligne attend encore une décision du superutilisateur. */
export const isApprovalPending = (raw) => {
  const k = String(raw || '').trim().toLowerCase();
  if (!k) return true;
  if (k === 'demande') return true;
  return approvalStatusOf(k) === APPROVAL_PENDING;
};

/* Congés : jours accordés par an et par profil (saison du 1er septembre au
   31 août, renouvelée automatiquement). Le quota se règle dans Paramètres ›
   « Congés : jours/an par profil » au format « Corps = nombre » ; la page
   Congés cherche d'abord par corps de la fiche Personnel, puis par type,
   puis par « Par défaut ». */
export const CONGE_DEFAULT_ALLOWANCE = 47;
export const CONGE_QUOTA_BY_TYPE = { Doctorant: CONGE_DEFAULT_ALLOWANCE };

/* Statuts ajoutés pour le suivi budgétaire des pages Dépenses / OM. */
export const DEPENSE_STATUSES = ['Devis en cours', 'SIFAC transmis', 'BC signé', 'Livré', 'Facturé', 'Clôturé'];
export const DEPENSE_BC_SIGNE = 'BC signé';
export const OM_STATUSES = ['En attente', 'Acceptée', 'Refusée', 'Terminée'];

/* Prestations internes (« PI ») — fournisseur particulier du classeur : un
   service interne (atelier, autre équipe…) facturé sans bon de commande. Une
   telle dépense est donc considérée comme ENGAGÉE / consommée dès sa saisie,
   même sans statut « BC signé » (c’est le décompte utilisé par la page
   Recettes pour le solde). */
export const DEPENSE_FOURNISSEUR_PI = 'PI';
/** Vrai si la valeur « nom du fournisseur » désigne une prestation interne. */
export const isPiFournisseur = (value) => {
  const s = String(value ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
  return s === 'pi' || s === 'prestation interne';
};

/* Famille d’une dépense. La page Dépenses répartit ses lignes entre trois
   onglets : « Achats » (fournisseur « normal », cycle devis → BC → livraisons),
   « Prestations internes » (fournisseur « PI », sans BC) et « OM » (dépenses
   liées à un ordre de mission, créées depuis la page « OM prévus / souhaités »
   ou saisies directement). Le champ explicite `type` ('achat' | 'pi' | 'om')
   prend le dessus ; à défaut la famille se déduit du fournisseur « PI ». */
export const depenseKindOf = (d) => {
  const t = String(d && d.type || '').trim().toLowerCase();
  if (t === 'om' || t === 'pi' || t === 'achat') return t;
  return isPiFournisseur(d && d.fournisseur) ? 'pi' : 'achat';
};
/** Vrai si la dépense est une ligne de type « OM ». */
export const isOmDepense = (d) => depenseKindOf(d) === 'om';
/** Libellé + icône de chaque famille, pour les sélecteurs « Déplacer… ». */
export const DEPENSE_KIND_LABELS = {
  achat: 'Achats (BC / SIFAC)',
  pi: 'Prestation interne (PI)',
  om: 'OM',
};
export const DEPENSE_KIND_META = {
  achat: { label: 'Achats', icon: '🛒' },
  pi: { label: 'Prestations internes', icon: '🛠️' },
  om: { label: 'OM', icon: '✈️' },
};

/* ── Remboursements : registre dédié (collection `reimbursements`) ────────
   Un remboursement = frais avancés par un membre puis remboursés par le
   laboratoire. Ce n’est JAMAIS un bon de commande : aucune notion de devis /
   N° SIFAC/D.A. / BC / fournisseur. Le registre est indépendant de la table
   Dépenses — les anciennes lignes de la collection `depenses` dont la
   « Classification / nature » vaut « Remboursements » sont rapatriées ici
   automatiquement à la lecture (AdminContext). La page Recettes déduit leur
   total du solde de la ligne budgétaire (colonne « Remboursements »). */

/** Lignes de coût d’un remboursement (mêmes libellés que le formulaire OM). */
export const REIMBURSEMENT_COST_FIELDS = [
  { key: 'coutVoyage', label: 'Transport', legacy: ['coutTransport', 'voyage'], icon: '🚆' },
  { key: 'coutLogement', label: 'Logement', legacy: ['coutHebergement', 'logement'], icon: '🏨' },
  { key: 'coutRepas', label: 'Repas', legacy: ['repas'], icon: '🍽️' },
  { key: 'coutInscription', label: 'Inscription', legacy: ['inscription'], icon: '🎟️' },
];
/** Vrai si la valeur « Classification / nature » désigne un remboursement de frais. */
export const isReimbNature = (v) => {
  const s = String(v === null || v === undefined ? '' : v).trim().toLowerCase();
  if (!s) return false;
  // « Remboursements », « Remboursement », « Remboursé », « Reimbursement »…
  // → toute valeur contenant « rembours… » / « reimburs… ».
  return /(^|[^a-zà-ÿ])(rembours\w*|reimburs\w*)([^a-zà-ÿ]|$)/.test(s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
};
const reimbNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const reimbValue = (r, keys) => {
  for (const k of keys) {
    if (r && r[k] !== undefined && r[k] !== null && String(r[k]).trim() !== '') return r[k];
  }
  return null;
};
/** Coût total d’un remboursement (coutTotal stocké, sinon somme des lignes). */
export const reimbTotalOf = (r) => {
  const total = reimbValue(r, ['coutTotal']);
  if (total !== null) return Math.round(reimbNum(total) * 100) / 100;
  const parts = REIMBURSEMENT_COST_FIELDS
    .map((c) => reimbValue(r, [c.key, ...c.legacy]))
    .filter((n) => n !== null)
    .map(reimbNum);
  if (parts.length) return Math.round(parts.reduce((s, n) => s + n, 0) * 100) / 100;
  const legacy = reimbValue(r, ['montant']);
  return legacy !== null ? Math.round(reimbNum(legacy) * 100) / 100 : 0;
};
/** Vrai si au moins une ligne de coût / un total est renseigné. */
export const reimbHasCost = (r) => reimbTotalOf(r) > 0;
/**
 * Conversion d’une ancienne ligne Dépenses classée « Remboursements » (import du
 * classeur ou saisies antérieures) vers une fiche du registre dédié. Le montant
 * HT + frais de port deviennent le « coût total » ; les numéros de facture /
 * référence éventuels sont conservés dans la référence de la fiche.
 */
export const reimbursementFromDepense = (d) => {
  const s = (v) => String(v === null || v === undefined ? '' : v).trim();
  const iso = (v) => { const x = s(v); return x ? x.slice(0, 10) : ''; };
  const n = (v) => { const x = Number(v); return Number.isFinite(x) ? Math.round(x * 100) / 100 : null; };
  const montant = n(d && d.montant);
  const fraisPort = n(d && d.fraisPort);
  const coutTotal = n(d && d.coutTotal);
  return {
    description: s(d && (d.description || d.nom)),
    demandeur: s(d && d.demandeur),
    destination: s(d && (d.destination || '')),
    numOM: s(d && (d.numOM || d.omNo || d.numFacture || d.factureNo)),
    categorie: s(d && d.categorie),
    recetteId: s(d && d.recetteId),
    ligneBudgetaire: s(d && (d.ligneBudgetaire || '')),
    dateDemande: iso(d && (d.dateDemande || '')),
    dateMission: iso(d && (d.dateMission || d.dateDebut || '')),
    dateRetour: iso(d && d.dateRetour),
    coutVoyage: n(d && d.coutVoyage),
    coutLogement: n(d && d.coutLogement),
    coutRepas: n(d && d.coutRepas),
    coutInscription: n(d && d.coutInscription),
    coutStatut: 'Exact',
    coutTotal: coutTotal !== null
      ? coutTotal
      : (montant !== null || fraisPort !== null ? (montant || 0) + (fraisPort || 0) : null),
    commentaires: s(d && d.commentaires),
  };
};

/* Champs d’une dépense pouvant être déclarés obligatoires dans Paramètres.
   Une ligne de la page Dépenses passe entièrement en rouge dès qu’un de ces
   champs configurés manque (même principe que les « mandatory fields » des
   pages de type scientifique). */
export const DEPENSE_FIELD_CATALOG = [
  { key: 'description', label: 'Description' },
  { key: 'statut', label: 'Suivi / Statut' },
  { key: 'demandeur', label: 'Demandeur' },
  { key: 'categorie', label: 'Catégorie' },
  { key: 'classification', label: 'Classification / nature' },
  { key: 'ligne', label: 'Ligne budgétaire liée' },
  { key: 'montant', label: 'Montant HT' },
  { key: 'dateDemande', label: 'Date de la demande' },
  { key: 'fournisseur', label: 'Nom du fournisseur' },
  { key: 'contact', label: 'Contact fournisseur' },
  { key: 'numSIFAC', label: 'N° SIFAC/D.A.' },
  { key: 'numBC', label: 'N° BC' },
  { key: 'numFacture', label: 'N° facture' },
];
/** Clé → libellé lisible d’un champ de dépense (messages + Paramètres). */
export const DEPENSE_FIELD_LABEL = Object.fromEntries(
  DEPENSE_FIELD_CATALOG.map((f) => [f.key, f.label])
);
/** Obligatoires par défaut (réglables dans Paramètres › Champs obligatoires). */
export const DEFAULT_DEPENSE_MANDATORY = ['fournisseur'];

/** Valeurs par défaut du magasin d’options Paramètres d’une base. */
export const DEFAULT_OPTIONS = {
  recetteTypes: RECETTE_TYPES,
  tranchesStatuses: TRANCHES_STATUSES,
  personnelTypes: PERSONNEL_TYPES,
  corps: PERSONNEL_CORPS,
  gradesByCorps: GRADES_BY_CORPS,
  bap: BAP_LIST,
  dutySuggestions: DUTY_SUGGESTIONS,
  positions: PERSONNEL_POSITIONS,
  formations: FORMATION_SUGGESTIONS,
  depenseNatures: DEPENSE_NATURES,
  urgencies: URGENCES,
  desiderateStatuses: DESIDERATE_STATUSES,
  omCostStatuses: OM_COST_STATUSES,
  omStatuses: OM_STATUSES,
  depenseStatuses: DEPENSE_STATUSES,
  depenseMandatoryFields: DEFAULT_DEPENSE_MANDATORY,
  issueStatuses: ISSUE_STATUSES,
  congeStatuses: CONGE_STATUSES,
  congesQuotaByType: CONGE_QUOTA_BY_TYPE,
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

/* ── Matrice d’accès par rôle (statut de la fiche + fonction) ───────────── */
/** Valeurs de la liste « Fonction » d’une fiche Personnel (accès module). */
export const ADMIN_FONCTIONS = ['', 'AP', 'Gestionnaire'];
export const ADMIN_FONCTION_META = {
  '': { label: 'Aucune', hint: 'Accès = socle de son statut (Permanent ou Non permanent).' },
  AP: { label: 'AP', hint: 'Agent de prévention → ajoute Dépenses, Budget overview + Hygiène & Sécurité.' },
  Gestionnaire: { label: 'Gestionnaire', hint: '→ ajoute Dépenses, Budget overview + Questions ouvertes.' },
};

/** Libellé de l’échelon d’accès dérivé d’une fiche Personnel. */
export const statutLabelOf = (person) => {
  if (!person) return 'Non permanent';
  const type = String(person.type || '').trim();
  const corps = String(person.corps || '').trim();
  const t = type.toLowerCase();
  // Non permanent : contrats courts / encadrés (Doctorant, ATER, Post-doc,
  // CDD, Stagiaire, Vacataire…) — y compris types personnalisés du paramétrage.
  if (/temporaire|cdd|post.?doc|ater|doctorant|stagiaire|vacataire|contractuel|stage/i.test(t)) return 'Non permanent';
  if (type) return 'Permanent'; // Permanent, Technique, Ingénieur… → statut Permanent
  if (/post.?doc|ater|doctorant|stagiaire/i.test(corps)) return 'Non permanent';
  if (corps) return 'Permanent'; // PR, MCF, IR, IE, TECH, ATRF…
  return 'Non permanent';
};

/** Pages du socle d’un Permanent (type Permanent ou Technique) sans fonction.
    « Dépenses » et « Budget overview » en sont retirées : elles ne sont visibles
    que pour les fonctions AP / Gestionnaire et le superutilisateur. La page Congés
    n’y figure pas non plus : elle est réservée aux profils Non permanent +
    superutilisateur. */
const PERMANENT_SOCLE_PAGES = ['recettes', 'desiderate', 'devisBc', 'om', 'librerie'];
/** Pages d’un Non permanent : uniquement l’espace Congés. */
const NON_PERMANENT_SOCLE_PAGES = ['conges'];
/** Pages ajoutées selon la fonction portée par la fiche Personnel. */
const FONCTION_EXTRA_PAGES = {
  AP: ['depenses', 'budget', 'sicurezza'],
  Gestionnaire: ['depenses', 'budget', 'questioni'],
};

/**
 * Profil d’accès d’un utilisateur connecté, calculé en DIRECT depuis la liste
 * des opérateurs (pour tenir compte des dernières modifications de rôle, y
 * compris pendant la session) puis relié à sa fiche Personnel de la base
 * ouverte : par `personnelId` (liaison manuelle dans Paramètres › Équipe), ou
 * à défaut par correspondance de nom. Sans fiche trouvée → statut minimal
 * « Non permanent », sans fonction.
 */
export const adminAccessProfile = (currentUser, operators, personnel) => {
  const list = Array.isArray(operators) ? operators : [];
  const fresh =
    (currentUser && list.find((op) => op && op.id === currentUser.id)) ||
    currentUser ||
    null;
  const isSuperuser = !!(fresh && fresh.role === 'superuser');
  const personList = Array.isArray(personnel) ? personnel : [];
  let person = null;
  if (fresh) {
    const pid = fresh.personnelId;
    if (pid) person = personList.find((p) => p && p.id === pid) || null;
    if (!person) {
      const key = (s) => String(s || '')
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ').trim();
      const wanted = key(fresh.name);
      const wantedTokens = wanted ? wanted.split(/\s+/).sort().join(' ') : '';
      person = personList.find((p) => {
        const nk = key(p && p.nom);
        if (!nk || !wantedTokens) return false;
        if (nk === wanted) return true;
        return nk.split(/\s+/).sort().join(' ') === wantedTokens; // « Nom Prénom » vs « Prénom Nom »
      }) || null;
    }
  }
  const rawFonction = person && person.fonction ? String(person.fonction).trim() : '';
  const fonction = ADMIN_FONCTIONS.includes(rawFonction) ? rawFonction : '';
  return { isSuperuser, statut: statutLabelOf(person), fonction, person };
};

/** Ensemble des ids de pages autorisés pour un profil d’accès donné. */
export const adminPageIdsForProfile = (profile) => {
  const p = profile || {};
  const ids = new Set(['overview']);
  if (p.isSuperuser) {
    ADMIN_PAGES.forEach((page) => ids.add(page.id));
    return ids;
  }
  const base = p.statut === 'Permanent' ? PERMANENT_SOCLE_PAGES : NON_PERMANENT_SOCLE_PAGES;
  base.forEach((id) => ids.add(id));
  const extra = FONCTION_EXTRA_PAGES[p.fonction] || [];
  extra.forEach((id) => ids.add(id));
  return ids;
};

/**
 * Matrice de visibilité d’une page d’administration pour un utilisateur donné.
 * En bootstrap (aucun compte ou aucun superutilisateur défini), la page
 * « Paramètres » reste accessible pour créer l’équipe / le superutilisateur.
 * `personnel` = fiches Personnel de la base d’administration ouverte.
 */
export const adminCanViewPage = (page, currentUser, operators, personnel) => {
  if (!page) return false;
  if (page.id === 'settings' && !hasDefinedSuperuser(operators)) return true;
  const ids = adminPageIdsForProfile(adminAccessProfile(currentUser, operators, personnel));
  return ids.has(page.id);
};

/* ── Semence d’une base d’administration ────────────────────────────────── */
/** Contenu vide d’une nouvelle base d’administration (un objet par dataset). */
export const createAdministrationSeed = () => {
  const lists = {};
  Object.keys(ADMIN_COLLECTIONS).forEach((k) => { lists[k] = []; });
  lists.settings = JSON.parse(JSON.stringify(DEFAULT_OPTIONS));
  return lists;
};


