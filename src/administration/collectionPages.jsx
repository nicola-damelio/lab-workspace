/* =========================================================================
   src/administration/collectionPages.jsx
   Pages « listes » des collections d’administration (Dépenses, OM, Spese
   Desiderate, Librerie, Questions ouvertes, Hygiène & Sécurité). Chaque page
   affiche TOUS les enregistrements de la collection sous forme de tableau
   triable/filtrable (composant SmartTable) — les critères couvrent le plus
   de champs possible (demandeur, fournisseur, ligne budgétaire, statuts,
   montants, dates…). Données saisies par l’assistant d’import.
   ========================================================================= */
import React, { useEffect, useState } from 'react';
import { useAdmin } from './AdminContext';
import { SmartTable } from './smartTable';
import { AdminImportModal } from './adminImportModal';
import { ISSUE_STATUSES, URGENCES } from './adminSchema';
import { CollectionAddModal } from './collectionAddModal';

const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const txt = (v) => (v === null || v === undefined ? '' : String(v).trim());
const pick = (rec, keys) => {
  for (const k of keys) {
    const v = rec && rec[k];
    if (txt(v)) return v;
  }
  return '';
};
const euroNum = (v) => (v === null || v === undefined || v === '' ? '—' : euro.format(Number(v)));

/* Résout l’intitulé d’une ligne budgétaire à partir de l’id recette. */
const ligneName = (recettes, idOrNull, raw) => {
  if (idOrNull) {
    const found = recettes.find((r) => r.id === idOrNull);
    if (found && found.ligne) return found.ligne;
  }
  return raw || '';
};

/* ── Petits éléments d’affichage réutilisés par les cellules ─────────────── */
const TONES = {
  slate: 'bg-slate-100 border-slate-200 text-slate-600',
  blue: 'bg-blue-50 border-blue-200 text-blue-700',
  indigo: 'bg-indigo-50 border-indigo-200 text-indigo-700',
  emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  amber: 'bg-amber-50 border-amber-200 text-amber-700',
  red: 'bg-red-50 border-red-200 text-red-600',
  violet: 'bg-violet-50 border-violet-200 text-violet-700',
  teal: 'bg-teal-50 border-teal-200 text-teal-700',
};

const Badge = ({ tone = 'slate', children }) => (
  <span className={`inline-block text-[10px] font-black uppercase px-2 py-0.5 rounded-full border ${TONES[tone] || TONES.slate}`}>
    {children}
  </span>
);

const toneFor = (v) => {
  const s = txt(v).toLowerCase();
  if (/(sign|accept|fait|livr|clos|term|r[eé]gl|ok$|oui|approved|exact)/.test(s)) return 'emerald';
  if (/(refus|reject|pas maintenant|non|annul)/.test(s)) return 'red';
  if (/(attente|pending|devis|sifac|encours|en cours|souhaitable|estime)/.test(s)) return 'amber';
  if (/(urgent|important|a faire|a faire|critique|high)/.test(s)) return 'violet';
  return 'slate';
};

const StatutBadge = ({ value }) =>
  txt(value) ? <Badge tone={toneFor(value)}>{txt(value)}</Badge> : <span className="text-slate-300">—</span>;

