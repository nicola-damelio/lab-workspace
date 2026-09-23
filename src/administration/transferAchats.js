/* =========================================================================
   src/administration/transferAchats.js
   Transfert des lignes « OM prévus » et « Achats prévus / souhaités » vers
   la gestionnaire ou le responsable d'achats (fonction « Achats » des fiches
   Personnel).

   Deux circuits possibles selon la NATURE du paiement :
     · « Commande / BC »  → un devis « En attente » pré-rempli est créé dans la
       page « Approbation devis & BC » — UN devis par poste de coût (OM). Le
       poste est soldé quand la dépense liée porte la date de signature de son
       BC (dateSignature, page Dépenses).
     · « Remboursement »  → les postes correspondants sont migrés vers le
       registre dédié « Remboursements » (collection `reimbursements`, onglet
       Remboursements de la page Dépenses). La fiche créée porte le drapeau
       `aCorriger` (badge « À corriger ») : elle est corrigée à la main une
       fois les justificatifs réels connus. Le poste est soldé quand la fiche
       n'est plus « à corriger ».

   Le modèle de liens posé sur les enregistrements créés :
     devisBc (kind 'devis')   : sourceKind ('om' | 'desiderate'), sourceId,
                                sourcePart (poste OM), transfert { cible, by, at }
     reimbursements           : sourceKind 'om', sourceId, aCorriger: true,
                                transfert { cible, by, at }
   Une OM (ou un achat) transférée reste visible dans sa page d'origine —
   badge « En attente de gestion » — et n'en disparaît que lorsque TOUS les
   postes sont soldés (BC signés + remboursements corrigés).
   ========================================================================= */
import {
  REIMBURSEMENT_COST_FIELDS, DEPENSE_BC_SIGNE, APPROVAL_APPROVED, APPROVAL_REJECTED, APPROVAL_NOT_RETAINED,
} from './adminSchema';
import { parseEuroAmount } from './importUtils';
import { personnelEmailsMatching } from './emailNotify';

/* ── Petites aides ─────────────────────────────────────────────────────── */
export const txt = (v) => (v === null || v === undefined ? '' : String(v).trim());
const pick = (rec, keys) => {
  for (const k of keys) {
    const v = rec && rec[k];
    if (txt(v)) return v;
  }
  return '';
};
export const parseNum = (v) => {
  const n = parseEuroAmount(v);
  return n === null ? null : Math.round(n * 100) / 100;
};
const isoOf = (v) => {
  const s = txt(v);
  return s ? s.slice(0, 10) : '';
};
const todayIso = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
export const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

/* ── Destinataires du transfert ────────────────────────────────────────── */
/** Cibles possibles d'un transfert. La valeur sert de code de « Fonction »
 *  de la fiche Personnel (Gestionnaire ou Achats = responsable d'achats). */
export const TRANSFER_TARGETS = {
  Gestionnaire: {
    code: 'Gestionnaire',
    title: 'Gestionnaire',
    article: 'la gestionnaire',
    icon: '🧾',
    hint: 'Fiches Personnel dont la fonction est « Gestionnaire ».',
  },
  Achats: {
    code: 'Achats',
    title: "Responsable d'achats",
    article: "le responsable d'achats",
    icon: '🛍️',
    hint: "Fiches Personnel dont la fonction est « Responsable d'achats ».",
  },
};
export const targetMetaOf = (cible) => TRANSFER_TARGETS[cible] || TRANSFER_TARGETS.Gestionnaire;

/** Adresses e-mail des fiches Personnel portant la fonction de la cible. */
export const cibleEmailsOf = (personnel, cible) => {
  const meta = targetMetaOf(cible);
  return personnelEmailsMatching(personnel, { fonction: meta.code });
};

