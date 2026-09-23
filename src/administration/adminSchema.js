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
   réservées au superutilisateur (Personnel) — la page Setup reste
   accessible en bootstrap (aucun superutilisateur défini) pour créer l’équipe,
    et à tout membre connecté pour changer son propre mot de passe (les réglages
    avancés de Setup restent réservés au superutilisateur).
   Récapitulatif de la matrice (validée avec l’équipe) :
     • Statut Permanent  (type Permanent ou Technique) sans fonction = socle :
         Recettes · OM prévus / souhaités · Achats prévus / souhaités · Approbation devis & BC · Librairie
     • Pages « Dépenses » et « Budget overview » = réservées aux fonctions AP et
         Gestionnaire (et au superutilisateur) ; les Permanents sans fonction
         ne les voient pas.
     • Recettes (création de lignes budgétaires) : socle Permanent, et aussi
         accordée aux fonctions Gestionnaire / Achats (même hors statut
         Permanent) — voir plus bas.
     • Approbation devis & BC (suivi des achats : TOUTES les demandes de devis /
         BC y sont visibles) : socle Permanent, et aussi accordée aux fonctions
         Gestionnaire / Achats même hors statut Permanent — charger du suivi des
         achats ne suppose pas un statut Permanent (voir plus bas).
     • Statut Non permanent = onglet Congés uniquement.
     • Page Congés (demandes d’absence) = réservée aux profils Non permanent
         et au superutilisateur (rôle d’approbation) ; les Permanents ne la voient pas.
     • Fonction AP (agent de prévention)  → ajoute Dépenses + Budget overview + Hygiène & Sécurité.
     • Fonction Gestionnaire              → ajoute Recettes (création de lignes budgétaires) +
         Dépenses + Budget overview + Questions ouvertes + Approbation devis & BC.
     • Fonction Achats (« Responsable
       d'achats »)                         → ajoute Recettes (création de lignes budgétaires) +
         Dépenses + Budget overview + Approbation devis & BC ; reçoit les OM /
         achats prévus transférés depuis « OM prévus / souhaités » et « Achats
         prévus / souhaités » (création de devis « Approbation devis & BC » et de
         fiches du registre Remboursements).
     • Personnel → superutilisateur uniquement.
      • Page Setup → ouverte à tout membre connecté (changement de son propre
          mot de passe) ; gestion des comptes et réglages avancés réservés au
          superutilisateur.
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
    blurb: 'Ordres de mission prévus / souhaités : dates, demandeur, destination, coûts, statut (En attente / Acceptée…). Un OM « Acceptée » peut être transféré en dépense réelle (page Dépenses › onglet OM). Le statut « Test » compte l’OM dans les prévisions des Recettes sans l’accepter réellement.',
    fields: ['Description', 'Demandeur', 'Date de demande · Départ · Retour', 'Destination', 'Transport · Hébergement · Repas · Inscription', 'Coût total (calculé)', 'Statut : En attente / Acceptée / Test / Refusée / Terminée', 'Estimé vs Exact', 'Ligne budgétaire liée (Recette)', 'Commentaires'] },
  { id: 'desiderate', label: 'Achats prévus / souhaités', icon: '🛒', superuserOnly: false, kind: 'desiderate',
    blurb: 'Achats prévus / souhaités de l’équipe : coût estimé et frais de port saisis par le demandeur, décision réservée au superutilisateur (Approuvé / En attente / Test / Pas maintenant). Le statut « Test » compte le montant dans les prévisions des Recettes sans que la demande soit réellement acceptée.',
    fields: ['Décision — réservée au superutilisateur : Approuvé / En attente / Test / Pas maintenant', 'Souhait d’achat', 'Urgence : Urgent / Important / Souhaitable', 'Demandeur', 'Fournisseur', 'Ligne budgétaire suggérée', 'Coût estimé', 'Frais de port', 'N° devis · Lien du devis (Drive, facultatif) · Code produit', 'Date de demande', 'Commentaires'] },
  { id: 'devisBc', label: 'Approbation devis & BC', icon: '📝', superuserOnly: false, kind: 'devisBc',
    blurb: 'Dépôt des devis et bons de commande à faire signer par le superutilisateur (visibles par les Permanents ; le Gestionnaire et le Responsable d’achats voient toutes les demandes ; les lignes demandées par « Service » sont visibles par tout le monde). Les fichiers sont téléversés dans Budget_labo/<année>/Devis|BC avec un nom qui reprend le N°, les attributs de la ligne ET l’objet (description) après un « _ » à la fin du titre ; l’approbation d’un devis le valide, et celle du BC lié crée la dépense « BC signé » correspondante dans la page Dépenses (catégorie, ligne budgétaire, N° SIFAC/D.A. et date de signature transmis automatiquement). À l’approbation d’un fichier PDF, une copie signée « …_approuvé_signé.pdf » est créée (image de signature du superutilisateur en bas de la dernière page) et devient le fichier officiel — l’original reste intact.',
    fields: ['Statut : En attente / Approuvé / Refusé (décision réservée au superutilisateur)', 'Type : Devis ou BC', 'Description', 'Fournisseur', 'N° devis · N° BC · Catégorie · N° SIFAC/D.A.', 'Montant (optionnel)', 'Fichier téléversé (Budget_labo/<année>/Devis ou /BC)', 'Déposant', 'Date de dépôt', 'Dépense « BC signé » créée automatiquement à l’approbation du BC'] },
  { id: 'budget', label: 'Budget overview', icon: '💶', superuserOnly: false, kind: null,
    blurb: 'Graphiques personnels de suivi budgétaire : dépenses découpées comme les onglets de la page Dépenses (Achats / Prestations internes / OM / Rémunérations de stage), lignes budgétaires & soldes (page Recettes), OM, souhaits, Remboursements (avec états liquidatifs) et devis & BC à approuver — chaque membre enregistre ses propres graphiques.',
    fields: ['Camembert / Barres / Courbe', 'Dépenses : subdivision (Achats / PI / OM / Stages), classification, catégorie, statut, fournisseur, opérateur, ligne budgétaire, mois / année / jour', 'Budgets (Recettes) : dispo, budget total, Achats (BC signés), PI, OM payés, Stages, Remboursements, OM prévus, souhaits approuvés, solde (règle page Recettes)', 'Remboursements : par mois, bénéficiaire, ligne budgétaire, état liquidatif…', 'Approbation devis & BC : par statut, demandeur, fournisseur, type (Devis / BC)…'] },
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
  { id: 'settings', label: 'Setup', icon: '⚙️', superuserOnly: false, kind: null,
    blurb: 'Ouvert à tout membre connecté pour changer son propre mot de passe ; rôles (scientifiques / superutilisateur) et options des listes déroulantes réservés au superutilisateur.',
    fields: ['Mon compte (mot de passe personnel)', 'Rôles (drapeau superutilisateur)', 'Options des listes déroulantes (natures, BAP, corps & grades…)'] },
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
 * @property {('Fonctionnement'|'Investissement'|'Salaire')} type  // « Salaire » = ligne de rémunération (l’ancien « Autres » reste reconnu)
 * @property {string} porteur           // nom du porteur de projet
 * @property {?string} porteurId        // id du membre du personnel lié
 * @property {?number} budgetTotal      // budget total alloué à la ligne
 * @property {?number} budgetRenduDispo // montant mis à dispo par l’université
 * @property {?string} dateDebut        // début de la période couverte par la ligne (saisie / import)
 * @property {?string} dateFin          // fin de la période couverte par la ligne (saisie / import)
 * @property {?string} dateFinEngagement // échéance d’engagement des crédits
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
 * @property {?string} etatLiquidatifUrl // lien Google Drive de l’« état liquidatif » — fichier
 *                                        signé validant le remboursement — classé automatiquement
 *                                        dans Budget_labo/<année>/OM (colonne « État liquidatif » du tableau)
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
 * @property {string} statut                // décision du superutilisateur : « Approuvé » / « En attente » / « Test » / « Pas maintenant » (anciennes valeurs d’import toujours acceptées)
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
/** « Demandeur » collectif « Service » : les devis / BC (et dépenses) demandés
 *  au nom du Service sont VISIBLES PAR TOUS les membres sur la page
 *  « Approbation devis & BC » (pas seulement par leur déposant) ; « Service »
 *  est proposé dans les listes « Demandeur » / « Bénéficiaire » des formulaires. */