const LigneCell = ({ recettes, id, raw }) => {
  const name = ligneName(recettes, id, raw);
  return name
    ? <div className="text-xs font-semibold text-slate-600 max-w-[220px] leading-snug">{name}</div>
    : <span className="text-slate-300">—</span>;
};
/* ── Dépenses / bons de commande ─────────────────────────────────────────── */
const depensesColumns = (recettes) => [
  {
    key: 'description', label: 'Dépense', filter: 'text',
    value: (r) => pick(r, ['description']) || r.ligneBudgetaire || pick(r, ['numSIFAC', 'numBC', 'bcNo', 'sifacNo']) || '',
    display: (r) => {
      const statut = pick(r, ['statut', 'suivi']);
      const ent = pick(r, ['ent']);
      const classification = pick(r, ['classification']);
      return (
        <div className="min-w-[220px]">
          <div className="font-bold text-slate-800 leading-snug line-clamp-2" title={txt(r.description) || txt(r.ligneBudgetaire)}>
            {r.description || r.ligneBudgetaire || pick(r, ['numSIFAC', 'numBC']) || r.id}
          </div>
          {(statut || classification) && (
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              {statut && <StatutBadge value={statut} />}
              {classification && <span className="text-[10px] text-slate-400 font-semibold">{classification}</span>}
            </div>
          )}
          {ent && <div className="text-[10px] text-slate-400 mt-0.5 truncate max-w-[240px]" title={ent}>ENT : {ent}</div>}
        </div>
      );
    },
  },
  {
    key: 'demandeur', label: 'Demandeur',
    value: (r) => pick(r, ['demandeur', 'porteur']),
    display: (r) => {
      const v = pick(r, ['demandeur', 'porteur']);
      return v ? <span className="font-semibold text-slate-700">{v}</span> : <span className="text-slate-300">—</span>;
    },
  },
  {
    key: 'fournisseur', label: 'Fournisseur',
    value: (r) => pick(r, ['fournisseur']),
    display: (r) => {
      const v = pick(r, ['fournisseur']);
      const contact = pick(r, ['contact']);
      return (
        <div className="max-w-[200px]">
          {v ? <div className="text-xs font-bold text-slate-700 leading-snug">{v}</div> : <span className="text-slate-300">—</span>}
          {contact && <div className="text-[10px] text-slate-400 truncate">{contact}</div>}
        </div>
      );
    },
  },
  {
    key: 'ligne', label: 'Ligne budgétaire',
    value: (r) => ligneName(recettes, r.recetteId, r.ligneBudgetaire),
    display: (r) => <LigneCell recettes={recettes} id={r.recetteId} raw={r.ligneBudgetaire} />,
  },
  {
    key: 'categorie', label: 'Catégorie',
    value: (r) => pick(r, ['categorie']),
    display: (r) => {
      const v = pick(r, ['categorie']);
      return v ? <Badge tone={txt(v).toLowerCase() === 'investissement' ? 'indigo' : 'emerald'}>{v}</Badge> : <span className="text-slate-300">—</span>;
    },
  },
  {
    key: 'refs', label: 'N° SIFAC / BC / devis', filter: 'text',
    value: (r) => [pick(r, ['numSIFAC', 'sifacNo']), pick(r, ['numBC', 'bcNo']), pick(r, ['numDevis', 'devisNo'])].filter(Boolean).join(' '),
    display: (r) => {
      const rows = [
        pick(r, ['numSIFAC', 'sifacNo']) && ['SIFAC', pick(r, ['numSIFAC', 'sifacNo'])],
        pick(r, ['numBC', 'bcNo']) && ['BC', pick(r, ['numBC', 'bcNo'])],
        pick(r, ['numDevis', 'devisNo']) && ['Devis', pick(r, ['numDevis', 'devisNo'])],
        pick(r, ['numFacture']) && ['Facture', pick(r, ['numFacture'])],
      ].filter(Boolean);
      return rows.length
        ? <div className="text-[11px] font-mono text-slate-600 leading-snug whitespace-nowrap">{rows.map(([l, v]) => <div key={l}>{l} {v}</div>)}</div>
        : <span className="text-slate-300">—</span>;
    },
  },
  {
    key: 'montant', label: 'Montant (HT + port)', dataType: 'number', align: 'right', nowrap: true,
    value: (r) => {
      const m = Number(r.montant);
      const p = Number(r.fraisPort);
      const tot = (Number.isFinite(m) ? m : 0) + (Number.isFinite(p) ? p : 0);
      return Number.isFinite(m) ? tot : null;
    },
    display: (r) => {
      const m = r.montant;
      const p = r.fraisPort;
      const hasPort = p !== null && p !== undefined && p !== '';
      if (m === null || m === undefined || m === '') return <span className="text-slate-300">—</span>;
      const tot = Number(m) + (hasPort ? Number(p) : 0);
      return (
        <div className="text-right">
          <div className="font-bold text-slate-800 whitespace-nowrap">{euroNum(tot)}</div>
          {hasPort && <div className="text-[10px] text-slate-400 whitespace-nowrap">dont {euroNum(p)} de port</div>}
        </div>
      );
    },
  },
  {
    key: 'dates', label: 'Dates (demande → BC)', filter: 'text',
    value: (r) => [
      pick(r, ['dateDemande']), pick(r, ['dateBC']), pick(r, ['dateSignature']),
      pick(r, ['dateApprobFournisseur', 'dateAcceptationFournisseur']), pick(r, ['dateSignatureBC']),
    ].filter(Boolean).sort().join(' '),
    display: (r) => {
      const rows = [
        pick(r, ['dateDemande']) && ['Demande', pick(r, ['dateDemande'])],
        pick(r, ['dateBC']) && ['BC', pick(r, ['dateBC'])],
        pick(r, ['dateSignatureBC']) && ['Signé', pick(r, ['dateSignatureBC'])],
        pick(r, ['dateSignature']) && ['Signature', pick(r, ['dateSignature'])],
        pick(r, ['dateApprobFournisseur', 'dateAcceptationFournisseur']) && ['Approb.', pick(r, ['dateApprobFournisseur', 'dateAcceptationFournisseur'])],
      ].filter(Boolean);
      return rows.length
        ? <div className="text-[11px] text-slate-500 whitespace-nowrap">{rows.map(([l, d]) => <div key={l}>{l} {d}</div>)}</div>
        : <span className="text-slate-300">—</span>;
    },
  },
  {
    key: 'livraisons', label: 'Livraisons', dataType: 'number', align: 'right', nowrap: true,
    value: (r) => (Array.isArray(r.livraisons) ? r.livraisons.length : 0),
    display: (r) => {
      const n = Array.isArray(r.livraisons) ? r.livraisons.length : 0;
      const last = Array.isArray(r.livraisons)
        ? r.livraisons.map((l) => pick(l, ['dateReception', 'dateArrivee'])).filter(Boolean).sort().pop()
        : '';
      const done = pick(r, ['livraisonComplete']);
      return (
        <div className="text-right">
          <span className="font-bold text-slate-700">{n} phase{n > 1 ? 's' : ''}</span>
          {last && <div className="text-[10px] text-slate-400">arr. {last}</div>}
          {done && txt(done).toLowerCase() !== 'non' && <div className="text-[10px] font-bold text-emerald-600">{done}</div>}
        </div>
      );
    },
  },
  {
    key: 'commentaires', label: 'Commentaires', hidden: true, filter: 'text',
    value: (r) => pick(r, ['commentaires']),
  },
];
/* ── Ordres de mission ────────────────────────────────────────────────────── */
export const omColumns = (recettes) => [
  {
    key: 'description', label: 'Mission', filter: 'text',
    value: (r) => [pick(r, ['description']), pick(r, ['destination', 'ville']), pick(r, ['numOM'])].filter(Boolean).join(' '),
    display: (r) => (
      <div className="min-w-[220px]">
        <div className="font-bold text-slate-800 leading-snug line-clamp-2" title={txt(r.description)}>
          {r.description || r.ligneBudgetaire || r.id}
        </div>
        <div className="text-[10px] text-slate-400 mt-0.5 truncate max-w-[240px]" title={txt(r.destination)}>
          {[r.destination, r.numOM && `OM ${r.numOM}`].filter(Boolean).join(' · ') || '—'}
        </div>
      </div>
    ),
  },
  {
    key: 'demandeur', label: 'Demandeur',
    value: (r) => pick(r, ['demandeur', 'porteur']),
    display: (r) => {
      const v = pick(r, ['demandeur', 'porteur']);
      return v ? <span className="font-semibold text-slate-700">{v}</span> : <span className="text-slate-300">—</span>;
    },
  },
  {
    key: 'statut', label: 'Statut',
    value: (r) => pick(r, ['statut']),
    display: (r) => <StatutBadge value={pick(r, ['statut'])} />,
  },
  {
    key: 'ligne', label: 'Ligne budgétaire',
    value: (r) => ligneName(recettes, r.recetteId, r.ligneBudgetaire),
    display: (r) => <LigneCell recettes={recettes} id={r.recetteId} raw={r.ligneBudgetaire} />,
  },
  {
    key: 'periode', label: 'Période (mission)', filter: 'text',
    value: (r) => [pick(r, ['dateMission', 'dateDebut']), pick(r, ['dateRetour'])].filter(Boolean).join(' '),
    display: (r) => {
      const depart = pick(r, ['dateMission', 'dateDebut']);
      const retour = pick(r, ['dateRetour']);
      return (
        <div className="text-[11px] text-slate-500 whitespace-nowrap">
          {depart && <div>Départ {depart}</div>}
          {retour && <div className="text-slate-400">Retour {retour}</div>}
          {!depart && !retour && <span className="text-slate-300">—</span>}
        </div>
      );
    },
  },
  {
    key: 'coutTotal', label: 'Coût total', dataType: 'number', align: 'right', nowrap: true,
    value: (r) => {
      const n = Number(r.coutTotal);
      return Number.isFinite(n) ? n : null;
    },
    display: (r) => {
      const parts = [
        pick(r, ['coutVoyage', 'voyage']) && `Trajet ${euroNum(pick(r, ['coutVoyage', 'voyage']))}`,
        pick(r, ['coutLogement', 'logement']) && `Logt ${euroNum(pick(r, ['coutLogement', 'logement']))}`,
        pick(r, ['coutRepas', 'repas']) && `Repas ${euroNum(pick(r, ['coutRepas', 'repas']))}`,
        pick(r, ['coutInscription', 'inscription']) && `Inscr. ${euroNum(pick(r, ['coutInscription', 'inscription']))}`,
      ].filter(Boolean);
      return (
        <div className="text-right">
          <div className="font-bold text-slate-800 whitespace-nowrap">{euroNum(r.coutTotal)}</div>
          {parts.length > 0 && <div className="text-[10px] text-slate-400 whitespace-nowrap">{parts.slice(0, 2).join(' · ')}</div>}
          {parts.length > 2 && <div className="text-[10px] text-slate-400 whitespace-nowrap">{parts.slice(2).join(' · ')}</div>}
        </div>
      );
    },
  },
  {
    key: 'coutStatut', label: 'Coût (estimé / exact)',
    value: (r) => pick(r, ['coutStatut']),
    display: (r) => {
      const v = pick(r, ['coutStatut']);
      return v ? <Badge tone={txt(v).toLowerCase() === 'exact' ? 'emerald' : 'amber'}>{v}</Badge> : <span className="text-slate-300">—</span>;
    },
  },
  {
    key: 'demande', label: 'Date de demande', filter: 'text',
    value: (r) => pick(r, ['dateDemande']),
    display: (r) => (pick(r, ['dateDemande']) ? <span className="text-xs text-slate-600 whitespace-nowrap">{pick(r, ['dateDemande'])}</span> : <span className="text-slate-300">—</span>),
  },
  {
    key: 'commentaires', label: 'Commentaires', hidden: true, filter: 'text',
    value: (r) => pick(r, ['commentaires']),
  },
];
/* ── Spese Desiderate (souhaits d’achat) ──────────────────────────────────── */
const desiderateColumns = (recettes) => [
  {
    key: 'description', label: 'Souhait d’achat', filter: 'text',
    value: (r) => [pick(r, ['description']), pick(r, ['codeProduit']), pick(r, ['numDevis', 'devisNo'])].filter(Boolean).join(' '),
    display: (r) => (
      <div className="min-w-[220px]">
        <div className="font-bold text-slate-800 leading-snug line-clamp-2" title={txt(r.description)}>
          {r.description || r.id}
        </div>
        <div className="mt-1"><StatutBadge value={pick(r, ['statut'])} /></div>
      </div>
    ),
  },
  {
    key: 'priorite', label: 'Urgence',
    value: (r) => pick(r, ['priorite', 'urgence']),
    display: (r) => {
      const v = pick(r, ['priorite', 'urgence']);
      return v ? <Badge tone={toneFor(v)}>{v}</Badge> : <span className="text-slate-300">—</span>;
    },
  },
  {
    key: 'demandeur', label: 'Demandeur',
    value: (r) => pick(r, ['demandeur', 'porteur']),
    display: (r) => {
      const v = pick(r, ['demandeur', 'porteur']);
      return v ? <span className="font-semibold text-slate-700">{v}</span> : <span className="text-slate-300">—</span>;
    },
  },
  {
    key: 'fournisseur', label: 'Fournisseur',
    value: (r) => pick(r, ['fournisseur']),
    display: (r) => {
      const v = pick(r, ['fournisseur']);
      const contact = pick(r, ['contact']);
      return (
        <div className="max-w-[200px]">
          {v ? <div className="text-xs font-bold text-slate-700 leading-snug">{v}</div> : <span className="text-slate-300">—</span>}
          {contact && <div className="text-[10px] text-slate-400 truncate">{contact}</div>}
        </div>
      );
    },
  },
  {
    key: 'ligne', label: 'Ligne budgétaire suggérée',
    value: (r) => ligneName(recettes, r.recetteSuggereeId, r.ligneBudgetaire),
    display: (r) => <LigneCell recettes={recettes} id={r.recetteSuggereeId} raw={r.ligneBudgetaire} />,
  },
  {
    key: 'categorie', label: 'Catégorie',
    value: (r) => pick(r, ['categorie']),
    display: (r) => {
      const v = pick(r, ['categorie']);
      return v ? <Badge tone={txt(v).toLowerCase() === 'investissement' ? 'indigo' : 'emerald'}>{v}</Badge> : <span className="text-slate-300">—</span>;
    },
  },
  {
    key: 'montant', label: 'Montant estimé', dataType: 'number', align: 'right', nowrap: true,
    value: (r) => {
      const n = Number(r.montantEstime);
      return Number.isFinite(n) ? n : null;
    },
    display: (r) => {
      const hasPort = r.fraisPort !== null && r.fraisPort !== undefined && r.fraisPort !== '';
      if (r.montantEstime === null || r.montantEstime === undefined || r.montantEstime === '') {
        return <span className="text-slate-300">non chiffré</span>;
      }
      return (
        <div className="text-right">
          <div className="font-bold text-slate-800 whitespace-nowrap">{euroNum(r.montantEstime)}</div>
          {hasPort && <div className="text-[10px] text-slate-400 whitespace-nowrap">+ {euroNum(r.fraisPort)} de port</div>}
        </div>
      );
    },
  },
  {
    key: 'code', label: 'Code produit / devis', filter: 'text',
    value: (r) => [pick(r, ['codeProduit']), pick(r, ['numDevis', 'devisNo']), pick(r, ['devis2']), pick(r, ['devis3'])].filter(Boolean).join(' '),
    display: (r) => {
      const rows = [
        pick(r, ['codeProduit']) && ['Code', pick(r, ['codeProduit'])],
        pick(r, ['numDevis', 'devisNo']) && ['Devis', pick(r, ['numDevis', 'devisNo'])],
        pick(r, ['devis2']) && ['Devis 2', pick(r, ['devis2'])],
        pick(r, ['devis3']) && ['Devis 3', pick(r, ['devis3'])],
      ].filter(Boolean);
      return rows.length
        ? <div className="text-[11px] font-mono text-slate-600 whitespace-nowrap">{rows.map(([l, v]) => <div key={l}>{l} {v}</div>)}</div>
        : <span className="text-slate-300">—</span>;
    },
  },
  {
    key: 'dateDemande', label: 'Date de demande', filter: 'text',
    value: (r) => pick(r, ['dateDemande']),
    display: (r) => (pick(r, ['dateDemande']) ? <span className="text-xs text-slate-600 whitespace-nowrap">{pick(r, ['dateDemande'])}</span> : <span className="text-slate-300">—</span>),
  },
  {
    key: 'commentaires', label: 'Commentaires', hidden: true, filter: 'text',
    value: (r) => pick(r, ['commentaires']),
  },
];
/* ── Questions ouvertes ───────────────────────────────────────────────────── */
const questioniColumns = () => [
  {
    key: 'description', label: 'Question ouverte', filter: 'text',
    value: (r) => pick(r, ['description', 'question']),
    display: (r) => (
      <div className="min-w-[260px]">
        <div className="font-bold text-slate-800 leading-snug" title={txt(r.description)}>{r.description || r.question || r.id}</div>
      </div>
    ),
  },
  {
    key: 'statut', label: 'Statut',
    value: (r) => pick(r, ['statut']),
    display: (r) => <StatutBadge value={pick(r, ['statut'])} />,
  },
  {
    key: 'responsable', label: 'Responsable',
    value: (r) => pick(r, ['responsable']),
    display: (r) => (pick(r, ['responsable']) ? <span className="font-semibold text-slate-700">{pick(r, ['responsable'])}</span> : <span className="text-slate-300">—</span>),
  },
  {
    key: 'tags', label: 'Tags', filter: 'text',
    value: (r) => (Array.isArray(r.tags) ? r.tags.join(' ') : pick(r, ['tags', 'tags/classification', 'classification'])),
    display: (r) => {
      const tags = Array.isArray(r.tags) ? r.tags : txt(pick(r, ['tags', 'classification'])).split(/[,;]+/).map((s) => s.trim()).filter(Boolean);
      return tags.length
        ? <div className="flex flex-wrap gap-1 max-w-[220px]">{tags.map((t) => <span key={t} className="bg-slate-100 border border-slate-200 text-slate-500 rounded-md px-1.5 py-0.5 text-[10px] font-semibold">{t}</span>)}</div>
        : <span className="text-slate-300">—</span>;
    },
  },
  {
    key: 'commentaires', label: 'Notes', filter: 'text', hidden: true,
    value: (r) => pick(r, ['commentaires', 'note', 'notes']),
  },
];