/* ── Modes de paiement d'un poste de coût (OM) ─────────────────────────── */
export const PART_MODE_LABELS = {
  bc: { code: 'bc', label: 'Commande / BC', short: 'BC' },
  reimb: { code: 'reimb', label: 'Remboursement', short: 'Remb.' },
};
/** Mode d'un poste : défaut « bc » (commande) ; « reimb » explicite. */
export const partModeOf = (om, key) =>
  om && om.partMode && om.partMode[key] === 'reimb' ? 'reimb' : 'bc';
/** Montant chiffré d'un poste de coût d'une OM (null si non renseigné). */
export const partMontantOf = (om, key) => {
  if (!om) return null;
  const v = om[key];
  if (v === undefined || v === null || String(v).trim() === '') return null;
  return parseNum(v);
};
/** Postes d'une OM chiffrés et non nuls, avec leur mode de paiement. */
export const omPartsOf = (om) => REIMBURSEMENT_COST_FIELDS
  .map((f) => ({
    key: f.key,
    label: f.label,
    icon: f.icon,
    montant: partMontantOf(om, f.key),
    mode: partModeOf(om, f.key),
  }))
  .filter((p) => p.montant !== null && p.montant !== 0);

/** Résumé du transfert possible d'une OM (postes Commande vs Remboursement). */
export const omTransferSummary = (om) => {
  const parts = omPartsOf(om);
  const sum = (list) => Math.round((list || []).reduce((s, p) => s + (p.montant || 0), 0) * 100) / 100;
  return {
    parts,
    commande: parts.filter((p) => p.mode === 'bc'),
    remboursement: parts.filter((p) => p.mode === 'reimb'),
    commandeTotal: sum(parts.filter((p) => p.mode === 'bc')),
    remboursementTotal: sum(parts.filter((p) => p.mode === 'reimb')),
    hasCommande: parts.some((p) => p.mode === 'bc'),
    hasRemboursement: parts.some((p) => p.mode === 'reimb'),
  };
};

/* ── Construction des enregistrements créés par le transfert ───────────── */
const transferStamp = (cible, by) => ({ cible, by: txt(by) || '', at: Date.now() });

/** Patch « devis » (collection devisBc) pour un poste « Commande » d'une OM. */
export const devisPatchFromOmPart = (om, part, { cible, by } = {}) => {
  const mission = txt(om && pick(om, ['description', 'intitule', 'nom'])) || 'OM';
  const partLabel = txt(part && part.label);
  const poste = partLabel || txt(part && part.key) || '';
  const omNote = txt(om && pick(om, ['commentaires', 'notes']));
  const noteCree = `Créé automatiquement depuis l'OM « ${mission} »${poste ? ` (poste « ${poste} »)` : ''} par ${txt(by) || '—'} — à compléter : fournisseur, N° devis et fichier avant approbation.`;
  return {
    kind: 'devis',
    statut: 'En attente',
    description: poste ? `${mission} — ${poste}` : mission,
    /* Une mission ne désigne pas de fournisseur : à compléter par le
       destinataire (fournisseur, N° devis et fichier) avant approbation. */
    fournisseur: '',
    ligneBudgetaire: txt(om && pick(om, ['ligneBudgetaire', 'ligne'])),
    demandeur: txt(om && pick(om, ['demandeur', 'porteur', 'nom', 'name'])),
    numDevis: '',
    numBC: '',
    devisId: '',
    montant: parseNum(part && part.montant),
    fraisPort: null,
    fichierNom: '',
    fichierUrl: '',
    fichierMime: '',
    notes: [omNote, noteCree].filter(Boolean).join(' · '),
    /* « Déposé par » = le demandeur (celui qui a soumis l’OM), jamais
       l’opérateur qui transfère (souvent le superutilisateur). */
    deposant: txt(om && pick(om, ['demandeur', 'porteur', 'nom', 'name'])) || txt(by) || '',
    dateDepot: todayIso(),
    sourceKind: 'om',
    sourceId: om && om.id,
    sourcePart: txt(part && part.key),
    sourcePartLabel: poste,
    transfert: { ...transferStamp(cible, by), depuis: 'om' },
  };
};