export const SERVICE_DEMANDEUR = 'Service';
export const RECETTE_TYPES = ['Fonctionnement', 'Investissement'];
/* Type « Salaire » d’une ligne budgétaire : lignes de rémunération du
   personnel. À l’import, la catégorie « Autres » (ou « Salaire »/« Salaires »)
   de la feuille « Lignes budgétaires » est enregistrée sous le type « Salaire » ;
   les bases historiques qui stockent encore « Autres » restent reconnues. */
export const isSalaireRecetteType = (t) => {
  const s = String(t ?? '')
    .trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return s === 'salaire' || s === 'salaires' || s === 'autres';
};
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
   équivalent français par `desiderataDecisionOf`. Le statut « Test » compte le
   montant dans les prévisions des Recettes (« Achats prévus ») sans que la
   demande soit réellement acceptée (aucune notification, aucun transfert). */
export const DESIDERATE_APPROVED = 'Approuvé';
export const DESIDERATE_PENDING = 'En attente';
export const DESIDERATE_TEST = 'Test';
export const DESIDERATE_REJECTED = 'Pas maintenant';
export const DESIDERATE_STATUSES = [DESIDERATE_APPROVED, DESIDERATE_PENDING, DESIDERATE_TEST, DESIDERATE_REJECTED];

