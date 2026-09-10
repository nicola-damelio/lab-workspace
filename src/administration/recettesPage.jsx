/* =========================================================================
   src/administration/recettesPage.jsx
   Page « Recettes » — lignes budgétaires.
   Chaque ligne : type Fonctionnement / Investissement, porteur, budget total,
   montant mis à disposition par l’université, dépenses déjà ordonnées
   (BC signés), ordres de mission (acceptés / à prévoir — y compris ceux
   marqués « Test », comptés en prévision sans être acceptés), souhaits d’achat
   liés, solde calculé, date de fin d’engagement et commentaires.
   Les agrégats sont calculés depuis les collections depenses / om /
   desiderate / reimbursements de la même base (liaison par recetteId /
   recetteSuggereeId).
   ========================================================================= */
import React, { useEffect, useMemo, useState } from 'react';
import { useAdmin } from './AdminContext';
import { RECETTE_TYPES, DEPENSE_BC_SIGNE, depenseKindOf, isDesiderataRejected, isDesiderataApproved, isDesiderataTest, desiderataDecisionOf, reimbTotalOf, isSalaireRecetteType } from './adminSchema';
import {
  omTransferStatus, demandeTransferOrphaned, omTransferSummary, reimbPatchFromOm,
  TRANSFER_TARGETS, targetMetaOf,
} from './transferAchats';
import { AdminImportModal } from './adminImportModal';
import { SmartTable } from './smartTable';
import { useDepenseLinkRepair } from './useDepenseLinkRepair';

const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const asDate = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 10) : '');

/* Lecture d’une date de fin d’engagement → minuit UTC en millisecondes.
   La base stocke les dates en « aaaa-mm-jj » (import ou <input type=date>) ;
   d’anciennes valeurs « jj/mm/aaaa » restent acceptées. Retourne null si vide. */
const parseEngagementDate = (v) => {
  const s = typeof v === 'string' ? v.trim().slice(0, 10) : '';
  if (!s) return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (iso) return Date.UTC(+iso[1], +iso[2] - 1, +iso[3]);
  const fr = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (fr) return Date.UTC(+fr[3], +fr[2] - 1, +fr[1]);
  return null;
};
/* Décalage « calendrier » de N mois en UTC, en ramenant au dernier jour du
   mois en cas de dépassement (ex. 31 mai + 3 mois = 31 août). */
const addMonthsUTC = (t, months) => {
  const d = new Date(t);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d.getTime();
};

const txt = (v) => String(v ?? '').trim();
/* « Lignes salaires » : lignes budgétaires de rémunération du personnel —
   type « Salaire » saisi dans l’app (à l’import, la catégorie « Autres » de la
   feuille « Lignes budgétaires » est convertie en « Salaire »). Le type
   « Autres » des bases historiques reste reconnu à l’affichage. Elles sont
   affichées dans l’onglet « Salaires » de la page, séparées des lignes
   Fonctionnement / Investissement. */
const isSalaireType = (r) => isSalaireRecetteType(r && r.type);
/* « Rémunération stages » : dépenses dont la « Classification / nature »
   (`classification`, valeur « Stages » de l’onglet Dépenses) correspond à une
   gratification de stagiaire. Elles sont retirées des onglets Achats / PI / OM
   de la page Dépenses et décomptées ici dans leur propre colonne, déduite du
   solde (jamais comptées deux fois). */