/** Patch « fiche Remboursement » (collection reimbursements) pour les postes
 *  « Remboursement » d'une OM. UNE fiche regroupe tous les postes concernés ;
 *  elle est créée avec le drapeau `aCorriger` (badge « À corriger »). */
export const reimbPatchFromOm = (om, parts, { cible, by } = {}) => {
  const list = (Array.isArray(parts) ? parts : []).filter((p) => p && p.montant);
  const couts = {};
  list.forEach((p) => { couts[p.key] = p.montant; });
  const coutTotal = Math.round(list.reduce((s, p) => s + p.montant, 0) * 100) / 100;
  const mission = txt(om && pick(om, ['description', 'intitule', 'nom'])) || 'Frais de mission';
  const postes = list.map((p) => p.label).filter(Boolean).join(' · ');
  const note = txt(om && pick(om, ['commentaires', 'notes']));
  return {
    description: mission,
    demandeur: txt(om && pick(om, ['demandeur', 'porteur', 'nom', 'name'])),
    destination: txt(om && pick(om, ['destination', 'ville'])),
    numOM: txt(om && pick(om, ['numOM', 'numeroOm', 'omNo'])),
    categorie: txt(om && om.categorie),
    ligneBudgetaire: txt(om && pick(om, ['ligneBudgetaire', 'ligne'])),
    recetteId: (om && om.recetteId) || '',
    dateDemande: isoOf(om && om.dateDemande),
    dateMission: isoOf(om && pick(om, ['dateMission', 'dateDebut'])),
    dateRetour: isoOf(om && om.dateRetour),
    coutStatut: txt(om && pick(om, ['coutStatut', 'prix'])) || 'Estimé',
    commentaires: [note, `Frais « ${postes || 'remboursement'} » créés automatiquement depuis l'OM par ${txt(by) || '—'}.`]
      .filter(Boolean).join(' · '),
    ...couts,
    coutTotal,
    /* Badge « À corriger » : montants estimés repris de l'OM, à corriger à la
       main une fois les justificatifs réels connus (case dédiée du formulaire
       Remboursement). */
    aCorriger: true,
    sourceKind: 'om',
    sourceId: om && om.id,
    transfert: { ...transferStamp(cible, by), depuis: 'om' },
  };
};

/** Patch « devis » (collection devisBc) pour un achat prévu / souhaité.
 *  Depuis l’ajout des champs obligatoires de la page « Achats prévus /
 *  souhaités » (description, N° devis, ligne budgétaire, fournisseur, montant,
 *  frais de port, demandeur et fichier du devis), le devis pré-rempli est
 *  COMPLET — il n’est plus à compléter par le destinataire avant approbation. */
export const devisPatchFromDesiderata = (rec, { cible, by } = {}) => {
  const objet = txt(rec && pick(rec, ['description', 'intitule', 'nom'])) || 'Achat prévu / souhaité';
  const devisUrl = txt(rec && pick(rec, ['fichierUrl', 'numDevisUrl', 'devisUrl', 'urlDevis', 'lienDevis', 'devisLink']));
  const fichierNom = txt(rec && pick(rec, ['fichierNom', 'devisFileName']));
  const fichierMime = txt(rec && rec.fichierMime);
  const note = txt(rec && pick(rec, ['commentaires', 'notes']));
  const ligne = txt(rec && pick(rec, ['ligneBudgetaire', 'ligne']));
  return {
    kind: 'devis',
    statut: 'En attente',
    description: objet,
    fournisseur: txt(rec && pick(rec, ['fournisseur', 'nomFournisseur'])),
    ligneBudgetaire: ligne,
    demandeur: txt(rec && pick(rec, ['demandeur', 'porteur', 'nom', 'name'])),
    numDevis: txt(rec && pick(rec, ['numDevis', 'devisNo'])),
    numBC: '',
    devisId: '',
    montant: parseNum(rec && rec.montantEstime),
    fraisPort: parseNum(rec && rec.fraisPort),
    fichierNom,
    fichierUrl: devisUrl,
    fichierMime,
    notes: [note, `Créé automatiquement depuis l'achat prévu / souhaité par ${txt(by) || '—'}.`]
      .filter(Boolean).join(' · '),
    /* « Déposé par » = le demandeur de l’achat prévu / souhaité. */
    deposant: txt(rec && pick(rec, ['demandeur', 'porteur', 'nom', 'name'])) || txt(by) || '',
    dateDepot: todayIso(),
    sourceKind: 'desiderate',
    sourceId: rec && rec.id,
    sourcePart: '',
    sourcePartLabel: '',
    transfert: { ...transferStamp(cible, by), depuis: 'desiderate' },
  };
};