/** Libellé français normalisé d’une décision (accepte les anciennes valeurs). */
export const desiderataDecisionOf = (raw) => {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const k = s.toLowerCase();
  if (/(approuv|approved|accept)/.test(k)) return DESIDERATE_APPROVED;
  if (/(pas maintenant|rejected|reject|refus|rejete)/.test(k)) return DESIDERATE_REJECTED;
  if (/(test|simulation|essai)/.test(k)) return DESIDERATE_TEST;
  if (/(pending|attente|waiting)/.test(k)) return DESIDERATE_PENDING;
  return s;
};
export const isDesiderataApproved = (raw) => desiderataDecisionOf(raw) === DESIDERATE_APPROVED;
export const isDesiderataPending = (raw) => desiderataDecisionOf(raw) === DESIDERATE_PENDING;
export const isDesiderataTest = (raw) => desiderataDecisionOf(raw) === DESIDERATE_TEST;
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
/* Statuts du circuit « demandes de devis / achats » introduits avec la
   gestion des requêtes :
   · « En gestion »      → devis généré par un transfert « pour révision » :
                          des documents manquent, la responsable d'achats doit
                          compléter (fournisseur, N° devis, fichier…) avant que
                          le devis ne parte en signature ;
   · « En attente de
     signature »         → libellé affiché quand un devis généré par un
                          transfert « pour signature » (ou complété) attend la
                          signature du superutilisateur. Stocké « En attente »
                          pour rester compatible avec le dépôt manuel. */