/* ── Hygiène & sécurité ───────────────────────────────────────────────────── */
const sicurezzaColumns = () => [
  {
    key: 'description', label: 'Tâche H&S', filter: 'text',
    value: (r) => pick(r, ['description', 'question']),
    display: (r) => (
      <div className="min-w-[260px]">
        <div className="font-bold text-slate-800 leading-snug" title={txt(r.description)}>{r.description || r.question || r.id}</div>
        <div className="mt-1"><StatutBadge value={pick(r, ['statut'])} /></div>
      </div>
    ),
  },
  {
    key: 'priorite', label: 'Priorité',
    value: (r) => pick(r, ['priorite', 'urgence']),
    display: (r) => {
      const v = pick(r, ['priorite', 'urgence']);
      return v ? <Badge tone={toneFor(v)}>{v}</Badge> : <span className="text-slate-300">—</span>;
    },
  },
  {
    key: 'responsable', label: 'Responsable',
    value: (r) => pick(r, ['responsable']),
    display: (r) => (pick(r, ['responsable']) ? <span className="font-semibold text-slate-700">{pick(r, ['responsable'])}</span> : <span className="text-slate-300">—</span>),
  },
  {
    key: 'commentaires', label: 'Notes', filter: 'text', hidden: true,
    value: (r) => pick(r, ['commentaires', 'note', 'notes']),
  },
];