/* ── Résolution : quand un élément est-il « soldé » ? ──────────────────── */
/** Date de signature du BC d'une dépense (colonne « Date signature »). */
export const bcSignatureDateOf = (dep) => txt(dep && (dep.dateSignature || dep.dateSignatureBC));
/** Statuts d'une dépense d'achat qui supposent un bon de commande signé. */
const BC_SIGNED_STATUSES = new Set([
  DEPENSE_BC_SIGNE,
  'Service fait',
  'Livré',
  'Facturé',
  'Clôturé',
  'Colis partiellement livré',
  'Facture signé',
  'Validé par le fournisseur',
]);
/** Vrai si la dépense liée a son bon de commande signé : date de signature du
 *  BC renseignée, sinon statut du pipeline à partir de « BC signé ». */
export const isDepenseBcSigne = (dep) => {
  if (!dep) return false;
  const st = txt(dep.statut || dep.suivi);
  if (/refus|rejet|annul/i.test(st)) return false;
  if (bcSignatureDateOf(dep)) return true;
  return BC_SIGNED_STATUSES.has(st);
};

/** Devis (kind 'devis') créé par transfert pour une source donnée. */
export const devisRecordFor = (devisBcList, sourceKind, sourceId, sourcePart = '') =>
  (Array.isArray(devisBcList) ? devisBcList : [])
    .find((d) => d && d.kind === 'devis' && d.sourceKind === sourceKind && d.sourceId === sourceId
      && (!sourcePart || d.sourcePart === sourcePart)) || null;

/** Fiche Remboursement créée par transfert d'une OM. */
export const reimbRecordFor = (reimbList, sourceId) =>
  (Array.isArray(reimbList) ? reimbList : [])
    .find((r) => r && r.sourceKind === 'om' && r.sourceId === sourceId) || null;

/* ── Transferts « orphelins » (leur origine a été supprimée) ───────────── */
/* Décisions qui ÉCARTENT définitivement un devis / BC : la demande d'origine
   n'a plus rien en cours de ce côté (elle ne débouchera jamais sur une
   dépense signée). */
const DEAD_DEVIS_STATUSES = new Set([APPROVAL_REJECTED, APPROVAL_NOT_RETAINED]);
/** Un devis / BC est encore « vivant » s'il n'a pas été définitivement écarté. */
const isLiveDevis = (d) => !DEAD_DEVIS_STATUSES.has(txt(d && d.statut));

/* ── Migration « devis signé → BC à faire » (page Approbation devis & BC) ── */
/* Règle métier : dès qu'un devis est SIGNÉ (approuvé), il ne reste plus dans la
   table « Devis à approuver » — il migre dans la section « BC à faire et à
   approuver » (son bon de commande reste à faire, puis à approuver ; c'est
   l'approbation du BC qui crée la dépense « BC signé »). La ligne du devis y
   reste tant qu'AUCUN bon de commande n'est déposé pour lui, puis s'efface
   devant celle du BC (elle revient si le BC est refusé ou supprimé). */
/** Vrai si le devis a été signé (approuvé) par le superutilisateur. */
export const isDevisSigned = (rec) => !!rec && rec.kind === 'devis'
  && txt(rec.statut) === APPROVAL_APPROVED;