export const APPROVAL_GESTION = 'En gestion';
export const DEVIS_SIGNATURE_PENDING = 'En attente de signature';
/** Normalise une valeur stockée vers l’une des 3 décisions d’approbation. */
export const approvalStatusOf = (raw) => {
  const k = String(raw || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  /* « En gestion » et « En attente de signature » restent des états EN ATTENTE
     (le test « sign » plus bas les classerait à tort « Approuvé »). */
  if (/(attente|gestion|pending|waiting|demande)/.test(k)) return APPROVAL_PENDING;
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
/* Statuts des OM. Le statut « Test » (choix du superutilisateur) compte l’OM
   dans les prévisions « OM prévus » de la page Recettes sans l’accepter
   réellement : aucun e-mail, aucun transfert possible. */
export const OM_STATUSES = ['En attente', 'Acceptée', 'Test', 'Refusée', 'Terminée'];

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
  /* Permissions personnalisées « qui voit quelle page » (éditées dans Setup ›
     Accès aux pages) : { [pageId]: { mode:'custom', roles:[catégorie…],
     include:[ids fiche], exclude:[ids fiche] } }. Une page sans règle garde la
     matrice par défaut (statut + fonctions de la fiche Personnel). */
  pageAccess: {},
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
/** Valeurs possibles de la liste « Fonctions » (accès module) d’une fiche
 *  Personnel. Une personne peut PORTER PLUSIEURS fonctions à la fois (choix
 *  multiple : stocké en tableau) ; les anciennes fiches « une seule valeur »
 *  restent acceptées par toutes les lectures (voir fonctionsOfPerson). */
export const ADMIN_FONCTIONS = ['AP', 'Gestionnaire', 'Achats'];
export const ADMIN_FONCTION_META = {
  AP: { label: 'AP', hint: 'Agent de prévention → ajoute Dépenses, Budget overview + Hygiène & Sécurité.' },
  Gestionnaire: { label: 'Gestionnaire', hint: '→ ajoute Recettes (création de lignes budgétaires), Dépenses, Budget overview, Questions ouvertes + Approbation devis & BC (toutes les demandes).' },
  Achats: { label: "Responsable d'achats", hint: "→ ajoute Recettes (création de lignes budgétaires), Dépenses, Budget overview + Approbation devis & BC (toutes les demandes) ; reçoit les OM / achats prévus transférés et est notifié par e-mail quand un devis est créé." },
};

/** Synonymes acceptés pour chaque fonction : libellé affiché, saisie libre,
 *  import Google Sheets, singulier / pluriel. Sans eux, une fiche dont la
 *  fonction est stockée « Responsable d’achats » (libellé) au lieu du code
 *  « Achats » n’était reconnue NULLE PART : ni page « Approbation devis & BC »,
 *  ni visibilité des OM / achats prévus, ni surtout destinataire des e-mails de
 *  transfert (devis & BC) — la responsable d’achats n’était alors jamais
 *  prévenue, sans message d’erreur explicite. */
export const ADMIN_FONCTION_ALIASES = {
  AP: ['ap', 'agent prevention', 'agents prevention', 'prevention', 'hygiene securite', 'ap securite', 'ap hygiene securite'],
  Gestionnaire: ['gestionnaire', 'gestion', 'gestionnaire achats', 'gestionnaire achat', 'responsable gestion'],
  Achats: [
    'achats', 'achat', 'responsable achats', 'responsable achat', 'responsables achats', 'resp achats',
    'resp achat', 'acheteur', 'acheteurs', 'gestion achats', 'achats commandes',
  ],
};

/** Mots d’une fonction, normalisés : casse, accents, apostrophes et mots de
 *  liaison (« de / du / des / la / le / les / et ») ignorés —
 *  « Responsable d’achats », « responsable des achats » et « RESPONSABLE
 *  ACHAT » donnent les mêmes mots. */
const adminFonctionWords = (value) => String(value || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .split(' ')
  .filter((w) => w && ['de', 'du', 'des', 'd', 'la', 'le', 'les', 'et'].indexOf(w) === -1);

/** Tous les libellés acceptés (code canonique + synonymes) en mots, les plus
 *  spécifiques d’abord : « Gestionnaire des achats » doit l’emporter sur
 *  « achats » (Achats). */
const ADMIN_FONCTION_LABELS = (() => {
  const out = [];
  ADMIN_FONCTIONS.forEach((code) => {
    [code].concat(ADMIN_FONCTION_ALIASES[code] || []).forEach((label) => {
      const words = adminFonctionWords(label);
      if (words.length) out.push({ code, words });
    });
  });
  return out.sort((a, b) => b.words.length - a.words.length);
})();

/** Les mots `needle` apparaissent-ils dans `haystack`, en bloc et dans l’ordre
 *  (« responsable achats » ⊂ « responsable achats commandes ») ? */
const adminWordsContain = (haystack, needle) => {
  if (!needle.length || needle.length > haystack.length) return false;
  for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    let ok = true;
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
};

/** Code canonique (AP / Gestionnaire / Achats) d’une valeur de fonction saisie
 *  librement — '' quand elle n’est reconnue (aucune fonction).
 *
 *  Deux passes : (1) correspondance EXACTE d’un code ou d’un synonyme ;
 *  (2) repli TOLÉRANT sur les libellés CONTENUS dans la valeur — « Responsable
 *  d’achats (commandes) », « Gestionnaire · achats et commandes », « Achats et
 *  logistique », « AP — hygiène & sécurité ». Les mots restent comparés ENTIERS
 *  (« apprenti » ne contient donc jamais « ap ») et un libellé d’UN SEUL mot
 *  n’est accepté que s’il est assez long (≥ 5 lettres : achats, gestion,
 *  acheteur, prévention…) pour ne pas attraper une spécialité sans rapport.
 *  On retient à chaque fois le libellé le plus spécifique (le plus de mots). */
export const adminFonctionCode = (value) => {
  const words = adminFonctionWords(value);
  if (!words.length) return '';
  const key = words.join(' ');
  const exact = ADMIN_FONCTION_LABELS.find((l) => l.words.join(' ') === key);
  if (exact) return exact.code;
  const fuzzy = ADMIN_FONCTION_LABELS.filter((l) => (
    l.words.length > 1
      ? adminWordsContain(words, l.words)
      : (l.words[0].length >= 5 && words.indexOf(l.words[0]) !== -1)
  ));
  if (!fuzzy.length) return '';
  let best = fuzzy[0];
  fuzzy.forEach((l) => { if (l.words.length > best.words.length) best = l; });
  return best.code;
};

/** Lecture normalisée des fonctions d’une fiche Personnel (tableau de codes).
 *  Accepte le stockage moderne en tableau, l’ancien champ « une valeur »,
 *  plusieurs valeurs séparées (« AP | Gestionnaire ») ET les libellés
 *  (« Responsable d’achats » → Achats) — rien n’est perdu ni ignoré. */
export const fonctionsOfPerson = (person) => {
  const raw = person && person.fonction;
  const items = Array.isArray(raw)
    ? raw
    : (typeof raw === 'string' && String(raw).trim() ? String(raw).split(/[;|,/]+/) : []);
  const out = [];
  items.forEach((v) => {
    const code = adminFonctionCode(v);
    if (code && out.indexOf(code) === -1) out.push(code);
  });
  return out;
};
/** Vrai si la fiche Personnel porte la fonction `code` (AP / Gestionnaire / Achats). */
export const personHasFonction = (person, code) =>
  code && fonctionsOfPerson(person).indexOf(code) !== -1;

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
/** Pages ajoutées selon la fonction portée par la fiche Personnel.
    « Recettes » est aussi accordée aux fonctions Gestionnaire / Achats : elles
    doivent pouvoir créer de nouvelles lignes budgétaires (bouton « Nouvelle
    ligne budgétaire ») même si leur fiche n’est pas de statut Permanent.
    « Approbation devis & BC » (devisBc) leur est accordée pour la même raison :
    le suivi des achats ne suppose pas un statut Permanent, et ces deux profils
    doivent voir l’ENSEMBLE des demandes de devis / BC (la page ne limite plus
    les lignes affichées pour un Gestionnaire / Responsable d’achats). */
const FONCTION_EXTRA_PAGES = {
  AP: ['depenses', 'budget', 'sicurezza'],
  Gestionnaire: ['recettes', 'depenses', 'budget', 'questioni', 'devisBc'],
  Achats: ['recettes', 'depenses', 'budget', 'devisBc'],
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
    const key = (s) => String(s || '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ').trim();
    const wanted = key(fresh.name);
    const wantedTokens = wanted ? wanted.split(/\s+/).sort().join(' ') : '';
    /* Liaisons possibles, de la plus fiable à la moins fiable :
       1. `personnelId` de la fiche opérateur retrouvée par ID (le cas normal) ;
       2. `personnelId` porté par l'identité elle-même (roster / stockage) ;
       3. la fiche opérateur retrouvée par le NOM. Ce troisième cas est
          indispensable : l'écouteur d'état Firebase ne connaît que l'uid, donc
          l'id opérateur — et avec lui `personnelId` — se perdait ; le profil
          retombait alors sur le statut minimal « Non permanent » sans
          fonction, c'est-à-dire les pages d'un utilisateur générique, jusqu'au
          rechargement suivant (selon l'ordre d'arrivée des deux écritures :
          le défaut n'apparaissait donc que par intermittence). */
    const pids = [];
    const pushPid = (pid) => {
      const id = String(pid == null ? '' : pid).trim();
      if (id && pids.indexOf(id) === -1) pids.push(id);
    };
    pushPid(fresh.personnelId);
    pushPid(currentUser && currentUser.personnelId);
    if (wanted) {
      const byName = list.find((op) => op && op.personnelId && (
        key(op.name) === wanted
        || (!!wantedTokens && key(op.name).split(/\s+/).sort().join(' ') === wantedTokens)
      ));
      if (byName) pushPid(byName.personnelId);
    }
    person = pids.map((id) => personList.find((p) => p && p.id === id)).find(Boolean) || null;
    /* Dernier recours (anciens imports) : correspondance de nom avec la fiche
       Personnel elle-même. */
    if (!person && wantedTokens) {
      person = personList.find((p) => {
        const nk = key(p && p.nom);
        if (!nk || !wantedTokens) return false;
        if (nk === wanted) return true;
        return nk.split(/\s+/).sort().join(' ') === wantedTokens; // « Nom Prénom » vs « Prénom Nom »
      }) || null;
    }
  }
  const fonctions = fonctionsOfPerson(person);
  return {
    isSuperuser,
    statut: statutLabelOf(person),
    fonctions,
    /* Rétro-compatibilité : première fonction (ou '') pour les lecteurs qui ne
       connaissent pas encore la liste. */
    fonction: fonctions[0] || '',
    person,
  };
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
  /* Toutes les fonctions portées par la fiche (une personne peut en avoir
     plusieurs) ajoutent leurs pages. */
  (p.fonctions || []).forEach((f) => {
    const extra = FONCTION_EXTRA_PAGES[f] || [];
    extra.forEach((id) => ids.add(id));
  });
  return ids;
};

/* ── Permissions personnalisées (Setup › Accès aux pages) ──────────────────
   La matrice par défaut (statut + fonctions) reste la règle de base. Le
   superutilisateur peut, page par page (administration.settings.pageAccess),
   activer un mode « Personnalisé » : une liste de CATÉGORIES autorisées
   (Permanent / Non permanent / chaque fonction / aucune fonction) complétée
   par des INCLUSIONS et EXCLUSIONS de personnes précises (fiche Personnel).
   Une personne est admise si elle est incluse explicitement OU appartient à
   une catégorie cochée, et qu'elle n'est pas exclue. Le superutilisateur, lui,
   garde toujours l'accès intégral. */
export const ADMIN_ACCESS_CATEGORY_META = {
  Permanent: { label: 'Permanent / Technique', icon: '👤', tone: 'bg-blue-50 border-blue-200 text-blue-700', hint: 'Toute fiche de statut Permanent ou Technique (avec ou sans fonction).' },
  'Non permanent': { label: 'Non permanent', icon: '🎓', tone: 'bg-amber-50 border-amber-200 text-amber-700', hint: 'Doctorants, ATER, post-docs, stagiaires, CDD, vacataires…' },
  AP: { label: 'AP', icon: '🛡️', tone: 'bg-violet-50 border-violet-200 text-violet-700', hint: 'Agent de prévention (Hygiène & Sécurité).' },
  Gestionnaire: { label: 'Gestionnaire', icon: '🧾', tone: 'bg-emerald-50 border-emerald-200 text-emerald-700', hint: 'Travaille à partir du bon de commande (BC) et du suivi des dépenses.' },
  Achats: { label: "Responsable d'achats", icon: '🛍️', tone: 'bg-cyan-50 border-cyan-200 text-cyan-700', hint: "Reçoit les devis créés depuis les OM / achats prévus (notification e-mail)." },
  'Aucune fonction': { label: 'Aucune fonction', icon: '·', tone: 'bg-slate-50 border-slate-200 text-slate-600', hint: 'Fiches sans AP, sans Gestionnaire et sans Responsable d’achats.' },
};
export const ADMIN_ACCESS_CATEGORIES = Object.keys(ADMIN_ACCESS_CATEGORY_META);

/** Catégories d’accès d’un profil (statut + toutes ses fonctions). */
export const profileAccessCategoriesOf = (profile) => {
  const p = profile || {};
  const out = [];
  const statut = p.statut === 'Permanent' ? 'Permanent' : 'Non permanent';
  if (out.indexOf(statut) === -1) out.push(statut);
  (Array.isArray(p.fonctions) ? p.fonctions : []).forEach((f) => {
    if (ADMIN_ACCESS_CATEGORIES.indexOf(f) !== -1 && out.indexOf(f) === -1) out.push(f);
  });
  if (!(p.fonctions || []).length && out.indexOf('Aucune fonction') === -1) out.push('Aucune fonction');
  return out;
};

/** Règle personnalisée enregistrée pour une page (null = matrice par défaut). */
export const pageAccessRuleOf = (settings, pageId) => {
  const rules = settings && settings.pageAccess && typeof settings.pageAccess === 'object'
    ? settings.pageAccess
    : {};
  const rule = rules && rules[pageId];
  if (!rule || typeof rule !== 'object') return null;
  if (String(rule.mode || '').trim() !== 'custom') return null;
  return {
    roles: (Array.isArray(rule.roles) ? rule.roles : []).filter((c) => ADMIN_ACCESS_CATEGORIES.indexOf(c) !== -1),
    include: (Array.isArray(rule.include) ? rule.include : []).filter(Boolean),
    exclude: (Array.isArray(rule.exclude) ? rule.exclude : []).filter(Boolean),
  };
};

/** Un profil d’accès peut-il voir la page ? Matrice par défaut, sauf si une
 *  règle personnalisée existe pour cette page (elle remplace alors la matrice). */
export const adminCanProfileViewPage = (profile, settings, pageId) => {
  const p = profile || {};
  if (p.isSuperuser) return true;
  const rule = pageAccessRuleOf(settings, pageId);
  if (!rule) return adminPageIdsForProfile(p).has(pageId);
  const pid = p.person && p.person.id;
  if (pid && rule.exclude.indexOf(pid) !== -1) return false;
  if (pid && rule.include.indexOf(pid) !== -1) return true;
  return profileAccessCategoriesOf(p).some((c) => rule.roles.indexOf(c) !== -1);
};

/** Ensemble des ids de pages autorisés (matrice par défaut + règles Setup). */
export const adminPageIdsFor = (profile, settings) => {
  const ids = new Set();
  ADMIN_PAGES.forEach((page) => {
    if (adminCanProfileViewPage(profile, settings, page.id)) ids.add(page.id);
  });
  /* La page Setup reste accessible à TOUT membre connecté : elle y change son
     propre mot de passe (seule la fiche « Mon compte » est affichée hors
     superutilisateur — voir SettingsPage). Bootstrap déjà couvert plus haut. */
  ids.add('settings');
  return ids;
};

/**
 * Matrice de visibilité d’une page d’administration pour un utilisateur donné.
 * En bootstrap (aucun compte ou aucun superutilisateur défini), la page
 * « Paramètres » reste accessible pour créer l’équipe / le superutilisateur.
 * `personnel` = fiches Personnel de la base d’administration ouverte ;
 * `settings`  = administration.settings (règles personnalisées « Accès aux
 * pages », optionnelles).
 */
export const adminCanViewPage = (page, currentUser, operators, personnel, settings) => {
  if (!page) return false;
  if (page.id === 'settings' && !hasDefinedSuperuser(operators)) return true;
  const profile = adminAccessProfile(currentUser, operators, personnel);
  return adminPageIdsFor(profile, settings).has(page.id);
};

/* ── Semence d’une base d’administration ────────────────────────────────── */
/** Contenu vide d’une nouvelle base d’administration (un objet par dataset). */
export const createAdministrationSeed = () => {
  const lists = {};
  Object.keys(ADMIN_COLLECTIONS).forEach((k) => { lists[k] = []; });
  lists.settings = JSON.parse(JSON.stringify(DEFAULT_OPTIONS));
  return lists;
};