/* ── Librerie (catalogue fournisseurs) ────────────────────────────────────── */
const librerieColumns = () => [
  {
    key: 'fournisseur', label: 'Fournisseur', filter: 'text',
    value: (r) => pick(r, ['fournisseur', 'nomFournisseur', 'nom', 'name']),
    display: (r) => {
      const v = pick(r, ['fournisseur', 'nomFournisseur', 'nom', 'name']);
      return v ? <div className="font-bold text-slate-800 min-w-[180px]">{v}</div> : <span className="text-slate-300">{r.id || '—'}</span>;
    },
  },
  {
    key: 'contact', label: 'Contact',
    value: (r) => pick(r, ['contact']),
    display: (r) => (pick(r, ['contact']) ? <span className="text-xs text-slate-600">{pick(r, ['contact'])}</span> : <span className="text-slate-300">—</span>),
  },
  {
    key: 'email', label: 'Email', filter: 'text',
    value: (r) => pick(r, ['email', 'mail']),
    display: (r) => (pick(r, ['email', 'mail']) ? <span className="text-xs text-blue-700 break-all">{pick(r, ['email', 'mail'])}</span> : <span className="text-slate-300">—</span>),
  },
  {
    key: 'telephone', label: 'Téléphone',
    value: (r) => pick(r, ['telephone', 'phone', 'tel']),
    display: (r) => (pick(r, ['telephone', 'phone', 'tel']) ? <span className="text-xs text-slate-600 whitespace-nowrap">{pick(r, ['telephone', 'phone', 'tel'])}</span> : <span className="text-slate-300">—</span>),
  },
  {
    key: 'adresse', label: 'Adresse', filter: 'text',
    value: (r) => pick(r, ['adresse', 'address']),
    display: (r) => {
      const v = pick(r, ['adresse', 'address']);
      return v ? <div className="text-[11px] text-slate-500 max-w-[220px] leading-snug">{v}</div> : <span className="text-slate-300">—</span>;
    },
  },
  {
    key: 'categories', label: 'Catégories', filter: 'text',
    value: (r) => (Array.isArray(r.categories) ? r.categories.join(' ') : pick(r, ['categories', 'category'])),
    display: (r) => {
      const cats = Array.isArray(r.categories) ? r.categories : txt(pick(r, ['categories', 'category'])).split(/[,;]+/).map((s) => s.trim()).filter(Boolean);
      return cats.length
        ? <div className="flex flex-wrap gap-1 max-w-[240px]">{cats.map((c) => <span key={c} className="bg-blue-50 border border-blue-200 text-blue-600 rounded-md px-1.5 py-0.5 text-[10px] font-semibold">{c}</span>)}</div>
        : <span className="text-slate-300">—</span>;
    },
  },
  {
    key: 'site', label: 'Site web', filter: 'text',
    value: (r) => pick(r, ['siteWeb', 'site', 'website', 'url', 'lien']),
    display: (r) => {
      const v = pick(r, ['siteWeb', 'site', 'website', 'url', 'lien']);
      return v ? <a href={/^https?:/i.test(v) ? v : `https://${v}`} target="_blank" rel="noreferrer" className="text-[11px] text-blue-600 hover:underline break-all max-w-[220px] inline-block">{v}</a> : <span className="text-slate-300">—</span>;
    },
  },
  {
    key: 'notes', label: 'Notes', filter: 'text', hidden: true,
    value: (r) => pick(r, ['notes', 'note', 'commentaires']),
  },
];
/* ── Configuration des pages par collection ──────────────────────────────── */
const KIND_CONFIG = {
  depenses: {
    columns: depensesColumns, minWidth: '1520px', importable: true,
    empty: 'Aucune dépense pour le moment',
    sub: 'Ajoutez des Dépenses / BC via l’assistant d’import (feuille « Suivi / Description / n° SIFAC »).',
    search: 'Rechercher description, fournisseur, demandeur, n° SIFAC, BC…',
  },
  om: {
    columns: omColumns, minWidth: '1280px', importable: true,
    empty: 'Aucun ordre de mission pour le moment',
    sub: 'Ajoutez des OM via l’assistant d’import (feuille « ENT / Prix / Description »).',
    search: 'Rechercher mission, demandeur, destination, n° OM…',
  },
  desiderate: {
    columns: desiderateColumns, minWidth: '1480px', importable: true,
    empty: 'Aucun souhait d’achat pour le moment',
    sub: 'Ajoutez des souhaits via l’assistant d’import (feuille « Decision / Code produit »).',
    search: 'Rechercher article, fournisseur, demandeur, code produit…',
  },
  librerie: {
    columns: librerieColumns, minWidth: '1320px', importable: false,
    empty: 'Catalogue des fournisseurs vide',
    sub: 'Ce catalogue référence les fournisseurs utilisés par les Dépenses et les Spese Desiderate.',
    search: 'Rechercher un fournisseur, contact, catégorie…',
  },
  questioni: {
    columns: questioniColumns, minWidth: '920px', importable: true,
    canAdd: true,
    addLabel: 'Ajouter une question',
    addDone: 'Question ajoutée au tableau ✓',
    empty: 'Aucune question ouverte pour le moment',
    sub: 'Questions ouvertes : suivi des points en suspens (A faire / En cours / Fait). Ajoutez une nouvelle question à la main ou via l’assistant d’import.',
    search: 'Rechercher une question, un responsable, un tag…',
  },
  sicurezza: {
    columns: sicurezzaColumns, minWidth: '920px', importable: true,
    canAdd: true,
    addLabel: 'Ajouter une tâche H&S',
    addDone: 'Tâche H&S ajoutée au tableau ✓',
    empty: 'Aucune tâche H&S pour le moment',
    sub: 'Tâches d’hygiène & de sécurité du laboratoire. Ajoutez une nouvelle tâche à la main ou via l’assistant d’import.',
    search: 'Rechercher une tâche, un responsable…',
  },
};