/** Vrai si un BC encore VIVANT (ni refusé ni non retenu) est rattaché à ce
 *  devis : le devis n'a alors plus « son BC à faire », la ligne du BC prend le
 *  relais dans la section « BC à faire et à approuver ». */
export const devisHasBc = (devisBcList, devisId) => (Array.isArray(devisBcList) ? devisBcList : [])
  .some((d) => d && d.kind === 'bc' && txt(d.devisId) === txt(devisId) && isLiveDevis(d));

/** Lignes « BC à faire » de la section « BC à faire et à approuver » : les
 *  devis signés dont le bon de commande reste à déposer (celles-là même qu'on
 *  clique pour ouvrir le formulaire de dépôt du BC). */
export const devisAwaitingBc = (devisBcList, devisList) => (Array.isArray(devisList) ? devisList : [])
  .filter((d) => isDevisSigned(d) && !devisHasBc(devisBcList, d.id));

/**
 * Vrai si le transfert d'une demande (OM `kind='om'` ou achat prévu / souhaité
 * `kind='desiderate'`) est « orphelin » : la demande porte la marque `transfert`
 * mais PLUS AUCUNE de ses cibles n'existe dans la base — c'est la situation
 * typique quand le devis / BC (son « origine ») et la dépense liée ont été
 * supprimés :
 *   · aucun devis / BC déposé ne la référence encore (hors « Refusé » /
 *     « Non retenu ») via `sourceKind` / `sourceId` ;
 *   · aucune dépense créée directement depuis elle (`omId` / `desiderataId`) ;
 *   · aucune fiche Remboursement issue d'elle (sourceKind 'om').
 * Un tel transfert est obsolète : la demande n'est plus une prévision. Elle
 * reste consultable (et supprimable) dans sa page d'origine via « Afficher les
 * transférées », mais la page Recettes ne la compte plus dans « OM prévus » /
 * « Achats prévus » — une demande acceptée n'apparaît que comme dépense.
 */
export const demandeTransferOrphaned = (rec, kind, devisBcList, depenses, reimbList) => {
  if (!rec || !rec.id || !rec.transfert) return false;
  const target = txt(kind);
  const liveDevis = (Array.isArray(devisBcList) ? devisBcList : [])
    .some((d) => d && txt(d.sourceKind) === target && txt(d.sourceId) === rec.id && isLiveDevis(d));
  if (liveDevis) return false;
  const linkedDep = (Array.isArray(depenses) ? depenses : []).some((d) => d
    && (target === 'om' ? txt(d.omId) === rec.id : txt(d.desiderataId) === rec.id));
  if (linkedDep) return false;
  const linkedReimb = (Array.isArray(reimbList) ? reimbList : [])
    .some((r) => r && txt(r.sourceKind) === 'om' && txt(r.sourceId) === rec.id);
  if (linkedReimb) return false;
  return true;
};

/** Statut détaillé des postes d'une OM transférée (par transfert « devis/BC »
 *  ou « remboursement »). Retourne pour chaque poste chiffré son mode, son
 *  état et `resolved`. */
export const omTransferStatus = (om, devisBcList, depenses, reimbList) => {
  const parts = omPartsOf(om);
  const reimb = reimbRecordFor(reimbList, om && om.id);
  const mapped = parts.map((p) => {
    if (p.mode === 'reimb') {
      return {
        ...p,
        fiche: reimb,
        resolved: !!(reimb && !reimb.aCorriger),
        state: reimb ? (reimb.aCorriger ? 'reimb-a-corriger' : 'reimb-corrige') : 'reimb-attente',
      };
    }
    const devis = devisRecordFor(devisBcList, 'om', om && om.id, p.key);
    const dep = devis && devis.depenseId
      ? (Array.isArray(depenses) ? depenses : []).find((d) => d && d.id === devis.depenseId) || null
      : null;
    const resolved = dep ? isDepenseBcSigne(dep) : false;
    return {
      ...p,
      devis,
      dep,
      resolved,
      state: devis
        ? (dep ? (resolved ? 'bc-signe' : 'bc-en-cours') : 'bc-devis-attente')
        : 'bc-attente',
    };
  });
  const pending = mapped.filter((p) => !p.resolved);
  return {
    transferred: !!(om && om.transfert),
    reimb,
    parts: mapped,
    pending: pending.length,
    allResolved: mapped.length > 0 && pending.length === 0,
    hasCosts: mapped.length > 0,
  };
};

