/* =========================================================================
   src/administration/recettesPage.jsx
   Page « Recettes » — lignes budgétaires.
   Chaque ligne : type Fonctionnement / Investissement, porteur, budget total,
   montant mis à disposition par l’université, dépenses déjà ordonnées
   (BC signés), ordres de mission (acceptés / à prévoir), souhaits d’achat
   liés, solde calculé, date de fin d’engagement et commentaires.
   Les agrégats sont calculés depuis les collections depenses / om /
   desiderate de la même base (liaison par recetteId / recetteSuggereeId).
   ========================================================================= */
import React, { useMemo, useState } from 'react';
import { useAdmin } from './AdminContext';
import { RECETTE_TYPES, DEPENSE_BC_SIGNE, depenseKindOf, isDesiderataRejected, isDesiderataApproved, desiderataDecisionOf } from './adminSchema';
import { AdminImportModal } from './adminImportModal';
import { SmartTable } from './smartTable';
import { useDepenseLinkRepair } from './useDepenseLinkRepair';

const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const asDate = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 10) : '');

const txt = (v) => String(v ?? '').trim();
/* « Lignes salaires » : lignes budgétaires importées avec la catégorie « Autres »
   de la feuille « Lignes budgétaires » (enveloppes de rémunération du personnel).
   Elles sont affichées dans l’onglet « Salaires » de la page, séparées des lignes
   Fonctionnement / Investissement. */
const isSalaireType = (r) => String((r && r.type) || '').trim().toLowerCase() === 'autres';
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