const isStageNature = (v) => {
  const s = txt(v).toLowerCase();
  if (!s) return false;
  // « Stages », « Stage », « Rémunération stages »… → toute valeur contenant « stage(s) ».
  return /(^|[^a-zà-ÿ])stages?([^a-zà-ÿ]|$)/.test(s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
};
const isStageDepense = (d) => isStageNature(d && (d.classification || d.nature));
/* « Remboursements » : frais avancés par un membre puis remboursés par le
   laboratoire. Ils vivent dans un registre DÉDIÉ (collection
   `reimbursements`, onglet « Remboursements » de la page Dépenses) — jamais
   dans la table Dépenses. La détection ci-dessous ne sert plus qu’à écarter
   d’éventuelles anciennes lignes du classeur encore classées
   « Remboursements » dans `depenses` (elles sont rapatriées automatiquement
   par AdminContext) des colonnes « Achats / PI / OM payés ». */
const isReimbNature = (v) => {
  const s = txt(v).toLowerCase();
  if (!s) return false;
  // « Remboursements », « Remboursement », « Remboursé », « Reimbursement »…
  // → toute valeur contenant « rembours… » / « reimburs… ».
  return /(^|[^a-zà-ÿ])(rembours\w*|reimburs\w*)([^a-zà-ÿ]|$)/.test(s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
};
const isReimbDepense = (d) => isReimbNature(d && (d.classification || d.nature));
/* Statuts d’une dépense d’achat qui supposent un bon de commande signé
   (pipeline : « BC signé », puis Service fait / Livré / Facturé / Clôturé…). */
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
/* Date de signature du BC d’une dépense (colonne « Date signature » du
   classeur → dateSignature ; anciens enregistrements : dateSignatureBC). */
const bcSignatureDateOf = (d) => {
  if (!d) return '';
  return txt(d.dateSignature) || txt(d.dateSignatureBC);
};
/* « Achats (BC signé) » d’une ligne budgétaire : dépenses de type « achat »
   (hors prestations internes « PI » et hors OM) dont le bon de commande est
   signé. On ne se limite pas au statut littéral « BC signé » : un achat peut
   être passé à un état plus avancé (« Service fait », « Facturé »…) tout en
   ayant un BC signé — le repère fiable est la date de signature du BC
   renseignée ; à défaut, un statut du pipeline à partir de « BC signé »
   compte aussi. Les dépenses refusées / rejetées / annulées sont écartées. */
const isAchatBcSigne = (d) => {
  if (!d) return false;
  const st = txt(d.statut || d.suivi);
  if (/refus|rejet|annul/i.test(st)) return false;
  if (bcSignatureDateOf(d)) return true;
  return BC_SIGNED_STATUSES.has(st);
};
/* « OM approuvé » : le statut « Acceptée » correspond à la décision positive
   (les valeurs d’import anglaises restent reconnues). C’est le seul seuil qui
   compte dans la colonne « OM prévus » de la page Recettes — les OM en attente
   / terminés restent visibles au survol mais ne sont pas inclus dans la somme. */
const isOmApproved = (raw) =>
  /accept/i.test(String(raw || '').normalize('NFD').replace(/[\u0300-\u036f]/g, ''));

/* « OM en test » : statut « Test » (choix du superutilisateur). Ces OM sont
   comptées dans la colonne « OM prévus » (prévision), mais ne sont jamais
   acceptées / transférées. */
const isOmTest = (raw) => /^test$/i.test(String(raw || '').trim());

export const RecettesPage = () => {
  const { data, settings, upsert, removeRecord, access, navigate, updateMany, currentUser } = useAdmin();
  const recettes = useMemo(() => (Array.isArray(data.recettes) ? data.recettes : []), [data.recettes]);
  const depenses = useMemo(() => (Array.isArray(data.depenses) ? data.depenses : []), [data.depenses]);
  const om = useMemo(() => (Array.isArray(data.om) ? data.om : []), [data.om]);
  /* Registre « Remboursements » — collection DÉDIÉE, indépendante de la table
     Dépenses : les fiches de frais avancés par un membre puis remboursés par le
     laboratoire n’y figurent jamais (ni BC, ni SIFAC). Décomptées dans la
     colonne « Remboursements », déduite du solde de la ligne budgétaire. */
  const reimbursements = useMemo(
    () => (Array.isArray(data.reimbursements) ? data.reimbursements : []),
    [data.reimbursements]
  );
  const desiderate = useMemo(() => (Array.isArray(data.desiderate) ? data.desiderate : []), [data.desiderate]);
  /* Devis / BC déposés (« Approbation devis & BC ») : suivent les demandes
     « Achats prévus / souhaités » et les postes « Commande » des OM acceptées
     transférées pour signature ou en révision. */
  const devisBc = useMemo(() => (Array.isArray(data.devisBc) ? data.devisBc : []), [data.devisBc]);
  const personnel = useMemo(() => (Array.isArray(data.personnel) ? data.personnel : []), [data.personnel]);

  /* Liens des cases « au survol » : un élément d’une autre table (dépense, OM,
     achat prévu) s’ouvre dans sa table d’origine si le profil y a accès. */
  const canOpenDepenses = !!access.canViewPage({ id: 'depenses' });
  const canOpenOm = !!access.canViewPage({ id: 'om' });
  const canOpenDesiderata = !!access.canViewPage({ id: 'desiderate' });
  /* « Approbation devis & BC » : la colonne « En signature / signé » renvoie
     vers la position exacte du devis dans cette page (onglet Devis), pas vers
     la demande d’origine. */
  const canOpenApprobation = !!access.canViewPage({ id: 'devisBc' });
  const openTarget = (target) => {
    if (!target || !target.recordId) return;
    if (typeof navigate === 'function') navigate(target.pageId, { kind: target.kind, recordId: target.recordId });
  };
  const depLink = (d) => (canOpenDepenses && d && d.id ? { pageId: 'depenses', kind: 'depense', recordId: d.id } : null);
  const reimbLink = (x) => (canOpenDepenses && x && x.id ? { pageId: 'depenses', kind: 'reimb', recordId: x.id } : null);
  const omLink = (o) => (canOpenOm && o && o.id ? { pageId: 'om', kind: 'om', recordId: o.id } : null);
  const desLink = (d) => (canOpenDesiderata && d && d.id ? { pageId: 'desiderate', kind: 'desiderata', recordId: d.id } : null);
  const devisBcLink = (v) => (canOpenApprobation && v && v.id ? { pageId: 'devisBc', kind: v.kind || 'devis', recordId: v.id } : null);

  /* Devis « Approbation devis & BC » lié à un souhait d'achat transféré pour
     signature ou en révision (même recherche que les pages « Achats prévus /
     souhaités » et la colonne « Devis en signature/signé »). */
  const devisOfDesiderata = (d) => {
    const id = d && d.id;
    if (!id) return null;
    return (Array.isArray(devisBc) ? devisBc : []).find(
      (x) => x && x.kind === 'devis' && x.sourceKind === 'desiderate' && x.sourceId === id && !x.sourcePart
    ) || null;
  };
  /* Dépense « Dépenses › Achats » créée directement depuis un souhait (transfert
     sans passage par la page « Approbation devis & BC »). */
  const directDepenseOfDesiderata = (d) => {
    const id = d && d.id;
    if (!id) return null;
    return (Array.isArray(depenses) ? depenses : []).find((x) => x && x.desiderataId === id) || null;
  };

  const [modal, setModal] = useState(null);
  const [importOpen, setImportOpen] = useState(false); // {mode:'new'} | {mode:'edit', rec} | {mode:'link', rec}
  const [tab, setTab] = useState('budgets'); // 'budgets' : Fonctionnement / Investissement · 'salaires' : type « Salaire »
  /* Bandeau d’information : bilan d’une suppression / d’un transfert lancé
     DEPUIS cette page (les éléments appartiennent aux pages Dépenses, OM et
     Achats prévus / souhaités : ils sont masqués au bout de quelques secondes). */
  const [notice, setNotice] = useState(null); // { tone: 'ok' | 'warn', text, target? }

  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(null), 9000);
    return () => clearTimeout(t);
  }, [notice]);

  /* Réattribution automatique des dépenses dont la « Catégorie » contredit le
     type de la ligne imputée (ex. dépense « Fonctionnement » liée à une fiche
     « Investissement ») — trace ajoutée dans les commentaires de la dépense. */
  const linkRepair = useDepenseLinkRepair();

  const types = Array.isArray(settings.recetteTypes) && settings.recetteTypes.length
    ? settings.recetteTypes
    : RECETTE_TYPES;

  /* Répartition de l’onglet actif : « Lignes budgétaires » (Fonctionnement /
     Investissement) d’un côté, « Salaires » (type « Salaire » — « Autres »
     historique toujours reconnu) de l’autre. */
  const budgets = useMemo(() => recettes.filter((r) => !isSalaireType(r)), [recettes]);
  const salaires = useMemo(() => recettes.filter((r) => isSalaireType(r)), [recettes]);
  const activeRecettes = useMemo(
    () => (tab === 'salaires' ? salaires : budgets),
    [tab, salaires, budgets]
  );

  const personName = (idOrName) => {
    if (!idOrName) return '';
    const found = personnel.find((p) => p.id === idOrName);
    return found ? (found.nom || '') : String(idOrName);
  };

  const aggFor = (rec) => {
    const recId = rec && rec.id;
    const notRejected = (d) => !/refus|rejet|annul/i.test(txt(d.statut || d.suivi));
    /* Décompte retenu pour le solde (Achats BC signé + prestations internes +
       OM payés + rémunérations de stage + remboursements) :
       · « Achats (BC signé) » = lignes d’achat dont le bon de commande est
         signé — BC signé même si le statut a ensuite avancé (Service fait,
         Facturé…) : repère = date de signature du BC renseignée, sinon statut
         à partir de « BC signé » dans le pipeline. Elles retirent le montant
         du solde dès la signature, même avant réception ;
       · « Prestations internes (PI) » = facturées sans bon de commande, elles
         sont considérées consommées dès leur saisie (sauf refus / annulation) ;
       · « OM payés » = lignes de type « om » (créées depuis « OM prévus /
         souhaités » → transfert vers Dépenses › OM) qui suivent le paiement ;
       · « Rémunération stages » = lignes classées « Stages » (classification /
         nature de la dépense) — elles sont exclues des trois colonnes
         précédentes afin de n’être comptées qu’ici ;
       · « Remboursements » = fiches du registre dédié (collection
         `reimbursements`, onglet « Remboursements » de la page Dépenses) :
         frais avancés par un membre puis remboursés par le laboratoire. Ce
         registre est INDÉPENDANT de la table Dépenses (ni BC, ni SIFAC) et ses
         fiches y restent — elles n’en migrent jamais.
       Les OM « prévus / souhaités » (collection om) restent INFORMATIFS : ils
       ne réduisent le solde que lorsqu’ils ont été transférés en dépense OM. */
    const lineDepenses = depenses.filter((d) => d.recetteId === recId);
    const ordonneeRows = lineDepenses.filter((d) => depenseKindOf(d) === 'achat' && !isStageDepense(d) && !isReimbDepense(d) && isAchatBcSigne(d));
    const ordonneeTotal = ordonneeRows.reduce((s, d) => s + toNum(d.montant) + toNum(d.fraisPort), 0);
    /* Colonne « Prestations internes » : même liste que l’onglet PI de la page
       Dépenses (type « pi », fournisseur « PI ») imputée sur cette ligne. */
    const piRows = lineDepenses.filter((d) => depenseKindOf(d) === 'pi' && !isStageDepense(d) && !isReimbDepense(d) && notRejected(d));
    const piTotal = piRows.reduce((s, d) => s + toNum(d.montant) + toNum(d.fraisPort), 0);
    /* Colonne « OM payés » : même liste que l’onglet OM de la page Dépenses
       (type « om », créée depuis « OM prévus / souhaités » → → Dépenses). */
    const omPaidRows = lineDepenses.filter((d) => depenseKindOf(d) === 'om' && !isStageDepense(d) && !isReimbDepense(d) && notRejected(d));
    const omPaidTotal = omPaidRows.reduce((s, d) => s + toNum(d.montant) + toNum(d.fraisPort), 0);
    /* Colonne « Rémunération stages » : mêmes lignes que l’onglet du même nom
       de la page Dépenses (classification / nature « Stages »), toutes familles
       confondues, imputées sur cette ligne — elles sont donc exclues des
       colonnes « Achats (BC signé) » / « Prestations internes » / « OM payés ». */
    const stageRows = lineDepenses.filter((d) => isStageDepense(d) && notRejected(d));
    const stageTotal = stageRows.reduce((s, d) => s + toNum(d.montant) + toNum(d.fraisPort), 0);
    /* Colonne « Remboursements » : fiches du registre DÉDIÉ de la page Dépenses
       (collection `reimbursements`), imputées sur cette ligne par recetteId.
       Ce ne sont jamais des dépenses (ni BC, ni SIFAC) : chaque fiche décrit
       des frais avancés par un membre et son coût total est déduit du solde. */
    const reimbRows = reimbursements.filter((x) => x && x.recetteId === recId);
    const reimbTotal = reimbRows.reduce((s, x) => s + reimbTotalOf(x), 0);
    /* « OM prévus / en signature » : les OM approuvés (« Acceptée ») comptent,
       ainsi que les OM « Test » (choix du superutilisateur : comptées en
       prévision, sans être réellement acceptées). Une OM acceptée mais PAS
       encore transférée reste « OM prévus ». Dès qu'elle est transférée pour
       signature, ses postes « Commande » dont le devis est « En attente de
       signature » ou déjà signé (BC pas encore signé) passent dans la colonne
       « OM en signature / signé » ; les postes « Commande » dont le devis est
       « En gestion » (à compléter) restent prévus ; les postes soldés (BC
       signé) sont suivis via la dépense liée. Les OM « Test » ne sont jamais
       transférées : elles restent « OM prévus » tant que le statut ne passe
       pas à « Acceptée ». */
    const lineOm = om.filter((o) => o.recetteId === recId && String(o.statut || 'En attente').trim() !== 'Refusée');
    const omApprouves = lineOm.filter((o) => isOmApproved(o.statut));
    const omEnTest = lineOm.filter((o) => isOmTest(o.statut));
    const omEnSignatureItems = [];
    const omPrevuItems = [];
    omApprouves.forEach((o) => {
      const st = omTransferStatus(o, devisBc, depenses, reimbursements);
      if (!st.transferred) {
        omPrevuItems.push({ om: o, whole: true });
        return;
      }
      /* Transfert « orphelin » (devis / BC d'origine ET dépense liée supprimés) :
         l'OM a bien été acceptée mais plus rien ne la rattache à une dépense —
         elle ne compte donc plus parmi les prévisions. Elle reste consultable
         (et supprimable) dans sa page via « Afficher les transférées » : une OM
         acceptée ne doit apparaître que comme dépense. */
      if (demandeTransferOrphaned(o, 'om', devisBc, depenses, reimbursements)) return;
      const enSig = st.parts.filter((p) => {
        if (p.mode !== 'bc' || p.state === 'bc-signe') return false;
        if (!p.devis || p.devis.statut === 'En gestion') return false;
        if (p.devis.statut !== 'En attente' && p.devis.statut !== 'Approuvé') return false;
        /* Devis approuvé dont la dépense liée a disparu (« orphelin ») : plus
           compté « en signature » — il reste visible dans « Approbation devis
           & BC » pour être supprimé ou réparé. */
        if (p.devis.statut === 'Approuvé' && p.devis.depenseId && !p.dep) return false;
        return true;
      });
      const restePrevu = st.parts.filter((p) => p.mode === 'bc'
        && (p.state === 'bc-attente' || (p.devis && p.devis.statut === 'En gestion')));
      if (enSig.length) omEnSignatureItems.push({ om: o, parts: enSig });
      if (restePrevu.length) omPrevuItems.push({ om: o, parts: restePrevu });
    });
    /* OM « Test » : jamais transférées, elles restent intégralement dans la
       colonne « OM prévus » (aucun e-mail, aucun transfert — c'est une
       prévision, pas une acceptation). */
    omEnTest.forEach((o) => omPrevuItems.push({ om: o, whole: true }));
    const omEnSignatureTotal = omEnSignatureItems.reduce((s, x) => s
      + x.parts.reduce((s2, p) => s2 + (p.montant || 0), 0), 0);
    const omTotal = omPrevuItems.reduce((s, x) => {
      if (x.whole) return s + toNum(x.om.coutTotal);
      return s + x.parts.reduce((s2, p) => s2 + (p.montant || 0), 0);
    }, 0);
    /* — Achats prévus / « Devis en signature ou signé » — */
    const lineDes = desiderate.filter((d) => d.recetteSuggereeId === recId && !isDesiderataRejected(d.statut));
    const desApprouvees = lineDes.filter((d) => isDesiderataApproved(d.statut));
    const desEnSignatureItems = [];
    const desPrevuItems = [];
    desApprouvees.forEach((d) => {
      const dv = devisBc.find((x) => x && x.kind === 'devis' && x.sourceKind === 'desiderate'
        && x.sourceId === d.id && !x.sourcePart) || null;
      const depOfDv = dv && dv.depenseId ? depenses.find((x) => x && x.id === dv.depenseId) : null;
      const directDep = depenses.find((x) => x && x.desiderataId === d.id) || null;
      const bcSigned = (depOfDv && isAchatBcSigne(depOfDv)) || (directDep && isAchatBcSigne(directDep));
      if (bcSigned) return; /* soldé : suivi par la colonne « Achats (BC signé) » */
      /* Devis « orphelin » : le devis est approuvé mais la dépense liée a été
         supprimée (ou le devis lui-même a disparu après un transfert) — plus
         rien ne le relie à la page « Approbation devis & BC ». Il ne doit plus
         être compté « en signature » (ni en « prévu ») : le superutilisateur le
         voit dans « Approbation devis & BC » pour le supprimer ou le réparer. */
      const orphanDevis = !!(dv && dv.statut === 'Approuvé' && txt(dv.depenseId) && !depOfDv)
        || (!dv && !!d.transfert);
      const dvLive = !!dv && (dv.statut === 'En attente' || dv.statut === 'Approuvé');
      if (dvLive && d.transfert && !orphanDevis) desEnSignatureItems.push(d);
      else if (!orphanDevis) desPrevuItems.push(d);
    });
    /* Demandes « Test » (choix du superutilisateur) : comptées « Achats prévus »
       comme une prévision, sans être réellement acceptées. Elles n'ont jamais
       de devis / transfert ; seul un éventuel lien direct déjà soldé (BC signé)
       les retirerait de la prévision (cas hors-circuit, par sécurité). */
    lineDes.filter((d) => isDesiderataTest(d.statut)).forEach((d) => {
      const directDep = depenses.find((x) => x && x.desiderataId === d.id) || null;
      const bcSigned = !!directDep && isAchatBcSigne(directDep);
      if (!bcSigned) desPrevuItems.push(d);
    });
    const desEnSignatureTotal = desEnSignatureItems.reduce((s, d) => s + toNum(d.montantEstime) + toNum(d.fraisPort), 0);
    const desMontant = desPrevuItems.reduce((s, d) => s + toNum(d.montantEstime), 0);
    const budgetRendu = rec.budgetRenduDispo !== undefined && rec.budgetRenduDispo !== null && rec.budgetRenduDispo !== ''
      ? toNum(rec.budgetRenduDispo)
      : toNum(rec.budgetTotal);
    // Solde = dispo université − Achats (BC signé) − prestations internes − OM payés − rémunérations de stage − remboursements (jamais les souhaits / OM prévus).
    const solde = budgetRendu - ordonneeTotal - piTotal - omPaidTotal - stageTotal - reimbTotal;
    /* « OM prévus encore à payer » : OM acceptées (ou « Test », prévision)
       pas encore transférées — et, pour une OM transférée, les postes
       « Commande » dont le devis n'est pas encore parti en signature (devis
       « En gestion » / pas de devis). */
    const omPrevuEnCours = omPrevuItems.reduce((s, x) => {
      if (x.whole) return s + toNum(x.om.coutTotal);
      return s + x.parts.reduce((s2, p) => s2 + (p.montant || 0), 0);
    }, 0);
    /* « Solde prévu » = solde − OM prévus − achats prévus − montants déjà en
       signature / signés (devis et OM « en signature / signé ») : projection du
       solde si toutes les prévisions (et signatures en cours) se concrétisent. */
    const soldePrevu = solde - omPrevuEnCours - desMontant - omEnSignatureTotal - desEnSignatureTotal;
    return {
      lineDepenses, ordonneeRows, ordonneeTotal,
      piRows, piTotal, omPaidRows, omPaidTotal, stageRows, stageTotal,
      reimbRows, reimbTotal,
      lineOm, omApprouves,
      omEnAttente: lineOm.filter((o) => String(o.statut || 'En attente').trim() === 'En attente'),
      omTotal, omPrevuEnCours, soldePrevu,
      omEnSignatureItems, omEnSignatureTotal,
      omPrevuItems,
      lineDes, desApprouvees, desMontant,
      desEnSignatureItems, desEnSignatureTotal,
      budgetRendu, solde,
    };
  };

  const totals = useMemo(() => {
    let budgetTotal = 0; let budgetRendu = 0; let pi = 0; let omPay = 0; let omTot = 0; let des = 0; let reimb = 0;
    let omSign = 0; let desSign = 0; let solde = 0; let soldePrevu = 0;
    activeRecettes.forEach((r) => {
      const a = aggFor(r);
      budgetTotal += toNum(r.budgetTotal);
      budgetRendu += a.budgetRendu;
      pi += a.piTotal; omPay += a.omPaidTotal; omTot += a.omTotal; des += a.desMontant; reimb += a.reimbTotal;
      omSign += a.omEnSignatureTotal; desSign += a.desEnSignatureTotal;
      solde += a.solde;
      soldePrevu += a.soldePrevu;
    });
    return { budgetTotal, budgetRendu, pi, omPay, omTot, des, reimb, omSign, desSign, solde, soldePrevu };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRecettes, depenses, om, reimbursements, desiderate, devisBc]);

  const onSaveLine = (patch, existingId) => {
    if (!String(patch.ligne || '').trim()) { alert('Merci de donner un intitulé à la ligne budgétaire.'); return; }
    const cleaned = {
      ...patch,
      ligne: String(patch.ligne || '').trim(),
      type: patch.type || types[0],
      porteur: String(patch.porteur || '').trim(),
      budgetTotal: patch.budgetTotal === '' || patch.budgetTotal === null || patch.budgetTotal === undefined
        ? null : toNum(patch.budgetTotal),
      budgetRenduDispo: patch.budgetRenduDispo === '' || patch.budgetRenduDispo === null || patch.budgetRenduDispo === undefined
        ? null : toNum(patch.budgetRenduDispo),
      dateDebut: asDate(patch.dateDebut),
      dateFin: asDate(patch.dateFin),
      dateFinEngagement: asDate(patch.dateFinEngagement),
      notes: String(patch.notes || ''),
    };
    upsert('recettes', cleaned, existingId);
    setModal(null);
  };

  const onRemoveLine = (rec) => {
    if (window.confirm(`Supprimer la ligne budgétaire « ${rec.ligne || rec.id} » ?`)) removeRecord('recettes', rec);
  };

  /* Droit de suppression directe depuis cette page : la page agrège des lignes
     qui vivent ailleurs (dépenses, remboursements, OM, achats prévus) et les
     supprime À LA SOURCE depuis un simple survol — c’est donc plus sensible que
     la page qui les héberge : réservé au SUPERUTILISATEUR, comme les décisions
     et transferts des pages OM Prévus / Achats prévus. */
  const isSuper = !!access.isSuperuser;
  const currentName = txt(
    (access.profile && access.profile.person && access.profile.person.nom)
    || (currentUser && currentUser.name)
  );

  /* ── Suppression directe depuis la page Recettes ──────────────────────────
     Les cases « au survol » listent les lignes agrégées : chacune peut être
     supprimée à la source sans quitter cette page (superutilisateur). */

  /* Dépense (Achats / PI / OM payés / Rémunération stages) — superutilisateur. */
  const removeDepenseRow = (d) => {
    if (!d || !isSuper) return;
    const label = txt(d.description) || txt(d.numBC || d.numSIFAC || d.numFacture) || d.id || 'cette dépense';
    if (!window.confirm(`Supprimer définitivement la dépense « ${label} » ?\n\nElle disparaît de la page Dépenses et de tous les totaux de cette page.`)) return;
    /* Nettoyage des liens ENTRANTS (même règle que la page Dépenses) : un devis
       / BC ou une OM source ne doit pas rester rattaché à une dépense
       supprimée. */
    const devisChanges = devisBc
      .filter((x) => x && x.id && txt(x.depenseId) === d.id)
      .map((x) => ({ id: x.id, patch: { depenseId: null } }));
    if (devisChanges.length) updateMany('devisBc', devisChanges);
    const omChanges = om
      .filter((o) => o && o.id && txt(o.depenseId) === d.id)
      .map((o) => ({ id: o.id, patch: { depenseId: null } }));
    if (omChanges.length) updateMany('om', omChanges);
    removeRecord('depenses', d);
    setNotice({ tone: 'ok', text: `Dépense « ${label} » supprimée.` });
  };

  /* Fiche du registre « Remboursements » — superutilisateur. */
  const removeReimbRow = (x) => {
    if (!x || !isSuper) return;
    const label = txt(x.description) || 'ce remboursement';
    if (!window.confirm(`Supprimer définitivement le remboursement « ${label} » ?`)) return;
    removeRecord('reimbursements', x);
    setNotice({ tone: 'ok', text: `Remboursement « ${label} » supprimé.` });
  };

  /* Ordre de mission « prévu / souhaité » (suppression réservée au
     superutilisateur, comme la page OM Prévus). */
  const removeOmRow = (o) => {
    if (!o || !isSuper) return;
    const label = txt(o.description) || txt(o.destination) || o.id || 'cet OM';
    if (!window.confirm(`Supprimer l’ordre de mission « ${label} » ?\n\nCette action est définitive.`)) return;
    removeRecord('om', o);
    setNotice({ tone: 'ok', text: `Ordre de mission « ${label} » supprimé.` });
  };

  /* Achat prévu / souhaité (superutilisateur uniquement). */
  const removeDesiderataRow = (rec) => {
    if (!rec || !isSuper) return;
    const label = txt(rec.description) || rec.id || 'cet achat prévu';
    if (!window.confirm(`Supprimer l’achat prévu / souhaité « ${label} » ?\n\nCette action est définitive.`)) return;
    removeRecord('desiderate', rec);
    setNotice({ tone: 'ok', text: `Achat prévu / souhaité « ${label} » supprimé.` });
  };

  /* ── Transfert d’une OM prévue vers « Dépenses › Remboursements » ─────────
     Circuit « frais avancés » : le laboratoire rembourse la mission au lieu de
     passer commande. Tous les postes chiffrés de l’OM deviennent des postes
     « Remboursement » et UNE fiche du registre dédié est créée (badge
     « À corriger », comme depuis la page OM Prévus) ; l’OM est marquée
     transférée afin de ne plus compter dans « OM prévus » — son montant passe
     dans la colonne « Remboursements », déduite du solde. */
  const transferOmToReimb = (o) => {
    if (!o || !isSuper) return;
    if (!o.id) {
      setNotice({ tone: 'warn', text: 'Cet OM n’a pas d’identifiant : rechargez la page (l’application en attribue un automatiquement), puis réessayez.' });
      return;
    }
    const label = txt(o.description) || txt(o.destination) || o.id;
    const summary = omTransferSummary(o);
    if (!summary.parts.length) {
      setNotice({ tone: 'warn', text: `Chiffrez au moins un poste de coût avant de transférer l’OM « ${label} » vers les remboursements.` });
      return;
    }
    const already = reimbursements.find((r) => r && txt(r.sourceKind) === 'om' && txt(r.sourceId) === o.id) || null;
    if (already) {
      setNotice({
        tone: 'ok',
        text: `L’OM « ${label} » est déjà transférée dans Dépenses › Remboursements.`,
        target: { pageId: 'depenses', kind: 'reimb', recordId: already.id },
      });
      return;
    }
    /* OM déjà transmise pour signature (des devis existent déjà) : basculer ses
       postes en remboursement laisserait ces devis orphelins dans « Approbation
       devis & BC » — on l’explique plutôt que de le faire silencieusement. */
    if (o.transfert && !o.transfert.remboursementsSeuls) {
      setNotice({
        tone: 'warn',
        text: `L’OM « ${label} » a déjà été transmise pour signature (devis / BC en cours) : son remboursement se gère depuis « Approbation devis & BC » et la fiche Remboursement créée à cette occasion.`,
      });
      return;
    }
    const cible = TRANSFER_TARGETS.Gestionnaire.code;
    const total = summary.parts.reduce((s, p) => s + (p.montant || 0), 0);
    const lines = [
      `Transférer l’OM « ${label} » vers Dépenses › Remboursements ?`,
      '',
      `• 1 fiche de frais de ${euro.format(total)} (postes : ${summary.parts.map((p) => p.label).join(' · ')}) — badge « À corriger »`,
      `• destinataire : ${targetMetaOf(cible).title}`,
      '• l’OM disparaît de « OM prévus » (et de sa page, rétablie par « Afficher les transférées ») : son montant est déduit du solde de la ligne budgétaire',
    ];
    if (!window.confirm(lines.join('\n'))) return;
    /* Tous les postes deviennent « Remboursement » : aucun poste ne reste
       compté « OM prévu » (sinon le montant serait compté deux fois). */
    const partMode = { ...(o.partMode || {}) };
    summary.parts.forEach((p) => { partMode[p.key] = 'reimb'; });
    const saved = upsert('reimbursements', reimbPatchFromOm(o, summary.parts, { cible, by: currentName }), null);
    upsert('om', {
      ...(isOmApproved(o.statut)
        ? {}
        : { statut: 'Acceptée', statutChangedBy: currentName, statutChangedAt: Date.now() }),
      partMode,
      transfert: {
        cible,
        by: currentName,
        at: Date.now(),
        depuis: 'om',
        remboursementsSeuls: true,
        reimbId: (saved && saved.id) || '',
      },
    }, o.id);
    setNotice({
      tone: 'ok',
      text: `OM « ${label} » transférée vers Dépenses › Remboursements (fiche « À corriger », ${euro.format(total)}).`,
      target: saved && saved.id ? { pageId: 'depenses', kind: 'reimb', recordId: saved.id } : null,
    });
  };

  /* Boutons d’action rendus à côté de chaque élément listé au survol d’une
     case (🗑 supprimer · ↪ transférer vers les remboursements).
     Suppression à la source ET transfert : SUPERUTILISATEUR uniquement. */
  const depenseActions = (d) => (isSuper
    ? [{ label: '🗑', title: 'Supprimer la dépense (superutilisateur) — retire aussi la ligne de la page Dépenses', onClick: () => removeDepenseRow(d) }]
    : []);
  const reimbActions = (x) => (isSuper
    ? [{ label: '🗑', title: 'Supprimer le remboursement (superutilisateur) — Dépenses › Remboursements', onClick: () => removeReimbRow(x) }]
    : []);
  const omActions = (o) => (isSuper
    ? [
      {
        label: '↪ Remb.',
        title: 'Transférer l’OM vers Dépenses › Remboursements (frais avancés : tous les postes deviennent « Remboursement », montant déduit du solde)',
        tone: 'border-amber-200 text-amber-700 hover:bg-amber-50',
        onClick: () => transferOmToReimb(o),
      },
      { label: '🗑', title: 'Supprimer l’ordre de mission', onClick: () => removeOmRow(o) },
    ]
    : []);
  const desActions = (rec) => (isSuper
    ? [{ label: '🗑', title: 'Supprimer l’achat prévu / souhaité', onClick: () => removeDesiderataRow(rec) }]
    : []);

  /* Lignes enrichies des agrégats (tri/filtre sur les colonnes calculées). */
  const recetteRows = useMemo(
    () => activeRecettes.map((rec) => ({ ...rec, __agg: aggFor(rec) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeRecettes, depenses, om, reimbursements, desiderate, devisBc]
  );

  /* Seuil d’alerte « Fin d’engagement » : la date passe en rouge dès qu’il
     reste 3 mois ou moins (date du jour + 3 mois ≥ échéance), et le reste une
     fois l’échéance dépassée (la ligne doit être prolongée / réengagée). */
  const now = new Date();
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const engagementAlertLimit = addMonthsUTC(todayUTC, 3);
  const isEngagementAlert = (raw) => {
    const t = parseEngagementDate(raw);
    return t !== null && t <= engagementAlertLimit;
  };

  /* Colonnes triables/filtrables — rendu des cellules conservé à l’identique. */
  const recetteCols = [
    {
      key: 'ligne', label: 'Ligne budgétaire', filter: 'text',
      value: (r) => r.ligne || r.id || '',
      display: (r) => (
        <div className="min-w-[220px]">
          <div className="font-bold text-slate-800 leading-snug">{r.ligne || r.id}</div>
          {r.notes ? (
            <div className="text-[11px] text-slate-400 italic max-w-[220px] line-clamp-2" title={r.notes}>{r.notes}</div>
          ) : null}
        </div>
      ),
    },
    {
      key: 'type', label: 'Type',
      value: (r) => r.type || types[0] || '',
      display: (r) => {
        const t = r.type || types[0];
        const badge = String(t) === 'Investissement'
          ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
          : isSalaireType(r)
            ? 'bg-amber-50 border-amber-200 text-amber-700'
            : 'bg-emerald-50 border-emerald-200 text-emerald-700';
        return (
          <span className={`inline-block text-[10px] font-black uppercase px-2 py-0.5 rounded-full border ${badge}`}>
            {t}
          </span>
        );
      },
    },
    {
      key: 'porteur', label: 'Porteur',
      value: (r) => personName(r.porteur) || '',
      display: (r) => <span className="text-slate-700">{personName(r.porteur) || '—'}</span>,
    },
    {
      key: 'budgetTotal', label: 'Budget total', dataType: 'number', align: 'right', nowrap: true,
      value: (r) => (r.budgetTotal === null || r.budgetTotal === undefined || r.budgetTotal === '' ? null : Number(r.budgetTotal)),
      display: (r) => (
        r.budgetTotal === null || r.budgetTotal === undefined || r.budgetTotal === ''
          ? <span className="text-slate-300">—</span>
          : <span className="font-semibold text-slate-800 whitespace-nowrap">{euro.format(toNum(r.budgetTotal))}</span>
      ),
    },
    {
      key: 'dispo', label: 'Dispo université', dataType: 'number', align: 'right', nowrap: true,
      value: (r) => Number(r.__agg.budgetRendu) || 0,
      display: (r) => <span className="font-semibold text-blue-700 whitespace-nowrap">{euro.format(r.__agg.budgetRendu)}</span>,
    },
    {
      key: 'achatsBc', label: 'Achats (BC signé)',
      header: <span title="Achats dont le bon de commande est signé (date de signature du BC renseignée, ou statut à partir de « BC signé ») — déduits du solde">Achats (BC signé)</span>,
      dataType: 'number', align: 'right', nowrap: true,
      value: (r) => Number(r.__agg.ordonneeTotal) || 0,
      display: (r) => (
        <HoverCell
          amount={r.__agg.ordonneeTotal}
          onOpen={openTarget}
          items={r.__agg.ordonneeRows.map((d) => ({
            title: d.description || 'Achat',
            meta: [d.numBC || d.bcNo || d.sifacNo || '', d.statut || d.suivi || ''].filter(Boolean).join(' · '),
            value: euro.format(toNum(d.montant) + toNum(d.fraisPort)),
            to: depLink(d),
            actions: depenseActions(d),
          }))}
        />
      ),
    },
    {
      key: 'pi', label: 'Prestations internes', dataType: 'number', align: 'right', nowrap: true,
      value: (r) => Number(r.__agg.piTotal) || 0,
      display: (r) => (
        <HoverCell
          amount={r.__agg.piTotal}
          onOpen={openTarget}
          items={r.__agg.piRows.map((d) => ({
            title: d.description || 'Prestation interne',
            meta: ['PI (prestation interne)', d.dateSignatureBC || d.dateSignature || ''].filter(Boolean).join(' · '),
            value: euro.format(toNum(d.montant) + toNum(d.fraisPort)),
            to: depLink(d),
            actions: depenseActions(d),
          }))}
        />
      ),
    },
    {
      key: 'omPay', label: 'OM payés', dataType: 'number', align: 'right', nowrap: true,
      value: (r) => Number(r.__agg.omPaidTotal) || 0,
      display: (r) => (
        <HoverCell
          amount={r.__agg.omPaidTotal}
          onOpen={openTarget}
          items={r.__agg.omPaidRows.map((d) => ({
            title: d.description || d.destination || 'Dépense OM',
            meta: [d.destination || '', d.omNo || d.bcNo || '', d.statut || d.suivi || ''].filter(Boolean).join(' · '),
            value: euro.format(toNum(d.montant) + toNum(d.fraisPort)),
            to: depLink(d),
            actions: depenseActions(d),
          }))}
        />
      ),
    },
    {
      key: 'stages', label: 'Rémunération stages',
      header: <span title="Dépenses dont la « Classification / nature » est « Stages » (onglet « Rémunération stages » de la page Dépenses) — déduites du solde">Rémunération stages</span>,
      dataType: 'number', align: 'right', nowrap: true,
      value: (r) => Number(r.__agg.stageTotal) || 0,
      display: (r) => (
        <HoverCell
          amount={r.__agg.stageTotal}
          onOpen={openTarget}
          items={r.__agg.stageRows.map((d) => ({
            title: d.description || 'Rémunération de stage',
            meta: ['Stages', d.numBC || d.numSIFAC || '', d.statut || d.suivi || ''].filter(Boolean).join(' · '),
            value: euro.format(toNum(d.montant) + toNum(d.fraisPort)),
            to: depLink(d),
            actions: depenseActions(d),
          }))}
        />
      ),
    },
    {
      key: 'remboursements', label: 'Remboursements',
      header: <span title="Registre dédié de la page Dépenses › onglet « Remboursements » (collection `reimbursements`) : frais avancés par un membre puis remboursés par le laboratoire — jamais de BC / SIFAC, déduits du solde">Remboursements</span>,
      dataType: 'number', align: 'right', nowrap: true,
      value: (r) => Number(r.__agg.reimbTotal) || 0,
      display: (r) => (
        <HoverCell
          amount={r.__agg.reimbTotal}
          onOpen={openTarget}
          items={r.__agg.reimbRows.map((x) => ({
            title: x.description || 'Remboursement',
            meta: ['Remboursement de frais', x.destination || '', x.numOM || '', x.dateMission || ''].filter(Boolean).join(' · '),
            value: euro.format(reimbTotalOf(x)),
            to: reimbLink(x),
            actions: reimbActions(x),
          }))}
        />
      ),
    },
    {
      key: 'om', label: 'OM prévus',
      header: <span title="prévision (OM « Acceptée » et OM « Test » comptées ; les OM en attente / terminées ne le sont pas) — n’est PAS déduit du solde : seul l’« OM payé » (dépense transférée) l’est">OM prévus</span>,
      dataType: 'number', align: 'right', nowrap: true,
      value: (r) => Number(r.__agg.omTotal) || 0,
      display: (r) => (
        <HoverCell
          amount={r.__agg.omTotal}
          onOpen={openTarget}
          items={r.__agg.lineOm.map((o) => ({
            title: o.description || o.destination || 'OM',
            meta: [
              o.destination || '',
              `${o.statut || 'En attente'}${isOmApproved(o.statut) ? ' · accepté' : isOmTest(o.statut) ? ' · en test' : ' · non accepté'}`,
              o.transfert
                ? (o.transfert.remboursementsSeuls
                  ? 'frais à rembourser — hors prévision (colonne Remboursements)'
                  : 'transférée — hors prévision (suivie en signature)')
                : '',
            ].filter(Boolean).join(' · '),
            value: euro.format(toNum(o.coutTotal)),
            to: omLink(o),
            actions: omActions(o),
          }))}
        />
      ),
    },
    {
      key: 'desiderata', label: 'Achats prévus',
      header: <span title="Achats « Approuvés » et achats « Test » comptés en prévision ; non déduits du solde — information seule">Achats prévus</span>,
      dataType: 'number', align: 'right', nowrap: true,
      value: (r) => Number(r.__agg.desMontant) || 0,
      display: (r) => (
        <HoverCell
          amount={r.__agg.desMontant}
          onOpen={openTarget}
          items={r.__agg.lineDes.map((d) => {
            const dv = devisOfDesiderata(d);
            const direct = directDepenseOfDesiderata(d);
            return {
              title: d.description || 'Achat prévu / souhaité',
              meta: [
                d.demandeur || '',
                desiderataDecisionOf(d.statut),
                /* Dès qu'une demande est devenue un devis, la « dépense » vit
                   dans « Approbation devis & BC » : le libellé l'indique et le
                   clic y mène (ou vers la dépense si transfert direct). */
                dv
                  ? dv.statut === 'Approuvé'
                    ? 'devis signé — BC à signer'
                    : dv.statut === 'En attente'
                      ? 'devis en attente de signature'
                      : dv.statut === 'En gestion'
                        ? 'devis à compléter — Approbation devis & BC'
                        : 'devis — Approbation devis & BC'
                  : direct ? 'transféré — Dépenses › Achats' : '',
              ].filter(Boolean).join(' · '),
              value: d.montantEstime !== undefined && d.montantEstime !== null && d.montantEstime !== ''
                ? euro.format(toNum(d.montantEstime))
                : 'non chiffré',
              to: dv ? devisBcLink(dv) : (direct ? depLink(direct) : desLink(d)),
              actions: desActions(d),
            };
          })}
        />
      ),
    },
    {
      key: 'devisEnSignature', label: 'Devis en signature/signé',
      header: <span title="Achats prévus / souhaités acceptés et transférés pour signature : devis « en attente de signature » ou déjà signé (BC pas encore signé) — déduit du solde prévu">Devis en signature/signé</span>,
      dataType: 'number', align: 'right', nowrap: true,
      value: (r) => Number(r.__agg.desEnSignatureTotal) || 0,
      display: (r) => (
        <HoverCell
          amount={r.__agg.desEnSignatureTotal}
          onOpen={openTarget}
          items={r.__agg.desEnSignatureItems.map((d) => {
            const dv = (Array.isArray(devisBc) ? devisBc : []).find((x) => x && x.kind === 'devis'
              && x.sourceKind === 'desiderate' && x.sourceId === d.id && !x.sourcePart) || null;
            return {
              title: d.description || 'Achat prévu / souhaité',
              meta: [d.demandeur || '', dv && dv.numDevis ? dv.numDevis : d.numDevis || '',
                dv ? (dv.statut === 'Approuvé' ? 'devis signé — BC à signer' : 'devis en attente de signature') : ''].filter(Boolean).join(' · '),
              value: euro.format(toNum(d.montantEstime) + toNum(d.fraisPort)),
              /* Le lien mène à la position du devis dans « Approbation devis & BC ». */
              to: dv ? devisBcLink(dv) : desLink(d),
            };
          })}
        />
      ),
    },
    {
      key: 'omEnSignature', label: 'OM en signature/signé',
      header: <span title="OM acceptées et transférées pour signature : postes « Commande » dont le devis est « en attente de signature » ou déjà signé (BC pas encore signé) — déduit du solde prévu">OM en signature/signé</span>,
      dataType: 'number', align: 'right', nowrap: true,
      value: (r) => Number(r.__agg.omEnSignatureTotal) || 0,
      display: (r) => (
        <HoverCell
          amount={r.__agg.omEnSignatureTotal}
          onOpen={openTarget}
          items={r.__agg.omEnSignatureItems.flatMap((x) => (x.parts || []).map((p) => {
            const dv = p && p.devis;
            return {
              title: (x.om && (x.om.description || x.om.destination)) || 'OM',
              meta: [x.om && x.om.destination, p.label,
                dv && dv.numDevis ? dv.numDevis : '',
                dv ? (dv.statut === 'Approuvé' ? 'devis signé — BC à signer' : 'devis en attente de signature') : ''].filter(Boolean).join(' · '),
              value: euro.format(p.montant || 0),
              /* Le lien mène à la position du devis dans « Approbation devis & BC ». */
              to: dv ? devisBcLink(dv) : (x.om ? omLink(x.om) : null),
            };
          }))}
        />
      ),
    },
    {
      key: 'solde', label: 'Solde', dataType: 'number', align: 'right', nowrap: true,
      value: (r) => Number(r.__agg.solde) || 0,
      display: (r) => <SoldeCell agg={r.__agg} />,
    },
    {
      key: 'soldePrevu', label: 'Solde prévu',
      header: <span title="Solde − OM prévus − Achats prévus − Devis en signature/signé − OM en signature/signé : solde restant si toutes les prévisions (et signatures en cours) se concrétisent">Solde prévu</span>,
      dataType: 'number', align: 'right', nowrap: true,
      value: (r) => Number(r.__agg.soldePrevu) || 0,
      display: (r) => <SoldePrevuCell agg={r.__agg} />,
    },
    {
      key: 'finEngagement', label: 'Fin d’engagement', filter: 'text',
      value: (r) => r.dateFinEngagement || '',
      display: (r) => {
        const raw = txt(r.dateFinEngagement);
        const alert = isEngagementAlert(raw);
        return raw
          ? <span
            className={`whitespace-nowrap ${alert ? 'font-black text-red-600' : 'text-slate-600'}`}
            title={alert ? 'Échéance d’engagement à 3 mois ou moins (ou déjà dépassée)' : undefined}
          >{raw}</span>
          : <span className="text-slate-300">—</span>;
      },
    },
    {
      key: 'periode', label: 'Période',
      header: <span title="Dates de début / de fin de la période couverte par la ligne — la « fin d’engagement » des crédits reste dans sa propre colonne">Période</span>,
      filter: 'text',
      value: (r) => [r.dateDebut || '', r.dateFin || ''].filter(Boolean).join(' '),
      display: (r) => {
        const d = txt(r.dateDebut);
        const f = txt(r.dateFin);
        if (!d && !f) return <span className="text-slate-300">—</span>;
        return (
          <span className="whitespace-nowrap text-slate-600">
            <span>{d || '…'}</span>
            <span className="mx-1 text-slate-300">→</span>
            <span>{f || '…'}</span>
          </span>
        );
      },
    },
    {
      key: 'actions', label: '', sortable: false, filterable: false, align: 'right', nowrap: true,
      value: () => '',
      display: (r) => (
        <div className="flex items-center gap-1 justify-end">
          <button onClick={() => setModal({ mode: 'link', rec: r })} title="Lier dépenses / OM / desiderata"
            className="w-7 h-7 rounded-lg border border-slate-200 text-slate-400 hover:bg-blue-50 hover:text-blue-600 text-xs">🔗</button>
          <button onClick={() => setModal({ mode: 'edit', rec: r })} title="Modifier"
            className="w-7 h-7 rounded-lg border border-slate-200 text-slate-400 hover:bg-blue-50 hover:text-blue-600 text-xs">✎</button>
          <button onClick={() => onRemoveLine(r)} title="Supprimer"
            className="w-7 h-7 rounded-lg border border-slate-200 text-slate-400 hover:bg-red-50 hover:text-red-600 text-xs">🗑</button>
        </div>
      ),
    },
    /* Critère de filtre / recherche supplémentaire (sans colonne dédiée). */
    { key: 'notesF', label: 'Notes', hidden: true, filter: 'text', value: (r) => r.notes || '' },
  ];

  return (
    <div className="max-w-full mx-auto flex flex-col gap-4">
      {linkRepair.report && (
        <div
          className={`rounded-xl border px-4 py-2.5 text-xs flex items-start justify-between gap-3 shadow-sm ${
            linkRepair.report.stuck > 0
              ? 'bg-amber-50 border-amber-200 text-amber-800'
              : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}
        >
          <span className="min-w-0">
            {linkRepair.report.fixed > 0
              ? `✓ ${linkRepair.report.fixed} dépense${linkRepair.report.fixed > 1 ? 's' : ''} réattribuée${linkRepair.report.fixed > 1 ? 's' : ''} automatiquement sur la ligne budgétaire du type correspondant à sa catégorie (trace dans les « Commentaires » de la dépense).`
              : ''}
            {linkRepair.report.fixed > 0 && linkRepair.report.stuck > 0 ? ' ' : ''}
            {linkRepair.report.stuck > 0
              ? `${linkRepair.report.fixed > 0 ? '— ' : ''}${linkRepair.report.stuck} dépense${linkRepair.report.stuck > 1 ? 's' : ''} rest${linkRepair.report.stuck > 1 ? 'ent' : 'e'} liée${linkRepair.report.stuck > 1 ? 's' : ''} à une ligne de l’autre type, sans fiche homonyme du bon type : à corriger manuellement (catégorie ou ligne).`
              : ''}
          </span>
          <button
            type="button"
            onClick={linkRepair.clearReport}
            className="shrink-0 font-black opacity-60 hover:opacity-100"
            title="Masquer"
          >✕</button>
        </div>
      )}
      {notice && (
        <div className={`rounded-xl border px-4 py-2.5 text-xs flex items-start justify-between gap-3 shadow-sm ${
          notice.tone === 'warn' ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'
        }`}>
          <span className="min-w-0">{notice.text}</span>
          <span className="flex items-center gap-3 shrink-0">
            {notice.target && (
              <button
                type="button"
                onClick={() => { openTarget(notice.target); setNotice(null); }}
                className="font-black underline"
              >Ouvrir</button>
            )}
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="font-black opacity-60 hover:opacity-100"
              title="Masquer"
            >✕</button>
          </span>
        </div>
      )}
      {/* Barre d’actions */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-400">
          <span className="inline-block w-2 h-2 rounded-full bg-blue-500" aria-hidden="true"></span>
          Chaque ligne affiche ses montants et les éléments liés — survolez une case pour le détail, cliquez un élément lié pour l’ouvrir dans sa table d’origine.
        </div>
        <button
          onClick={() => setImportOpen(true)}
          className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-bold text-sm px-4 py-2 rounded-xl shadow-sm transition-colors flex items-center gap-1.5"
          title="Importer depuis la feuille Google Sheets : Lignes budgétaires, Dépenses (BC/SIFAC), OMs, Souhaités (coller, CSV ou Excel)"
        >
          <span className="text-base leading-none">📥</span> Importer
        </button>
        <button
          onClick={() => setModal({ mode: 'new' })}
          className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm px-4 py-2 rounded-xl shadow-sm transition-colors flex items-center gap-1.5"
        >
          <span className="text-base leading-none">+</span> Nouvelle ligne budgétaire
        </button>
      </div>

      {/* Sélecteur d’onglet : Lignes budgétaires (Fonctionnement / Investissement)
          · Salaires (lignes de rémunération, type « Salaire » — « Autres » historique). */}
      <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl p-1 shadow-sm w-fit flex-wrap">
        {[
          { id: 'budgets', icon: '📈', label: 'Lignes budgétaires', count: budgets.length },
          { id: 'salaires', icon: '👤', label: 'Salaires', count: salaires.length },
        ].map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => setTab(v.id)}
            title={v.id === 'salaires'
              ? 'Lignes de rémunération du personnel — type « Salaire » (l’ancienne catégorie « Autres » des imports reste reconnue)'
              : 'Lignes budgétaires de crédits projets — Fonctionnement / Investissement'}
            className={`px-3 py-1.5 rounded-lg text-xs font-black transition-colors ${tab === v.id ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:bg-blue-50 hover:text-blue-700'}`}
          >
            <span className="mr-1.5">{v.icon}</span>{v.label}
            <span className={`ml-1.5 font-mono text-[10px] ${tab === v.id ? 'text-blue-200' : 'text-slate-400'}`}>{v.count}</span>
          </button>
        ))}
      </div>

      {/* Cartes de synthèse (onglet actif) — bandeau compact */}
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-10 gap-1.5">
        <SummaryCard label="Budget total" value={totals.budgetTotal} tone="slate" />
        <SummaryCard label="Mis à disposition (univ.)" value={totals.budgetRendu} tone="blue" />
        <SummaryCard label="Prestations internes" value={totals.pi} tone="amber" />
        <SummaryCard label="OM payés (Dépenses)" value={totals.omPay} tone="rose" />
        <SummaryCard label="OM prévus (acceptés)" value={totals.omTot} tone="violet" />
        <SummaryCard label="Achats prévus (approuvés)" value={totals.des} tone="teal" />
        <SummaryCard label="Devis en signature/signé" value={totals.desSign} tone="teal" />
        <SummaryCard label="OM en signature/signé" value={totals.omSign} tone="indigo" />
        <SummaryCard label="Solde restant" value={totals.solde} tone={totals.solde < 0 ? 'red' : 'emerald'} />
        <SummaryCard label="Solde prévu" value={totals.soldePrevu} tone={totals.soldePrevu < 0 ? 'red' : 'indigo'} />
      </div>

      {/* Table des lignes budgétaires */}
      {recettes.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-10 text-center">
          <div className="text-4xl mb-2">📈</div>
          <p className="font-black text-slate-700">Aucune ligne budgétaire pour le moment</p>
          <p className="text-sm text-slate-400 mt-1">
            Créez une première ligne (Fonctionnement ou Investissement) pour commencer le suivi du budget.
          </p>
        </div>
      ) : activeRecettes.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-10 text-center">
          <div className="text-4xl mb-2">{tab === 'salaires' ? '👤' : '📈'}</div>
          <p className="font-black text-slate-700">
            {tab === 'salaires' ? 'Aucune ligne « salaires » (type « Salaire »)' : 'Aucune ligne budgétaire (Fonctionnement / Investissement)'}
          </p>
          <p className="text-sm text-slate-400 mt-1">
            {tab === 'salaires'
              ? 'Les lignes de rémunération du personnel (type « Salaire ») s’afficheront ici.'
              : 'Toutes les lignes sont des lignes « salaires » (type « Salaire » ou ancien « Autres ») : elles se trouvent dans l’onglet « Salaires » ci-dessus.'}
          </p>
        </div>
      ) : (
        <SmartTable
          key={tab}
          columns={recetteCols}
          rows={recetteRows}
          minWidth="1600px"
          searchPlaceholder="Rechercher une ligne, un porteur, une note…"
          emptyLabel="Aucune ligne budgétaire pour le moment"
          noMatchLabel={tab === 'salaires'
            ? 'Aucune ligne « salaires » ne correspond aux filtres.'
            : 'Aucune ligne budgétaire ne correspond aux filtres.'}
        />
      )}

      {importOpen && <AdminImportModal kind="recettes" onClose={() => setImportOpen(false)} />}

      {modal && <LineModal
        modal={modal} types={types} personnel={personnel}
        depenses={depenses} om={om} desiderate={desiderate}
        onCancel={() => setModal(null)} onSave={onSaveLine}
      />}
    </div>
  );
};