/** Statut du transfert « devis » d'un achat prévu / souhaité. */
export const desiderataTransferStatus = (rec, devisBcList, depenses) => {
  const devis = devisRecordFor(devisBcList, 'desiderate', rec && rec.id);
  const dep = devis && devis.depenseId
    ? (Array.isArray(depenses) ? depenses : []).find((d) => d && d.id === devis.depenseId) || null
    : null;
  const bcSigned = dep ? isDepenseBcSigne(dep) : false;
  /* Devis signé au transfert (« ✓ Signature et BC ») : le suivi est celui de la
     section « BC à faire et à approuver » de la page « Approbation devis &
     BC » — « Devis signé · BC à faire » tant que la dépense n'est pas créée. */
  const devisSigned = isDevisSigned(devis);
  return {
    transferred: !!(rec && (rec.transfert || devis)),
    devis,
    dep,
    devisSigned,
    bcSigned,
    state: devis
      ? (dep ? (bcSigned ? 'bc-signe' : 'bc-en-cours') : (devisSigned ? 'bc-a-faire' : 'devis-attente'))
      : 'non-transfere',
  };
};


/* ── Circuit « gestion de requêtes » (transferts pour signature / révision) ── */
/** Modes de transfert d’une demande acceptée (directeur) :
 *  · 'signature' (« ✓ Signature et BC ») → documents complets : le devis est
 *    SIGNÉ immédiatement (approbation + copie signée du PDF) et arrive dans la
 *    section « BC à faire et à approuver » de la page « Approbation devis &
 *    BC » — son BC reste à faire, puis à approuver ;
 *  · 'revision'  → documents manquants : les devis générés partent « En
 *    gestion » pour être complétés par la responsable d'achats. */
export const TRANSFER_MODES = {
  SIGNATURE: 'signature',
  REVISION: 'revision',
};
/** Mode enregistré sur un transfert (rétro-compatible avec les transferts
 *  antérieurs, qui n'en portaient pas — ils sont considérés « signature »). */
export const transferModeOf = (rec) =>
  txt(rec && rec.transfert && rec.transfert.mode) || TRANSFER_MODES.SIGNATURE;

/** Un devis est « complet » (prêt pour la signature) quand il porte un N° devis
 *  ET un fichier/lien (les autres champs — fournisseur, montant… — sont exigés
 *  à la saisie ou repris de la demande). */
export const devisCompleteOf = (rec) =>
  !!txt(rec && pick(rec, ['numDevis', 'devisNo'])) &&
  !!(txt(rec && (rec.fichierUrl || rec.numDevisUrl)) || txt(rec && rec.fichierNom));

/** Vrai si le devis est en attente d'être complété (« En gestion »). */
export const isDevisGestion = (rec) => txt(rec && rec.statut) === 'En gestion';

/** Une demande (achat prévu) est « complète » quand son devis (N° + fichier)
 *  a été fourni par le demandeur — c'est le critère du directeur pour choisir
 *  « pour signature » plutôt que « pour révision ». */
export const demandeDevisCompleteOf = (rec) =>
  !!txt(rec && pick(rec, ['numDevis', 'devisNo'])) &&
  !!(devisUrlOfAchat(rec));

/** Lien du fichier devis d'un achat prévu / souhaité (téléversé ou collé). */
const devisUrlOfAchat = (rec) => txt(rec && pick(rec, ['fichierUrl', 'numDevisUrl', 'devisUrl', 'urlDevis', 'lienDevis', 'devisLink']));

