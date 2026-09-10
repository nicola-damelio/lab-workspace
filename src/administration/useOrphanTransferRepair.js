/* =========================================================================
   src/administration/useOrphanTransferRepair.js
   Réparation AUTOMATIQUE des transferts « orphelins ».

   Une OM « Acceptée » (ou un achat prévu / souhaité « Approuvé ») transférée
   porte la marque `transfert` et disparaît de sa page (elle est suivie dans
   les colonnes « OM en signature / signé » et « Devis en signature / signé »
   de la page Recettes). Si TOUTES ses cibles ont ensuite été supprimées — le
   devis / BC déposé (son origine) et la dépense liée, ainsi qu'une éventuelle
   fiche Remboursement — la demande restait « transférée » sans plus rien qui
   la relie à « Approbation devis & BC » : elle était masquée de sa propre
   liste (donc impossible à supprimer ou à re-transférer) tout en restant
   comptée comme prévision sur la page Recettes.

   Le hook détecte ces transferts obsolètes (voir demandeTransferOrphaned()
   dans ./transferAchats.js) et retire le drapeau `transfert` : la demande
   redevient ordinaire (visible, supprimable, transférable à nouveau). Il est
   idempotent — une empreinte du jeu de données évite de reparcourir en boucle
   ce qui vient d'être réparé.
   ========================================================================= */
import { useEffect, useRef } from 'react';
import { useAdmin } from './AdminContext';
import { demandeTransferOrphaned } from './transferAchats';

export const useOrphanTransferRepair = () => {
  const { data, updateMany } = useAdmin();
  const checkedSig = useRef('');

  useEffect(() => {
    const om = Array.isArray(data.om) ? data.om : [];
    const desiderate = Array.isArray(data.desiderate) ? data.desiderate : [];
    const devisBc = Array.isArray(data.devisBc) ? data.devisBc : [];
    const depenses = Array.isArray(data.depenses) ? data.depenses : [];
    const reimb = Array.isArray(data.reimbursements) ? data.reimbursements : [];

    /* Empreinte pertinente : si rien ne change sur les liens de transfert,
       inutile de reparcourir (le correctif change l'empreinte → un second
       passage confirme la cohérence puis s'arrête). */
    const sig = JSON.stringify([
      om.map((o) => [o.id, !!o.transfert]),
      desiderate.map((d) => [d.id, !!d.transfert]),
      devisBc.map((d) => [d.id, d.sourceKind, d.sourceId, d.statut]),
      depenses.map((d) => [d.id, d.omId, d.desiderataId]),
      reimb.map((r) => [r.id, r.sourceKind, r.sourceId]),
    ]);
    if (sig === checkedSig.current) return;
    checkedSig.current = sig;

    /* Deux écritures GROUPÉES (une par collection) : boucler sur `upsert`
       repartirait de l'instantané d'origine et seul le dernier correctif
       survivrait (état React). */
    const omFixes = om
      .filter((o) => o && o.id && demandeTransferOrphaned(o, 'om', devisBc, depenses, reimb))
      .map((o) => ({ id: o.id, patch: { transfert: null } }));
    const desFixes = desiderate
      .filter((d) => d && d.id && demandeTransferOrphaned(d, 'desiderate', devisBc, depenses, reimb))
      .map((d) => ({ id: d.id, patch: { transfert: null } }));
    if (omFixes.length) updateMany('om', omFixes);
    if (desFixes.length) updateMany('desiderate', desFixes);
  }, [data.om, data.desiderate, data.devisBc, data.depenses, data.reimbursements, updateMany]);
};