/* ========================================================================= */
export const CollectionPage = ({ kind }) => {
  const { data, settings, upsert, currentUser } = useAdmin();
  const [importOpen, setImportOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [notice, setNotice] = useState(null);
  const cfg = KIND_CONFIG[kind] || KIND_CONFIG.questioni;
  const list = Array.isArray(data[kind]) ? data[kind] : [];
  const recettes = Array.isArray(data.recettes) ? data.recettes : [];
  const personnel = Array.isArray(data.personnel) ? data.personnel : [];
  const columns = cfg.columns(recettes);

  // Le bandeau de confirmation disparaît automatiquement après quelques secondes.
  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const statusOptions = Array.isArray(settings && settings.issueStatuses)
    ? settings.issueStatuses
    : ISSUE_STATUSES;
  const urgencyOptions = Array.isArray(settings && settings.urgences)
    ? settings.urgences
    : URGENCES;
  const responsableOptions = [
    ...personnel.map((p) => txt(p && p.nom)).filter(Boolean),
    ...list.map((r) => pick(r, ['responsable'])).filter(Boolean),
    txt(currentUser && currentUser.name),
  ].filter((v, i, a) => v && a.indexOf(v) === i);
  const prioriteOptions = [
    ...urgencyOptions,
    ...list.map((r) => pick(r, ['priorite', 'urgence'])).filter(Boolean),
  ].filter((v, i, a) => v && a.indexOf(v) === i);

  const openAdd = () => setAddOpen(true);
  const closeAdd = () => setAddOpen(false);

  return (
    <div className="max-w-full mx-auto flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs font-bold text-slate-400 max-w-2xl">
          {list.length} enregistrement{list.length > 1 ? 's' : ''} · les colonnes sont
          triables (en-têtes) et filtrables (bouton « Filtres »).
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          {cfg.canAdd && (
            <button
              type="button"
              onClick={openAdd}
              title="Saisir un nouvel enregistrement à la main"
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm px-4 py-2 rounded-xl shadow-sm transition-colors flex items-center gap-1.5"
            >
              <span className="text-base leading-none">＋</span> {cfg.addLabel}
            </button>
          )}
          {cfg.importable !== false && (
            <button
              onClick={() => setImportOpen(true)}
              className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-bold text-sm px-4 py-2 rounded-xl shadow-sm transition-colors flex items-center gap-1.5"
              title={`Importer les ${kind} depuis la feuille Google Sheets (coller, CSV ou Excel)`}
            >
              <span className="text-base leading-none">📥</span> Importer
            </button>
          )}
        </div>
      </div>

      {notice && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-semibold text-emerald-700 flex items-center justify-between gap-3">
          <span>{notice}</span>
          <button
            type="button" onClick={() => setNotice(null)}
            className="shrink-0 font-black opacity-60 hover:opacity-100" title="Masquer"
          >
            ✕
          </button>
        </div>
      )}

      {list.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-10 text-center">
          <div className="text-4xl mb-2">🗂️</div>
          <p className="font-black text-slate-700">{cfg.empty}</p>
          <p className="text-sm text-slate-400 mt-1 mb-5">{cfg.sub}</p>
          {cfg.canAdd && (
            <button
              type="button"
              onClick={openAdd}
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm px-5 py-2.5 rounded-xl shadow-sm transition-colors"
            >
              <span className="text-base leading-none">＋</span> {cfg.addLabel}
            </button>
          )}
        </div>
      ) : (
        <SmartTable
          columns={columns}
          rows={list}
          minWidth={cfg.minWidth}
          searchPlaceholder={cfg.search}
          emptyLabel={cfg.empty}
          noMatchLabel="Aucun enregistrement ne correspond aux filtres."
        />
      )}

      {importOpen && <AdminImportModal kind={kind} onClose={() => setImportOpen(false)} />}

      {addOpen && (
        <CollectionAddModal
          kind={kind}
          cfg={cfg}
          existing={list}
          statusOptions={statusOptions}
          responsableOptions={responsableOptions}
          prioriteOptions={prioriteOptions}
          onCancel={closeAdd}
          onSave={(rec) => {
            upsert(kind, rec);
            setAddOpen(false);
            setNotice(cfg.addDone);
          }}
        />
      )}
    </div>
  );
};