export const RecettesPage = () => {
  const { data, settings, upsert, remove } = useAdmin();
  const recettes = useMemo(() => (Array.isArray(data.recettes) ? data.recettes : []), [data.recettes]);
  const depenses = useMemo(() => (Array.isArray(data.depenses) ? data.depenses : []), [data.depenses]);
  const om = useMemo(() => (Array.isArray(data.om) ? data.om : []), [data.om]);
  const desiderate = useMemo(() => (Array.isArray(data.desiderate) ? data.desiderate : []), [data.desiderate]);
  const personnel = useMemo(() => (Array.isArray(data.personnel) ? data.personnel : []), [data.personnel]);

  const [modal, setModal] = useState(null);
  const [importOpen, setImportOpen] = useState(false); // {mode:'new'} | {mode:'edit', rec} | {mode:'link', rec}
  const [tab, setTab] = useState('budgets'); // 'budgets' : Fonctionnement / Investissement · 'salaires' : type « Autres »

  /* Réattribution automatique des dépenses dont la « Catégorie » contredit le
     type de la ligne imputée (ex. dépense « Fonctionnement » liée à une fiche
     « Investissement ») — trace ajoutée dans les commentaires de la dépense. */
  const linkRepair = useDepenseLinkRepair();

  const types = Array.isArray(settings.recetteTypes) && settings.recetteTypes.length
    ? settings.recetteTypes
    : RECETTE_TYPES;

  /* Répartition de l’onglet actif : « Lignes budgétaires » (Fonctionnement /
     Investissement) d’un côté, « Salaires » (type « Autres ») de l’autre. */
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
       OM payés + rémunérations de stage) :
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
         précédentes afin de n’être comptées qu’ici.
       Les OM « prévus / souhaités » (collection om) restent INFORMATIFS : ils
       ne réduisent le solde que lorsqu’ils ont été transférés en dépense OM. */
    const lineDepenses = depenses.filter((d) => d.recetteId === recId);
    const ordonneeRows = lineDepenses.filter((d) => depenseKindOf(d) === 'achat' && !isStageDepense(d) && isAchatBcSigne(d));
    const ordonneeTotal = ordonneeRows.reduce((s, d) => s + toNum(d.montant) + toNum(d.fraisPort), 0);
    /* Colonne « Prestations internes » : même liste que l’onglet PI de la page
       Dépenses (type « pi », fournisseur « PI ») imputée sur cette ligne. */
    const piRows = lineDepenses.filter((d) => depenseKindOf(d) === 'pi' && !isStageDepense(d) && notRejected(d));
    const piTotal = piRows.reduce((s, d) => s + toNum(d.montant) + toNum(d.fraisPort), 0);
    /* Colonne « OM payés » : même liste que l’onglet OM de la page Dépenses
       (type « om », créée depuis « OM prévus / souhaités » → → Dépenses). */
    const omPaidRows = lineDepenses.filter((d) => depenseKindOf(d) === 'om' && !isStageDepense(d) && notRejected(d));
    const omPaidTotal = omPaidRows.reduce((s, d) => s + toNum(d.montant) + toNum(d.fraisPort), 0);
    /* Colonne « Rémunération stages » : mêmes lignes que l’onglet du même nom
       de la page Dépenses (classification / nature « Stages »), toutes familles
       confondues, imputées sur cette ligne — elles sont donc exclues des
       colonnes « Achats (BC signé) » / « Prestations internes » / « OM payés ». */
    const stageRows = lineDepenses.filter((d) => isStageDepense(d) && notRejected(d));
    const stageTotal = stageRows.reduce((s, d) => s + toNum(d.montant) + toNum(d.fraisPort), 0);
    /* « OM prévus » : seuls les OM approuvés (« Acceptée ») entrent dans la
       somme — les autres (En attente, Terminée…) restent visibles au survol
       mais ne sont pas inclus (souhaités non inclus dans la somme). */
    const lineOm = om.filter((o) => o.recetteId === recId && String(o.statut || 'En attente').trim() !== 'Refusée');
    const omApprouves = lineOm.filter((o) => isOmApproved(o.statut));
    const omTotal = omApprouves.reduce((s, o) => s + toNum(o.coutTotal), 0);
    const lineDes = desiderate.filter((d) => d.recetteSuggereeId === recId && !isDesiderataRejected(d.statut));
    const desApprouvees = lineDes.filter((d) => isDesiderataApproved(d.statut));
    const desMontant = desApprouvees.reduce((s, d) => s + toNum(d.montantEstime), 0);
    const budgetRendu = rec.budgetRenduDispo !== undefined && rec.budgetRenduDispo !== null && rec.budgetRenduDispo !== ''
      ? toNum(rec.budgetRenduDispo)
      : toNum(rec.budgetTotal);
    // Solde = dispo université − Achats (BC signé) − prestations internes − OM payés − rémunérations de stage (jamais les souhaits / OM prévus).
    const solde = budgetRendu - ordonneeTotal - piTotal - omPaidTotal - stageTotal;
    /* « OM prévus encore à payer » : OM acceptés qui n’ont pas encore été
       transférés en dépense OM (transfert → Dépenses › OM). Un OM transféré a
       déjà déduit son montant du solde via « OM payés » — le déduire à nouveau
       le compterait deux fois (repère : `depenseId` posé sur l’OM au transfert,
       et pour les anciens transferts, la dépense qui porte `omId`). */
    const omPaidIds = new Set(omPaidRows.map((d) => d.omId).filter(Boolean));
    const omPrevuEnCours = omApprouves
      .filter((o) => !o.depenseId && !omPaidIds.has(o.id))
      .reduce((s, o) => s + toNum(o.coutTotal), 0);
    /* « Solde prévu » = solde − OM prévus (acceptés encore à payer) − achats
       prévus (approuvés) : projection du solde si toutes les prévisions de la
       ligne se concrétisent. */
    const soldePrevu = solde - omPrevuEnCours - desMontant;
    return {
      lineDepenses, ordonneeRows, ordonneeTotal,
      piRows, piTotal, omPaidRows, omPaidTotal, stageRows, stageTotal,
      lineOm, omApprouves,
      omEnAttente: lineOm.filter((o) => String(o.statut || 'En attente').trim() === 'En attente'),
      omTotal, omPrevuEnCours, soldePrevu,
      lineDes, desApprouvees, desMontant,
      budgetRendu, solde,
    };
  };

  const totals = useMemo(() => {
    let budgetTotal = 0; let budgetRendu = 0; let pi = 0; let omPay = 0; let omTot = 0; let des = 0; let solde = 0; let soldePrevu = 0;
    activeRecettes.forEach((r) => {
      const a = aggFor(r);
      budgetTotal += toNum(r.budgetTotal);
      budgetRendu += a.budgetRendu;
      pi += a.piTotal; omPay += a.omPaidTotal; omTot += a.omTotal; des += a.desMontant;
      solde += a.solde;
      soldePrevu += a.soldePrevu;
    });
    return { budgetTotal, budgetRendu, pi, omPay, omTot, des, solde, soldePrevu };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRecettes, depenses, om, desiderate]);

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
      dateFinEngagement: asDate(patch.dateFinEngagement),
      notes: String(patch.notes || ''),
    };
    upsert('recettes', cleaned, existingId);
    setModal(null);
  };

  const onRemoveLine = (rec) => {
    if (window.confirm(`Supprimer la ligne budgétaire « ${rec.ligne || rec.id} » ?`)) remove('recettes', rec.id);
  };

  /* Lignes enrichies des agrégats (tri/filtre sur les colonnes calculées). */
  const recetteRows = useMemo(
    () => activeRecettes.map((rec) => ({ ...rec, __agg: aggFor(rec) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeRecettes, depenses, om, desiderate]
  );

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
        return (
          <span className={`inline-block text-[10px] font-black uppercase px-2 py-0.5 rounded-full border ${
            String(t) === 'Investissement'
              ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
              : 'bg-emerald-50 border-emerald-200 text-emerald-700'
          }`}>
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
          items={r.__agg.ordonneeRows.map((d) => ({
            title: d.description || 'Achat',
            meta: [d.numBC || d.bcNo || d.sifacNo || '', d.statut || d.suivi || ''].filter(Boolean).join(' · '),
            value: euro.format(toNum(d.montant) + toNum(d.fraisPort)),
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
          items={r.__agg.piRows.map((d) => ({
            title: d.description || 'Prestation interne',
            meta: ['PI (prestation interne)', d.dateSignatureBC || d.dateSignature || ''].filter(Boolean).join(' · '),
            value: euro.format(toNum(d.montant) + toNum(d.fraisPort)),
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
          items={r.__agg.omPaidRows.map((d) => ({
            title: d.description || d.destination || 'Dépense OM',
            meta: [d.destination || '', d.omNo || d.bcNo || '', d.statut || d.suivi || ''].filter(Boolean).join(' · '),
            value: euro.format(toNum(d.montant) + toNum(d.fraisPort)),
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
          items={r.__agg.stageRows.map((d) => ({
            title: d.description || 'Rémunération de stage',
            meta: ['Stages', d.numBC || d.numSIFAC || '', d.statut || d.suivi || ''].filter(Boolean).join(' · '),
            value: euro.format(toNum(d.montant) + toNum(d.fraisPort)),
          }))}
        />
      ),
    },
    {
      key: 'om', label: 'OM prévus',
      header: <span title="prévision — n’est PAS déduit du solde : seul l’« OM payé » (dépense transférée) l’est">OM prévus</span>,
      dataType: 'number', align: 'right', nowrap: true,
      value: (r) => Number(r.__agg.omTotal) || 0,
      display: (r) => (
        <HoverCell
          amount={r.__agg.omTotal}
          items={r.__agg.lineOm.map((o) => ({
            title: o.description || o.destination || 'OM',
            meta: [o.destination || '', `${o.statut || 'En attente'}${isOmApproved(o.statut) ? ' · accepté' : ' · non accepté'}`].filter(Boolean).join(' · '),
            value: euro.format(toNum(o.coutTotal)),
          }))}
        />
      ),
    },
    {
      key: 'desiderata', label: 'Achats prévus',
      header: <span title="non déduits du solde — information seule">Achats prévus</span>,
      dataType: 'number', align: 'right', nowrap: true,
      value: (r) => Number(r.__agg.desMontant) || 0,
      display: (r) => (
        <HoverCell
          amount={r.__agg.desMontant}
          items={r.__agg.lineDes.map((d) => ({
            title: d.description || 'Achat prévu / souhaité',
            meta: [d.demandeur || '', desiderataDecisionOf(d.statut)].filter(Boolean).join(' · '),
            value: d.montantEstime !== undefined && d.montantEstime !== null && d.montantEstime !== ''
              ? euro.format(toNum(d.montantEstime))
              : 'non chiffré',
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
      header: <span title="Solde − OM prévus (acceptés encore à payer) − achats prévus (approuvés) — solde restant si toutes les prévisions se concrétisent">Solde prévu</span>,
      dataType: 'number', align: 'right', nowrap: true,
      value: (r) => Number(r.__agg.soldePrevu) || 0,
      display: (r) => <SoldePrevuCell agg={r.__agg} />,
    },
    {
      key: 'finEngagement', label: 'Fin d’engagement', filter: 'text',
      value: (r) => r.dateFinEngagement || '',
      display: (r) => <span className="whitespace-nowrap text-slate-600">{r.dateFinEngagement || '—'}</span>,
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
      {/* Barre d’actions */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-400">
          <span className="inline-block w-2 h-2 rounded-full bg-blue-500" aria-hidden="true"></span>
          Chaque ligne affiche ses montants et les éléments liés — survolez une case pour le détail.
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
          · Salaires (lignes de type « Autres », feuille « Lignes budgétaires »). */}
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
              ? 'Lignes de rémunération du personnel — catégorie « Autres » de la feuille « Lignes budgétaires » (type « Autres » dans la base)'
              : 'Lignes budgétaires de crédits projets — Fonctionnement / Investissement'}
            className={`px-3 py-1.5 rounded-lg text-xs font-black transition-colors ${tab === v.id ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:bg-blue-50 hover:text-blue-700'}`}
          >
            <span className="mr-1.5">{v.icon}</span>{v.label}
            <span className={`ml-1.5 font-mono text-[10px] ${tab === v.id ? 'text-blue-200' : 'text-slate-400'}`}>{v.count}</span>
          </button>
        ))}
      </div>

      {/* Cartes de synthèse (onglet actif) */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2">
        <SummaryCard label="Budget total" value={totals.budgetTotal} tone="slate" />
        <SummaryCard label="Mis à disposition (univ.)" value={totals.budgetRendu} tone="blue" />
        <SummaryCard label="Prestations internes" value={totals.pi} tone="amber" />
        <SummaryCard label="OM payés (Dépenses)" value={totals.omPay} tone="rose" />
        <SummaryCard label="OM prévus (acceptés)" value={totals.omTot} tone="violet" />
        <SummaryCard label="Achats prévus (approuvés)" value={totals.des} tone="teal" />
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
            {tab === 'salaires' ? 'Aucune ligne « salaires » (type « Autres »)' : 'Aucune ligne budgétaire (Fonctionnement / Investissement)'}
          </p>
          <p className="text-sm text-slate-400 mt-1">
            {tab === 'salaires'
              ? 'Les lignes de rémunération du personnel (catégorie « Autres » de la feuille « Lignes budgétaires ») s’afficheront ici.'
              : 'Toutes les lignes sont des lignes « salaires » (type « Autres ») : elles se trouvent dans l’onglet « Salaires » ci-dessus.'}
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
    <div className={`bg-white border rounded-2xl shadow-sm px-3 py-2.5 ${tones[tone] || tones.slate}`}>
      <div className="text-[10px] font-black uppercase tracking-wide opacity-70 leading-tight">{label}</div>
      <div className="text-lg font-black mt-0.5 truncate">{euro.format(value)}</div>
    </div>
  );
};

/* ── Cases à détail au survol ─────────────────────────────────────────────
   Seul le montant est affiché (le détail — liste des éléments liés, n° BC /
   SF, statuts… — n’apparaît qu’au survol, via ⓘ) : les colonnes restent
   étroites et la vue d’ensemble de la table reste lisible. */
const HoverCell = ({ amount, items }) => {
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
        <div className="hidden group-hover:block absolute right-0 top-full mt-1 z-30 w-80 max-h-64 overflow-y-auto custom-scrollbar bg-white border border-slate-200 rounded-xl shadow-2xl p-2">
          {linked.map((it, i) => (
            <div key={i} className="flex items-start justify-between gap-2 px-2 py-1.5 border-b border-slate-100 last:border-0">
              <div className="min-w-0">
                <div className="text-xs font-bold text-slate-700 truncate">{it.title}</div>
                {it.meta ? <div className="text-[10px] text-slate-400 truncate">{it.meta}</div> : null}
              </div>
              <div className="text-xs font-bold text-slate-800 whitespace-nowrap">{it.value}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/* Cellule « Solde » : le calcul complet apparaît au survol de la case (montant
   ou ⓘ) — liste des composantes déduites :
   Solde = dispo université − Achats (BC signé) − prestations internes − OM
   payés − rémunérations de stage. */
const SoldeCell = ({ agg }) => {
  const negative = agg.solde < 0;
  const rows = [
    { key: 'dispo', label: 'Dispo université', value: agg.budgetRendu, sign: '+' },
    { key: 'ordonnee', label: 'Achats (BC signé)', value: agg.ordonneeTotal, sign: '−' },
    { key: 'pi', label: 'Prestations internes', value: agg.piTotal, sign: '−' },
    { key: 'omPay', label: 'OM payés', value: agg.omPaidTotal, sign: '−' },
    { key: 'stages', label: 'Rémunération stages', value: agg.stageTotal, sign: '−' },
  ];
  return (
    <div className="group relative inline-block text-right">
      <span className={`font-black cursor-help whitespace-nowrap ${negative ? 'text-red-600' : 'text-emerald-700'}`}>
        {euro.format(agg.solde)}
        <span className="ml-1 text-[11px] text-slate-300 group-hover:text-blue-500 align-middle" aria-hidden="true">ⓘ</span>
      </span>
      <div className="hidden group-hover:block absolute right-0 top-full mt-1 z-30 w-80 bg-white border border-slate-200 rounded-xl shadow-2xl p-2">
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
   (approuvés). Un OM accepté déjà transféré en dépense OM n’est PAS re-déduit
   ici : sa dépense a déjà retiré le montant du solde via « OM payés ». */
const SoldePrevuCell = ({ agg }) => {
  const negative = agg.soldePrevu < 0;
  const rows = [
    { key: 'solde', label: 'Solde actuel', value: agg.solde, sign: '+' },
    { key: 'omPrevu', label: 'OM prévus (à payer)', value: agg.omPrevuEnCours, sign: '−' },
    { key: 'desPrevu', label: 'Achats prévus (approuvés)', value: agg.desMontant, sign: '−' },
  ];
  return (
    <div className="group relative inline-block text-right">
      <span className={`font-black cursor-help whitespace-nowrap ${negative ? 'text-red-600' : 'text-indigo-700'}`}>
        {euro.format(agg.soldePrevu)}
        <span className="ml-1 text-[11px] text-slate-300 group-hover:text-blue-500 align-middle" aria-hidden="true">ⓘ</span>
      </span>
      <div className="hidden group-hover:block absolute right-0 top-full mt-1 z-30 w-80 bg-white border border-slate-200 rounded-xl shadow-2xl p-2">
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
const LineModal = ({ modal, types, personnel, depenses, om, desiderate, onCancel, onSave }) => {
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
        dateFinEngagement: r.dateFinEngagement || '',
        notes: r.notes || '',
      };
    }
    return { ligne: '', type: '', porteur: '', budgetTotal: '', budgetRenduDispo: '', dateFinEngagement: '', notes: '' };
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
          <p className="text-blue-100 text-xs">Le solde est recalculé automatiquement : dispo université − dépenses ordonnées (BC signés) − prestations internes − OM payés − rémunérations de stage.</p>
        </div>
        <div className="p-6 overflow-y-auto custom-scrollbar grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className={labelCls}>Intitulé / projet de la ligne</label>
            <input className={inputCls} value={draft.ligne} onChange={set('ligne')} placeholder="ex. ANR — Chimie bioinorganique" />
          </div>
          <div>
            <label className={labelCls}>Type</label>
            <select className={inputCls} value={draft.type} onChange={set('type')}>
              {(types || []).map((t) => <option key={t} value={t}>{t}</option>)}
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