/* ── Cartes de synthèse ─────────────────────────────────────────────────── */
const SummaryCard = ({ label, value, tone }) => {
  const tones = {
    slate: 'border-slate-200 text-slate-800',
    blue: 'border-blue-200 text-blue-700',
    indigo: 'border-indigo-200 text-indigo-700',
    amber: 'border-amber-200 text-amber-700',
    rose: 'border-rose-200 text-rose-700',
    violet: 'border-violet-200 text-violet-700',
    teal: 'border-teal-200 text-teal-700',
    emerald: 'border-emerald-200 text-emerald-700',
    red: 'border-red-200 text-red-600',
  };
  return (
    <div className={`bg-white border rounded-xl shadow-sm px-3 py-1.5 ${tones[tone] || tones.slate}`}>
      <div className="text-[9px] font-black uppercase tracking-wide opacity-70 leading-none truncate">{label}</div>
      <div className="text-sm font-black mt-1 leading-tight tabular-nums truncate">{euro.format(value)}</div>
    </div>
  );
};

/* ── Cases à détail au survol ─────────────────────────────────────────────
   Seul le montant est affiché (le détail — liste des éléments liés, n° BC /
   SF, statuts… — n’apparaît qu’au survol, via ⓘ) : les colonnes restent
   étroites et la vue d’ensemble de la table reste lisible. Chaque élément
   lié qui appartient à une autre table est cliquable (↗) : il ouvre sa
   définition dans la table d’origine (Dépenses, OM prévus, Achats prévus).
   Un élément peut aussi porter des `actions` (boutons à droite de la ligne) :
   🗑 supprime la ligne À LA SOURCE (dépense, remboursement, OM, achat prévu) et
   « ↪ Remb. » transfère une OM prévue vers le registre « Remboursements ». */
const HoverCell = ({ amount, items, onOpen }) => {
  const linked = Array.isArray(items) ? items : [];
  return (
    <div className="group relative inline-block text-right">
      <div className="font-bold text-slate-800 whitespace-nowrap">
        {euro.format(amount)}
        {linked.length > 0 && (
          <span className="ml-1 text-[11px] text-slate-300 group-hover:text-blue-500 align-middle" aria-hidden="true">ⓘ</span>
        )}
      </div>
      {linked.length > 0 && (
        <div
          className="hidden group-hover:block absolute right-0 top-full mt-1 z-30 w-80 max-h-64 overflow-y-auto custom-scrollbar bg-white border border-slate-200 rounded-xl shadow-2xl p-2"
          onClick={(e) => e.stopPropagation()}
        >
          {linked.map((it, i) => {
            const clickable = !!it.to && typeof onOpen === 'function';
            const acts = Array.isArray(it.actions)
              ? it.actions.filter((a) => a && typeof a.onClick === 'function')
              : [];
            return (
              <div
                key={i}
                className="flex w-full items-start justify-between gap-1 border-b border-slate-100 last:border-0"
              >
                <button
                  type="button"
                  disabled={!clickable}
                  onClick={clickable ? () => onOpen(it.to) : undefined}
                  title={clickable ? 'Ouvrir cet élément dans sa table d’origine' : undefined}
                  className={`flex min-w-0 flex-1 items-start justify-between gap-2 px-2 py-1.5 text-left transition-colors ${
                    clickable ? 'cursor-pointer hover:bg-blue-50' : 'cursor-default'
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block text-xs font-bold text-slate-700 truncate">{it.title}</span>
                    {it.meta ? <span className="block text-[10px] text-slate-400 truncate">{it.meta}</span> : null}
                  </span>
                  <span className="flex items-center gap-1 shrink-0">
                    <span className="text-xs font-bold text-slate-800 whitespace-nowrap">{it.value}</span>
                    {clickable && <span className="text-[10px] text-blue-500" aria-hidden="true">↗</span>}
                  </span>
                </button>
                {acts.length > 0 && (
                  <span className="flex items-center gap-1 shrink-0 pt-1.5 pr-1">
                    {acts.map((a, k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => a.onClick()}
                        title={a.title}
                        className={`text-[10px] font-black px-1.5 py-0.5 rounded-md border whitespace-nowrap transition-colors ${
                          a.tone || 'border-slate-200 text-slate-400 hover:bg-red-50 hover:text-red-600 hover:border-red-200'
                        }`}
                      >
                        {a.label}
                      </button>
                    ))}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

/* Cellule « Solde » : le calcul complet apparaît au survol de la case (montant
   ou ⓘ) — liste des composantes déduites :
   Solde = dispo université − Achats (BC signé) − prestations internes − OM
   payés − rémunérations de stage − remboursements. */
const SoldeCell = ({ agg }) => {
  const negative = agg.solde < 0;
  const rows = [
    { key: 'dispo', label: 'Dispo université', value: agg.budgetRendu, sign: '+' },
    { key: 'ordonnee', label: 'Achats (BC signé)', value: agg.ordonneeTotal, sign: '−' },
    { key: 'pi', label: 'Prestations internes', value: agg.piTotal, sign: '−' },
    { key: 'omPay', label: 'OM payés', value: agg.omPaidTotal, sign: '−' },
    { key: 'stages', label: 'Rémunération stages', value: agg.stageTotal, sign: '−' },
    { key: 'remboursements', label: 'Remboursements', value: agg.reimbTotal, sign: '−' },
  ];
  return (
    <div className="group relative inline-block text-right">
      <span className={`font-black cursor-help whitespace-nowrap ${negative ? 'text-red-600' : 'text-emerald-700'}`}>
        {euro.format(agg.solde)}
        <span className="ml-1 text-[11px] text-slate-300 group-hover:text-blue-500 align-middle" aria-hidden="true">ⓘ</span>
      </span>
      <div
        className="hidden group-hover:block absolute right-0 top-full mt-1 z-30 w-80 bg-white border border-slate-200 rounded-xl shadow-2xl p-2"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-2 pt-1 pb-1.5 text-[10px] font-black uppercase tracking-wide text-slate-400 border-b border-slate-100">
          Détail du solde
        </div>
        {rows.map((it) => (
          <div key={it.key} className="flex items-baseline justify-between gap-3 px-2 py-1">
            <span className="text-[11px] text-slate-600">{it.label}</span>
            <span className={`text-xs font-bold whitespace-nowrap ${it.sign === '+' ? 'text-blue-700' : 'text-slate-800'}`}>
              {it.sign === '+' ? '' : '− '}{euro.format(it.value)}
            </span>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-3 px-2 py-1.5 mt-1 border-t border-slate-200">
          <span className="text-xs font-black text-slate-700">Solde</span>
          <span className={`text-sm font-black whitespace-nowrap ${negative ? 'text-red-600' : 'text-emerald-700'}`}>{euro.format(agg.solde)}</span>
        </div>
      </div>
    </div>
  );
};

/* Cellule « Solde prévu » (colonne située après « Solde ») : projection du
   solde si les prévisions de la ligne se concrétisent.
   Solde prévu = Solde − OM prévus (acceptés encore à payer) − achats prévus
   (approuvés) − Devis en signature/signé − OM en signature/signé (montants
   dont les documents sont déjà transmis pour signature — dépenses imminentes). */
const SoldePrevuCell = ({ agg }) => {
  const negative = agg.soldePrevu < 0;
  const rows = [
    { key: 'solde', label: 'Solde actuel', value: agg.solde, sign: '+' },
    { key: 'omPrevu', label: 'OM prévus (à payer)', value: agg.omPrevuEnCours, sign: '−' },
    { key: 'desPrevu', label: 'Achats prévus (approuvés)', value: agg.desMontant, sign: '−' },
    { key: 'desSign', label: 'Devis en signature/signé', value: agg.desEnSignatureTotal, sign: '−' },
    { key: 'omSign', label: 'OM en signature/signé', value: agg.omEnSignatureTotal, sign: '−' },
  ];
  return (
    <div className="group relative inline-block text-right">
      <span className={`font-black cursor-help whitespace-nowrap ${negative ? 'text-red-600' : 'text-indigo-700'}`}>
        {euro.format(agg.soldePrevu)}
        <span className="ml-1 text-[11px] text-slate-300 group-hover:text-blue-500 align-middle" aria-hidden="true">ⓘ</span>
      </span>
      <div
        className="hidden group-hover:block absolute right-0 top-full mt-1 z-30 w-80 bg-white border border-slate-200 rounded-xl shadow-2xl p-2"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-2 pt-1 pb-1.5 text-[10px] font-black uppercase tracking-wide text-slate-400 border-b border-slate-100">
          Détail du solde prévu
        </div>
        {rows.map((it) => (
          <div key={it.key} className="flex items-baseline justify-between gap-3 px-2 py-1">
            <span className="text-[11px] text-slate-600">{it.label}</span>
            <span className={`text-xs font-bold whitespace-nowrap ${it.sign === '+' ? 'text-blue-700' : 'text-slate-800'}`}>
              {it.sign === '+' ? '' : '− '}{euro.format(it.value)}
            </span>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-3 px-2 py-1.5 mt-1 border-t border-slate-200">
          <span className="text-xs font-black text-slate-700">Solde prévu</span>
          <span className={`text-sm font-black whitespace-nowrap ${negative ? 'text-red-600' : 'text-indigo-700'}`}>{euro.format(agg.soldePrevu)}</span>
        </div>
      </div>
    </div>
  );
};

/* ── Fenêtre modale : création / édition d’une ligne budgétaire ─────────── */
export const LineModal = ({ modal, types, personnel, depenses, om, desiderate, onCancel, onSave }) => {
  const editing = modal.mode === 'edit';
  const [draft, setDraft] = useState(() => {
    if (editing && modal.rec) {
      const r = modal.rec;
      return {
        ligne: r.ligne || '',
        type: r.type || '',
        porteur: r.porteur || '',
        budgetTotal: r.budgetTotal === null || r.budgetTotal === undefined ? '' : String(r.budgetTotal),
        budgetRenduDispo: r.budgetRenduDispo === null || r.budgetRenduDispo === undefined ? '' : String(r.budgetRenduDispo),
        dateDebut: r.dateDebut || '',
        dateFin: r.dateFin || '',
        dateFinEngagement: r.dateFinEngagement || '',
        notes: r.notes || '',
      };
    }
    return { ligne: '', type: '', porteur: '', budgetTotal: '', budgetRenduDispo: '', dateDebut: '', dateFin: '', dateFinEngagement: '', notes: '' };
  });
  const set = (k) => (ev) => setDraft((d) => ({ ...d, [k]: ev.target.value }));
  const persons = [...new Set((personnel || []).map((p) => p.nom).filter(Boolean))];

  if (modal.mode === 'link') {
    return <LinkLineModal modal={modal} depenses={depenses} om={om} desiderate={desiderate} onCancel={onCancel} />;
  }

  const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500';
  const labelCls = 'block text-[10px] font-black uppercase text-slate-400 tracking-wide mb-1';
  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(3px)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden max-h-[92vh] flex flex-col">
        <div className="px-6 py-4 bg-gradient-to-br from-blue-600 to-indigo-700 text-white">
          <h2 className="text-lg font-black">{editing ? 'Modifier la ligne budgétaire' : 'Nouvelle ligne budgétaire'}</h2>
          <p className="text-blue-100 text-xs">Le solde est recalculé automatiquement : dispo université − dépenses ordonnées (BC signés) − prestations internes − OM payés − rémunérations de stage − remboursements.</p>
        </div>
        <div className="p-6 overflow-y-auto custom-scrollbar grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className={labelCls}>Intitulé / projet de la ligne</label>
            <input className={inputCls} value={draft.ligne} onChange={set('ligne')} placeholder="ex. ANR — Chimie bioinorganique" />
          </div>
          <div>
            <label className={labelCls}>Type</label>
            <select className={inputCls} value={draft.type} onChange={set('type')}>
              {/* « Salaire » est toujours proposé : c’est la nature des lignes de
                  rémunération (affichées dans l’onglet « Salaires »). On garde
                  aussi la valeur existante (« Autres » des anciennes bases…). */}
              {Array.from(new Set([...(types || []), 'Salaire', draft.type].filter(Boolean))).map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Porteur du projet</label>
            <input className={inputCls} list="recette-porteurs" value={draft.porteur} onChange={set('porteur')} placeholder="choisir ou saisir" />
            <datalist id="recette-porteurs">
              {persons.map((n) => <option key={n} value={n} />)}
            </datalist>
          </div>
          <div>
            <label className={labelCls}>Budget total (€)</label>
            <input className={inputCls} type="number" min="0" step="0.01" value={draft.budgetTotal} onChange={set('budgetTotal')} placeholder="0,00" />
          </div>
          <div>
            <label className={labelCls}>Mis à disposition par l’université (€)</label>
            <input className={inputCls} type="number" min="0" step="0.01" value={draft.budgetRenduDispo} onChange={set('budgetRenduDispo')} placeholder="vide = budget total" />
          </div>
          <div>
            <label className={labelCls}>Date de début</label>
            <input className={inputCls} type="date" value={draft.dateDebut} onChange={set('dateDebut')} />
          </div>
          <div>
            <label className={labelCls}>Date de fin</label>
            <input className={inputCls} type="date" value={draft.dateFin} onChange={set('dateFin')} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>Date de fin d’engagement</label>
            <input className={inputCls} type="date" value={draft.dateFinEngagement} onChange={set('dateFinEngagement')} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>Commentaires</label>
            <textarea className={`${inputCls} min-h-[70px]`} value={draft.notes} onChange={set('notes')} placeholder="Financeur, numéro de projet, échéances…" />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2 bg-slate-50">
          <button onClick={onCancel} className="px-4 py-2 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-200 bg-slate-100">Annuler</button>
          <button onClick={() => onSave(draft, editing ? modal.rec.id : undefined)}
            className="px-5 py-2 rounded-xl text-sm font-bold text-white bg-blue-600 hover:bg-blue-700">Enregistrer la ligne</button>
        </div>
      </div>
    </div>
  );
};
/* ── Fenêtre modale : lier des éléments existants à la ligne ────────────── */
const LinkLineModal = ({ modal, depenses, om, desiderate, onCancel }) => {
  const { updateMany } = useAdmin();
  const recId = modal.rec && modal.rec.id;
  const [checked, setChecked] = useState(() => {
    const set = new Set();
    (depenses || []).forEach((d) => { if (d.recetteId === recId) set.add(`depenses:${d.id}`); });
    (om || []).forEach((o) => { if (o.recetteId === recId) set.add(`om:${o.id}`); });
    (desiderate || []).forEach((x) => { if (x.recetteSuggereeId === recId) set.add(`desiderate:${x.id}`); });
    return set;
  });

  const toggle = (key) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  /* Liaisons en UNE écriture par collection (`updateMany`) : une boucle
     d’`upsert` repartirait de l’instantané d’origine à chaque appel et seul
     le dernier correctif survivrait (état React). */
  const applyLink = () => {
    const nowSelected = (kind, id) => checked.has(`${kind}:${id}`);
    const linkChanges = (kind, items, recIdKey) => (items || [])
      .filter((it) => nowSelected(kind, it.id) !== (it[recIdKey] === recId))
      .map((it) => {
        const target = nowSelected(kind, it.id);
        return { id: it.id, patch: { [recIdKey]: target ? recId : null } };
      });
    const depChanges = linkChanges('depenses', depenses, 'recetteId');
    const omChanges = linkChanges('om', om, 'recetteId');
    const desChanges = linkChanges('desiderate', desiderate, 'recetteSuggereeId');
    if (depChanges.length) updateMany('depenses', depChanges);
    if (omChanges.length) updateMany('om', omChanges);
    if (desChanges.length) updateMany('desiderate', desChanges);
    onCancel();
  };

  const group = (title, icon, items, sub) => (
    <div className="rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-[11px] font-black uppercase tracking-wide text-slate-500 flex items-center gap-2">
        <span>{icon}</span>{title}
        <span className="ml-auto text-slate-400">{(items || []).length}</span>
      </div>
      <div className="max-h-44 overflow-y-auto custom-scrollbar">
        {(items || []).length === 0 ? (
          <p className="text-[11px] text-slate-400 px-3 py-2">{sub || 'Aucun élément.'}</p>
        ) : items.map((it) => (
          <label key={it.id} className="flex items-start gap-2 px-3 py-2 border-b border-slate-100 last:border-0 cursor-pointer hover:bg-blue-50/50">
            <input
              type="checkbox"
              checked={checked.has(`${title === 'Dépenses (BC · PI · OM)' ? 'depenses' : title === 'OM prévus / souhaités' ? 'om' : 'desiderate'}:${it.id}`)}
              onChange={() => toggle(`${title === 'Dépenses (BC · PI · OM)' ? 'depenses' : title === 'OM prévus / souhaités' ? 'om' : 'desiderate'}:${it.id}`)}
              className="mt-0.5 accent-blue-600"
            />
            <span className="min-w-0">
              <span className="block text-xs font-bold text-slate-700 truncate">{it.description || it.destination || it.ligne || it.id}</span>
              <span className="block text-[10px] text-slate-400 truncate">
                {title === 'Dépenses (BC · PI · OM)' ? `${it.demandeur || ''} · ${it.bcNo || 'sans BC'}` : title === 'OM prévus / souhaités' ? `${it.destination || ''} · ${it.statut || 'En attente'}` : `${it.demandeur || ''} · ${desiderataDecisionOf(it.statut) || 'En attente'}`}
              </span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(3px)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden max-h-[92vh] flex flex-col">
        <div className="px-6 py-4 bg-gradient-to-br from-blue-600 to-indigo-700 text-white">
          <h2 className="text-lg font-black">Lier des éléments à la ligne</h2>
          <p className="text-blue-100 text-xs">Ligne : « {modal.rec.ligne || modal.rec.id} » — cochez les Dépenses (BC · PI · OM), les OM prévus / souhaités ou les achats prévus / souhaités imputés sur ce budget.</p>
        </div>
        <div className="p-5 overflow-y-auto custom-scrollbar flex flex-col gap-3">
          {group('Dépenses (BC · PI · OM)', '🧾', depenses)}
          {group('OM prévus / souhaités', '✈️', om)}
          {group('Achats prévus / souhaités', '🛒', desiderate)}
        </div>
        <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2 bg-slate-50">
          <button onClick={onCancel} className="px-4 py-2 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-200 bg-slate-100">Fermer</button>
          <button onClick={applyLink} className="px-5 py-2 rounded-xl text-sm font-bold text-white bg-blue-600 hover:bg-blue-700">Enregistrer les liaisons</button>
        </div>
      </div>
    </div>
  );
};





