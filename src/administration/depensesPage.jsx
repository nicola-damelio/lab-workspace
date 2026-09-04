/* =========================================================================
   src/administration/depensesPage.jsx
   Page « Dépenses » — dépenses / bons de commande (CRUD complet).

   Page dédiée qui remplace l’ancienne liste en lecture seule : ajout, édition
   et suppression de chaque dépense, avec TOUTES les colonnes de l’onglet
   « Dépenses » du classeur Google Sheets du laboratoire :

     Suivi/Statut · ENT · Description · Demandeur · Catégorie · Classification
     · Ligne budgétaire · Montant HT · Frais de port · Date demande ·
     Nom du fournisseur · Contact · N° devis · N° SIFAC · Date BC · N° BC ·
     Date signature · Date approb. fournisseur · N° facture · Livraisons en
     plusieurs phases (date réception colis, n° BL, date service fait, n° SF)
     · Livraison complète · Commentaires.

   Modèle stocké (mêmes clés que l’import Google Sheets) :
     { suivi, statut, ent, nonComptabiliseEnt, description, demandeur,
       categorie, classification, ligneBudgetaire, recetteId, montant,
       fraisPort, dateDemande, fournisseur, contact, numDevis, numDevisUrl,
       numSIFAC, dateBC, numBC, numBCUrl, dateSignature,
       dateApprobFournisseur, numFacture, numFactureUrl, omNo, omUrl,
       livraisonComplete, livraisons: [{ dateReception, numBL, numBLUrl,
       dateServiceFait, numSF, numSFUrl }], commentaires }
     + enveloppe d’audit posée par upsert() (createdAt/By, updatedAt/By).

   « Livraison complète » passe automatiquement à « Oui » dès que toutes les
   phases renseignées ont leur date de réception (sinon « Non »). Une commande
   sans colis à suivre (prestation, inscription…) peut être déclarée complète
   manuellement via la case « sans colis » du formulaire.
   ========================================================================= */
import React, { useMemo, useState } from 'react';
import { useAdmin } from './AdminContext';
import { SmartTable } from './smartTable';
import { AdminImportModal } from './adminImportModal';
import { toFrDate } from './congesDates';
import { RECETTE_TYPES, DEPENSE_NATURES, DEPENSE_STATUSES } from './adminSchema';
import { parseEuroAmount } from './importUtils';

/* ── Petites aides ──────────────────────────────────────────────────────── */
const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const txt = (v) => (v === null || v === undefined ? '' : String(v).trim());
const pick = (rec, keys) => {
  for (const k of keys) {
    const v = rec && rec[k];
    if (txt(v)) return v;
  }
  return '';
};
const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const numOf = (v) => (v === null || v === undefined || v === '' ? null : toNum(v));
const numToInput = (v) => {
  const n = numOf(v);
  return n === null ? '' : String(n).replace('.', ',');
};
const parseNum = (v) => {
  const n = parseEuroAmount(v);
  return n === null ? null : Math.round(n * 100) / 100;
};
const isoOf = (v) => {
  const s = txt(v);
  return s ? s.slice(0, 10) : '';
};
const addScheme = (u) => {
  const s = txt(u);
  if (!s) return '';
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`;
};
const norm = (s) => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/* ── Pipelines de suivi (statuts possibles, au-delà des valeurs personnalisées). */
const DEPENSE_PIPELINE = ['Devis en cours', 'SIFAC transmis', 'BC signé', 'Service fait', 'Livré', 'Facturé', 'Clôturé'];
const DEPENSE_EXTRA_STATUSES = ['Colis partiellement livré'];

/* ── Livraisons : formes vides, filtrage, « complète » automatique ──────── */
const EMPTY_LIV = () => ({
  dateReception: '', numBL: '', numBLUrl: '', dateServiceFait: '', numSF: '', numSFUrl: '',
});
const livHasContent = (l) => l
  && [l.dateReception, l.numBL, l.numBLUrl, l.dateServiceFait, l.numSF, l.numSFUrl].some((v) => txt(v));
const normalizeLiv = (l) => ({
  dateReception: isoOf(l && l.dateReception),
  numBL: txt(l && l.numBL),
  numBLUrl: txt(l && l.numBLUrl),
  dateServiceFait: isoOf(l && l.dateServiceFait),
  numSF: txt(l && l.numSF),
  numSFUrl: txt(l && l.numSFUrl),
});
const keepLivraisons = (arr) => (Array.isArray(arr) ? arr : [])
  .map(normalizeLiv)
  .filter(livHasContent);
const allReceived = (kept) => kept.length > 0 && kept.every((l) => txt(l.dateReception));
/**
 * Valeur stockée de « livraisonComplete » :
 *  · des phases sont renseignées → Oui si toutes arrivées, sinon Non ;
 *  · aucune phase → case « sans colis » cochée = Oui, sinon valeur précédente.
 */
const completeValue = (kept, prevFlag, noParcels) => {
  if (kept.length) return allReceived(kept) ? 'Oui' : 'Non';
  const prev = txt(prevFlag);
  if (noParcels) return 'Oui';
  return prev === 'Oui' || prev === 'Non' ? prev : '';
};

/* Retrouve la Recette (ligne budgétaire) dont l’intitulé correspond, comme
   le fait l’import (« S2R01GEC (INTRUDE) » → ligne correspondante). */
const findRecetteId = (recettes, label) => {
  const n = norm(label);
  if (!n) return '';
  const list = Array.isArray(recettes) ? recettes : [];
  const exact = list.find((r) => norm(r.ligne) === n);
  if (exact) return exact.id;
  const core = n.replace(/\s*\([^)]*\)\s*$/, '');
  if (core) {
    const byCore = list.find((r) => norm(r.ligne).replace(/\s*\([^)]*\)\s*$/, '') === core);
    if (byCore) return byCore.id;
  }
  const tok = (n.match(/\(([^)]+)\)\s*$/) || [])[1];
  if (tok) {
    const t = norm(tok);
    const byTok = list.find((r) => norm(r.ligne).split(' ').includes(t));
    if (byTok) return byTok.id;
  }
  return '';
};

/* ── Petits éléments d’affichage ────────────────────────────────────────── */
const TONES = {
  slate: 'bg-slate-100 border-slate-200 text-slate-600',
  blue: 'bg-blue-50 border-blue-200 text-blue-700',
  indigo: 'bg-indigo-50 border-indigo-200 text-indigo-700',
  emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  amber: 'bg-amber-50 border-amber-200 text-amber-700',
  red: 'bg-red-50 border-red-200 text-red-600',
};
const Badge = ({ tone = 'slate', children }) => (
  <span className={`inline-block text-[10px] font-black uppercase px-2 py-0.5 rounded-full border ${TONES[tone] || TONES.slate}`}>
    {children}
  </span>
);

const statutTone = (v) => {
  const s = txt(v).toLowerCase();
  if (/(signe|livr|fait|factur|clos|regl|term|approuv|oui|exact|disponible)/.test(s)) return 'emerald';
  if (/(devis|sifac|attente|partiel|pending|en cours|estime)/.test(s)) return 'amber';
  if (/(refus|reject|annul|non)/.test(s)) return 'red';
  return 'slate';
};
const StatutBadge = ({ value }) =>
  txt(value) ? <Badge tone={statutTone(value)}>{txt(value)}</Badge> : <span className="text-slate-300">—</span>;

const CompleteBadge = ({ value }) => {
  const s = txt(value).toLowerCase();
  if (s === 'oui') return <Badge tone="emerald">✓ Complète</Badge>;
  if (s === 'non') return <Badge tone="amber">En attente</Badge>;
  return <span className="text-slate-300">—</span>;
};
const CategorieBadge = ({ value }) => {
  const v = txt(value);
  if (!v) return <span className="text-slate-300">—</span>;
  return <Badge tone={v.toLowerCase() === 'investissement' ? 'indigo' : 'emerald'}>{v}</Badge>;
};

const DateCell = ({ iso }) => {
  const fr = toFrDate(iso);
  return fr
    ? <span className="whitespace-nowrap text-xs font-semibold text-slate-600">{fr}</span>
    : <span className="text-slate-300">—</span>;
};

/* Code (devis, BC, BL, SF, facture…) avec lien facultatif vers le document. */
const Ref = ({ value, url, fallback = '—' }) => {
  const v = txt(value);
  const u = txt(url);
  if (!v && !u) return <span className="text-slate-300">{fallback}</span>;
  const label = v || 'document';
  return (
    <span className="inline-flex items-center gap-1 min-w-0 max-w-full">
      {u ? (
        <a
          href={addScheme(u)} target="_blank" rel="noreferrer"
          onClick={(e) => e.stopPropagation()} title={u}
          className="min-w-0 truncate font-mono text-[11px] font-semibold text-blue-700 hover:text-blue-900 underline decoration-blue-300 underline-offset-2 transition-colors"
        >{label}</a>
      ) : (
        <span className="font-mono text-[11px] font-semibold text-slate-700 truncate" title={v}>{label}</span>
      )}
      {u ? (
        <a
          href={addScheme(u)} target="_blank" rel="noreferrer"
          onClick={(e) => e.stopPropagation()} title={u}
          className="shrink-0 text-[10px] leading-4 font-black text-blue-600 hover:text-blue-800 border border-blue-200 hover:bg-blue-50 rounded px-1"
        >↗</a>
      ) : null}
    </span>
  );
};

/* Cellule « Livraisons » : une ligne par phase (réception / BL / SF / n° SF). */
const LivraisonsCell = ({ livs }) => {
  const kept = keepLivraisons(livs);
  if (!kept.length) return <span className="text-slate-300">—</span>;
  const received = kept.filter((l) => txt(l.dateReception)).length;
  const sub = (d) => {
    const fr = toFrDate(d);
    return fr
      ? <span className="whitespace-nowrap text-[11px] font-semibold text-slate-600">{fr}</span>
      : <span className="text-slate-300">—</span>;
  };
  return (
    <div className="min-w-[560px]">
      <div className="flex items-center gap-2 mb-1">
        <span className="font-black text-slate-700 text-xs">{kept.length} phase{kept.length > 1 ? 's' : ''}</span>
        <span className="text-[10px] text-slate-400">{received}/{kept.length} colis reçu{received > 1 ? 's' : ''}</span>
      </div>
      <div className="rounded-lg border border-slate-200 overflow-hidden">
        <div className="grid grid-cols-[110px_minmax(0,1.2fr)_110px_minmax(0,1fr)] gap-2 px-2 py-1 bg-slate-50 border-b border-slate-200 text-[9px] font-black uppercase text-slate-400">
          <span>Réception colis</span>
          <span>N° BL</span>
          <span>Service fait</span>
          <span>N° SF</span>
        </div>
        {kept.map((l, i) => (
          <div key={`${l.numBL || l.numSF || ''}-${i}`} className="grid grid-cols-[110px_minmax(0,1.2fr)_110px_minmax(0,1fr)] gap-2 px-2 py-1 border-b border-slate-100 last:border-0 items-center bg-white">
            {sub(l.dateReception)}
            <Ref value={l.numBL} url={l.numBLUrl} />
            {sub(l.dateServiceFait)}
            <Ref value={l.numSF} url={l.numSFUrl} />
          </div>
        ))}
      </div>
    </div>
  );
};

const SummaryCard = ({ label, value, tone = 'slate', hint }) => {
  const tones = {
    slate: 'border-slate-200 text-slate-800',
    emerald: 'border-emerald-200 text-emerald-700',
    amber: 'border-amber-200 text-amber-700',
    red: 'border-red-200 text-red-600',
    blue: 'border-blue-200 text-blue-700',
    indigo: 'border-indigo-200 text-indigo-700',
  };
  return (
    <div className={`bg-white border rounded-2xl shadow-sm px-3 py-2.5 ${tones[tone] || tones.slate}`} title={hint || ''}>
      <div className="text-lg font-black leading-tight truncate">{value}</div>
      <div className="text-[9px] font-black uppercase tracking-wide text-slate-400">{label}</div>
    </div>
  );
};

/* ═════════════════════════════════════════════════════════════════════════
   Page Dépenses
   ═════════════════════════════════════════════════════════════════════════ */
const DepensesPage = () => {
  const { data, settings, upsert, remove, currentUser } = useAdmin();
  const list = useMemo(() => (Array.isArray(data.depenses) ? data.depenses : []), [data.depenses]);
  const recettes = useMemo(() => (Array.isArray(data.recettes) ? data.recettes : []), [data.recettes]);
  const personnel = useMemo(() => (Array.isArray(data.personnel) ? data.personnel : []), [data.personnel]);
  const librerie = useMemo(() => (Array.isArray(data.librerie) ? data.librerie : []), [data.librerie]);

  const [modal, setModal] = useState(null); // { rec } | null
  const [importOpen, setImportOpen] = useState(false);

  /* Options de formulaires (réglages + valeurs déjà présentes dans la liste). */
  const types = Array.isArray(settings.recetteTypes) && settings.recetteTypes.length
    ? settings.recetteTypes : RECETTE_TYPES;
  const natures = Array.isArray(settings.depenseNatures) && settings.depenseNatures.length
    ? settings.depenseNatures : DEPENSE_NATURES;

  const statutOptions = useMemo(() => {
    const set = new Set([...(settings.depenseStatuses || DEPENSE_STATUSES), ...DEPENSE_PIPELINE, ...DEPENSE_EXTRA_STATUSES]);
    list.forEach((r) => {
      const s = pick(r, ['statut', 'suivi']);
      if (s) set.add(s);
    });
    return [...set];
  }, [list, settings]);

  const demandeurNames = useMemo(() => {
    const set = new Set();
    personnel.forEach((p) => {
      const n = pick(p, ['nom', 'prenom', 'name']);
      if (n) set.add(n);
    });
    list.forEach((r) => {
      const d = txt(r.demandeur);
      if (d) set.add(d);
    });
    if (currentUser && txt(currentUser.name)) set.add(txt(currentUser.name));
    return [...set].sort((a, b) => a.localeCompare(b, 'fr'));
  }, [personnel, list, currentUser]);

  const fournisseurNames = useMemo(() => {
    const set = new Set();
    librerie.forEach((l) => {
      const n = pick(l, ['fournisseur', 'nomFournisseur', 'nom', 'name']);
      if (n) set.add(n);
    });
    list.forEach((r) => {
      if (txt(r.fournisseur)) set.add(txt(r.fournisseur));
    });
    return [...set].sort((a, b) => a.localeCompare(b, 'fr'));
  }, [librerie, list]);

  const contactNames = useMemo(() => {
    const set = new Set();
    librerie.forEach((l) => {
      const c = pick(l, ['contact', 'email', 'emailContact', 'tel', 'telephone']);
      if (c) set.add(c);
    });
    list.forEach((r) => {
      if (txt(r.contact)) set.add(txt(r.contact));
    });
    return [...set].sort((a, b) => a.localeCompare(b, 'fr'));
  }, [librerie, list]);

  const ligneLabelOf = (r) => {
    const found = recettes.find((x) => x.id === r.recetteId);
    return found ? found.ligne : txt(r.ligneBudgetaire);
  };

  const sorted = useMemo(() => [...list].sort((a, b) => {
    const da = isoOf(a.dateDemande);
    const db = isoOf(b.dateDemande);
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return db.localeCompare(da);
  }), [list]);

    /* Résumé du haut de page. */
  const summary = useMemo(() => {
    const out = {
      count: 0, moneyCount: 0, total: 0, bcCount: 0, bcTotal: 0,
      completeCount: 0, parcelsReceived: 0, parcelsTotal: 0, pendingCount: 0,
    };
    list.forEach((d) => {
      out.count += 1;
      const m = numOf(d.montant);
      const p = numOf(d.fraisPort);
      if (m !== null || p !== null) {
        out.total += (m || 0) + (p || 0);
        out.moneyCount += 1;
      }
      const st = pick(d, ['statut', 'suivi']);
      if (st === 'BC signé') {
        out.bcCount += 1;
        out.bcTotal += (m || 0) + (p || 0);
      }
      if (txt(d.livraisonComplete) === 'Oui') out.completeCount += 1;
      const liv = keepLivraisons(d.livraisons);
      out.parcelsTotal += liv.length;
      out.parcelsReceived += liv.filter((l) => txt(l.dateReception)).length;
      if (liv.length && !allReceived(liv)) out.pendingCount += 1;
    });
    return out;
  }, [list]);

  /* Enregistrement : normalise + valide, puis upsert (ou remove si absent). */
  const onSaveDepense = (draft, existingId) => {
    const description = txt(draft.description);
    const numBC = txt(draft.numBC);
    const numFacture = txt(draft.numFacture);
    if (!description && !numBC && !numFacture && !txt(draft.numDevis)) {
      alert('Merci de renseigner au moins une description ou une référence (N° devis, BC ou facture).');
      return false;
    }
    const statut = txt(draft.statut);
    const livraisons = keepLivraisons(draft.livraisons);
    const complete = completeValue(livraisons, draft.livraisonComplete, draft.noParcelsComplete);
    const ligneBudgetaire = txt(draft.ligneBudgetaire);
    const recetteId = draft.recetteId && recettes.some((r) => r.id === draft.recetteId)
      ? draft.recetteId
      : findRecetteId(recettes, ligneBudgetaire);
    const entPhrase = 'pas décompté sur ENT';
    const rawEnt = txt(draft.ent);
    const patch = {
      description,
      demandeur: txt(draft.demandeur),
      categorie: txt(draft.categorie),
      classification: txt(draft.classification),
      ligneBudgetaire,
      recetteId: recetteId || '',
      montant: parseNum(draft.montant),
      fraisPort: parseNum(draft.fraisPort),
      dateDemande: isoOf(draft.dateDemande),
      fournisseur: txt(draft.fournisseur),
      contact: txt(draft.contact),
      numDevis: txt(draft.numDevis),
      numDevisUrl: txt(draft.numDevisUrl),
      numSIFAC: txt(draft.numSIFAC),
      dateBC: isoOf(draft.dateBC),
      numBC,
      numBCUrl: txt(draft.numBCUrl),
      dateSignature: isoOf(draft.dateSignature),
      dateApprobFournisseur: isoOf(draft.dateApprobFournisseur),
      numFacture,
      numFactureUrl: txt(draft.numFactureUrl),
      omNo: txt(draft.omNo),
      omUrl: txt(draft.omUrl),
      suivi: statut,
      statut,
      nonComptabiliseEnt: !!draft.nonComptabiliseEnt,
      ent: draft.nonComptabiliseEnt ? entPhrase : rawEnt === entPhrase ? '' : rawEnt,
      livraisonComplete: complete,
      livraisons,
      commentaires: txt(draft.commentaires),
    };
    if (complete === 'Oui') {
      patch.completeDeclaredBy = (currentUser && currentUser.name) || '';
      patch.completeDeclaredAt = Date.now();
    } else {
      patch.completeDeclaredBy = '';
      patch.completeDeclaredAt = null;
    }
    upsert('depenses', patch, existingId);
    setModal(null);
    return true;
  };

  const removeDepense = (rec) => {
    if (!rec || !rec.id) return;
    const label = txt(rec.description) || pick(rec, ['numBC', 'numSIFAC', 'numFacture']) || rec.id;
    if (window.confirm(`Supprimer définitivement la dépense « ${label} » ?`)) {
      remove('depenses', rec.id);
    }
  };

  /* ── Colonnes du tableau (ordre de l’onglet du classeur) ──────────────── */
  const columns = [
    {
      key: 'description', label: 'Dépense', filter: 'text',
      value: (r) => [r.description, r.classification, r.ent, r.numSIFAC, r.numBC, r.numFacture].filter(Boolean).join(' '),
      display: (r) => {
        const statut = pick(r, ['statut', 'suivi']);
        const classification = txt(r.classification);
        const ent = txt(r.ent);
        const title = txt(r.description)
          || txt(r.ligneBudgetaire)
          || pick(r, ['numBC', 'numSIFAC', 'numFacture']) || r.id;
        return (
          <div className="min-w-[230px] max-w-[320px]">
            <div className="font-bold text-slate-800 leading-snug line-clamp-2" title={title}>{title}</div>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              <StatutBadge value={statut} />
              {classification && <span className="text-[10px] text-slate-400 font-semibold">{classification}</span>}
            </div>
            {ent && <div className="text-[10px] text-slate-400 mt-0.5 truncate max-w-[280px]" title={`ENT : ${ent}`}>ENT : {ent}</div>}
          </div>
        );
      },
    },
    {
      key: 'demandeur', label: 'Demandeur', filter: 'text',
      value: (r) => txt(r.demandeur),
      display: (r) => (txt(r.demandeur)
        ? <span className="whitespace-nowrap text-xs font-semibold text-slate-600">{txt(r.demandeur)}</span>
        : <span className="text-slate-300">—</span>),
    },
    {
      key: 'categorie', label: 'Catégorie', filter: 'facet',
      value: (r) => txt(r.categorie),
      display: (r) => <CategorieBadge value={r.categorie} />,
    },
    {
      key: 'ligne', label: 'Ligne budgétaire', filter: 'text',
      value: (r) => ligneLabelOf(r),
      display: (r) => {
        const v = ligneLabelOf(r);
        if (!v) return <span className="text-slate-300">—</span>;
        return (
          <div className="max-w-[220px]">
            <div className="font-mono text-[11px] font-bold text-indigo-700 leading-tight break-words" title={v}>{v}</div>
            {r.recetteId ? <div className="text-[9px] text-emerald-600 font-bold uppercase mt-0.5">● liée à la recette</div> : null}
          </div>
        );
      },
    },
    {
      key: 'montant', label: 'Montant HT', numeric: true, dataType: 'number', filter: 'auto',
      value: (r) => numOf(r.montant),
      display: (r) => {
        const n = numOf(r.montant);
        return n === null
          ? <span className="text-slate-300">—</span>
          : <span className="whitespace-nowrap text-xs font-black text-slate-700 tabular-nums">{euro.format(n)}</span>;
      },
    },
    {
      key: 'fraisPort', label: 'Frais de port', numeric: true, dataType: 'number', filter: 'auto',
      value: (r) => numOf(r.fraisPort),
      display: (r) => {
        const n = numOf(r.fraisPort);
        return n === null
          ? <span className="text-slate-300">—</span>
          : <span className="whitespace-nowrap text-xs font-semibold text-slate-500 tabular-nums">{euro.format(n)}</span>;
      },
    },
    {
      key: 'dateDemande', label: 'Date demande', filter: 'text',
      value: (r) => isoOf(r.dateDemande),
      display: (r) => <DateCell iso={r.dateDemande} />,
    },
    {
      key: 'fournisseur', label: 'Nom du fournisseur', filter: 'text',
      value: (r) => txt(r.fournisseur),
      display: (r) => (txt(r.fournisseur)
        ? <span className="whitespace-nowrap text-xs font-bold text-slate-700">{txt(r.fournisseur)}</span>
        : <span className="text-slate-300">—</span>),
    },
    {
      key: 'contact', label: 'Contact fournisseur', filter: 'text',
      value: (r) => txt(r.contact),
      display: (r) => (txt(r.contact)
        ? <span className="whitespace-nowrap text-xs font-semibold text-slate-500">{txt(r.contact)}</span>
        : <span className="text-slate-300">—</span>),
    },
    {
      key: 'numDevis', label: 'N° devis', filter: 'text',
      value: (r) => txt(r.numDevis),
      display: (r) => <Ref value={r.numDevis} url={r.numDevisUrl} />,
    },
    {
      key: 'numSIFAC', label: 'N° SIFAC', filter: 'text',
      value: (r) => txt(r.numSIFAC),
      display: (r) => <Ref value={r.numSIFAC} />,
    },
    {
      key: 'dateBC', label: 'Date BC', filter: 'text',
      value: (r) => isoOf(r.dateBC),
      display: (r) => <DateCell iso={r.dateBC} />,
    },
    {
      key: 'numBC', label: 'N° BC', filter: 'text',
      value: (r) => txt(r.numBC),
      display: (r) => <Ref value={r.numBC} url={r.numBCUrl} />,
    },
    {
      key: 'dateSignature', label: 'Date signature', filter: 'text',
      value: (r) => isoOf(r.dateSignature),
      display: (r) => <DateCell iso={r.dateSignature} />,
    },
    {
      key: 'dateApprobFournisseur', label: 'Approb. fournisseur', filter: 'text',
      value: (r) => isoOf(r.dateApprobFournisseur),
      display: (r) => <DateCell iso={r.dateApprobFournisseur} />,
    },
    {
      key: 'numFacture', label: 'N° facture', filter: 'text',
      value: (r) => txt(r.numFacture),
      display: (r) => <Ref value={r.numFacture} url={r.numFactureUrl} />,
    },
    {
      key: 'omNo', label: 'N° OM / paiement', filter: 'text',
      value: (r) => txt(r.omNo),
      display: (r) => <Ref value={r.omNo} url={r.omUrl} />,
    },
    {
      key: 'livraisons', label: 'Livraisons', filter: 'text',
      value: (r) => keepLivraisons(r.livraisons)
        .map((l) => [l.dateReception, l.numBL, l.dateServiceFait, l.numSF].filter(Boolean).join(' '))
        .join(' | '),
      display: (r) => <LivraisonsCell livs={r.livraisons} />,
    },
    {
      key: 'livraisonComplete', label: 'Livraison complète', filter: 'facet',
      value: (r) => txt(r.livraisonComplete),
      display: (r) => {
        const declared = txt(r.completeDeclaredBy);
        const ts = r.completeDeclaredAt;
        const at = ts ? toFrDate(isoOf(new Date(ts).toISOString())) : '';
        const extra = txt(r.livraisonComplete) === 'Oui' && declared
          ? ` Déclarée par ${declared}${at ? ` le ${at}` : ''}` : '';
        return (
          <span title={txt(r.livraisonComplete) === 'Oui' ? `Livraison complète.${extra}` : ''}>
            <CompleteBadge value={r.livraisonComplete} />
          </span>
        );
      },
    },
    {
      key: 'commentaires', label: 'Commentaires', filter: 'text', hidden: true,
      value: (r) => txt(r.commentaires),
    },
    {
      key: 'actions', label: '', filter: 'none', filterable: false,
      value: () => '',
      display: (r) => (
        <div className="flex items-center gap-1 whitespace-nowrap">
          <button
            type="button"
            title="Modifier la dépense"
            onClick={() => setModal({ mode: 'edit', rec: r })}
            className="text-[11px] font-black px-2 py-1 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
          >✏️ Modifier</button>
          <button
            type="button"
            title="Supprimer la dépense"
            onClick={() => removeDepense(r)}
            className="text-[11px] font-black px-2 py-1 rounded-lg border border-red-200 bg-red-50 text-red-500 hover:bg-red-100 transition-colors"
          >🗑️</button>
        </div>
      ),
    },
  ];

  return (
    <div className="max-w-full mx-auto flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs font-bold text-slate-400">
          {summary.count} dépense{summary.count > 1 ? 's' : ''} · {summary.parcelsReceived}/{summary.parcelsTotal} colis reçu{summary.parcelsReceived > 1 ? 's' : ''} ·
          {summary.pendingCount ? ` ${summary.pendingCount} livraison${summary.pendingCount > 1 ? 's' : ''} en attente` : ' toutes les livraisons reçues'} —
          édition complète, mêmes colonnes que l’onglet « Dépenses » du classeur.
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setImportOpen(true)}
            className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-bold text-sm px-4 py-2 rounded-xl shadow-sm transition-colors flex items-center gap-1.5"
            title="Importer les dépenses depuis la feuille Google Sheets (coller, CSV ou Excel)"
          >
            <span className="text-base leading-none">📥</span> Importer
          </button>
          <button
            onClick={() => setModal({ mode: 'new' })}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm px-4 py-2 rounded-xl shadow-sm transition-colors flex items-center gap-1.5"
          >
            <span className="text-base leading-none">+</span> Ajouter une dépense
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <SummaryCard
          label="Dépenses / BC" value={summary.count} tone="slate"
          hint="Nombre total de dépenses saisies."
        />
        <SummaryCard
          label="Total commandé (HT + port)" value={summary.moneyCount ? euro.format(summary.total) : '—'} tone="blue"
          hint={`Somme des montants HT et frais de port renseignés sur ${summary.moneyCount} dépense(s).`}
        />
        <SummaryCard
          label="BC signés (engagé)" value={`${summary.bcCount} · ${summary.bcCount ? euro.format(summary.bcTotal) : '—'}`} tone="indigo"
          hint="Dépenses au statut « BC signé » et montant cumulé correspondant (c’est ce décompte qu’utilise la page Recettes pour l’engagement budgétaire)."
        />
        <SummaryCard
          label="Livraisons complètes" value={`${summary.completeCount} / ${summary.count}`} tone="emerald"
          hint="Nombre de dépenses dont toutes les livraisons renseignées sont arrivées (ou sans colis, déclarées complètes)."
        />
      </div>

      <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-2.5 text-[11px] text-slate-600 leading-relaxed">
        <b>Fonctionnement :</b> cliquez sur « ✏️ Modifier » pour ouvrir le formulaire complet (mêmes colonnes que le classeur).
        « Livraison complète » passe automatiquement à <b>Oui</b> dès que toutes les livraisons renseignées ont leur date de
        réception (le gestionnaire enregistre simplement chaque arrivée) ; une commande sans colis (prestation, inscription…) se
        déclare complète via la case « sans colis » du formulaire. Les liens 🔗↗ (devis, BC, BL, facture, OM) ouvrent le document
        associé dans un nouvel onglet.
      </div>

      {sorted.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-10 text-center">
          <div className="text-4xl mb-2">📦</div>
          <p className="font-black text-slate-700">Aucune dépense enregistrée pour le moment</p>
          <p className="text-sm text-slate-400 mt-1">
            Ajoutez la première dépense via « + Ajouter une dépense », ou importez l’onglet « Dépenses » de la feuille Google Sheets.
          </p>
        </div>
      ) : (
        <SmartTable
          columns={columns}
          rows={sorted}
          minWidth="2250px"
          searchPlaceholder="Rechercher description, fournisseur, n° BC / SIFAC / facture, BL, service fait…"
          emptyLabel="Aucune dépense"
          noMatchLabel="Aucune dépense ne correspond aux filtres."
        />
      )}

      {importOpen && <AdminImportModal kind="depenses" onClose={() => setImportOpen(false)} />}

      {modal && (
        <DepenseModal
          rec={modal.mode === 'edit' ? modal.rec : null}
          recettes={recettes}
          types={types}
          natures={natures}
          statutOptions={statutOptions}
          demandeurNames={demandeurNames}
          fournisseurNames={fournisseurNames}
          contactNames={contactNames}
          onCancel={() => setModal(null)}
          onSave={onSaveDepense}
        />
      )}
    </div>
  );
};

/* ═════════════════════════════════════════════════════════════════════════
   Fenêtre d’ajout / édition d’une dépense (formulaire complet)
   ═════════════════════════════════════════════════════════════════════════ */
const MODAL_INPUT = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500';
const MODAL_URL_INPUT = `${MODAL_INPUT} font-mono text-xs text-blue-700 placeholder:text-slate-300 placeholder:font-sans`;
const MODAL_LABEL = 'block text-[10px] font-black uppercase text-slate-400 tracking-wide mb-1';

const Field = ({ label, children, className = '', hint }) => (
  <div className={className}>
    <label className={MODAL_LABEL}>{label}</label>
    {children}
    {hint ? <div className="text-[10px] text-slate-400 mt-1 leading-snug">{hint}</div> : null}
  </div>
);

const Section = ({ icon, title, children }) => (
  <div className="border border-slate-200 rounded-2xl bg-white p-4 shadow-sm">
    <div className="flex items-center gap-2 mb-3">
      <span className="text-sm leading-none">{icon}</span>
      <h3 className="text-xs font-black uppercase tracking-wide text-slate-500">{title}</h3>
    </div>
    {children}
  </div>
);

const DepenseModal = ({
  rec, recettes, types, natures, statutOptions,
  demandeurNames, fournisseurNames, contactNames, onCancel, onSave,
}) => {
  const editing = !!rec;

  const initialLivraisons = () => {
    const stored = Array.isArray(rec && rec.livraisons) && rec.livraisons.length
      ? rec.livraisons : null;
    if (!stored) return [EMPTY_LIV()];
    return stored.map((l) => normalizeLiv(l));
  };

  const [draft, setDraft] = useState(() => {
    if (rec) {
      return {
        description: txt(rec.description),
        demandeur: txt(rec.demandeur),
        categorie: txt(rec.categorie),
        classification: txt(rec.classification),
        statut: pick(rec, ['statut', 'suivi']),
        ligneBudgetaire: txt(rec.ligneBudgetaire),
        recetteId: txt(rec.recetteId),
        montant: numToInput(rec.montant),
        fraisPort: numToInput(rec.fraisPort),
        dateDemande: isoOf(rec.dateDemande),
        fournisseur: txt(rec.fournisseur),
        contact: txt(rec.contact),
        numDevis: txt(rec.numDevis),
        numDevisUrl: txt(rec.numDevisUrl),
        numSIFAC: txt(rec.numSIFAC),
        dateBC: isoOf(rec.dateBC),
        numBC: txt(rec.numBC),
        numBCUrl: txt(rec.numBCUrl),
        dateSignature: isoOf(rec.dateSignature),
        dateApprobFournisseur: isoOf(rec.dateApprobFournisseur),
        numFacture: txt(rec.numFacture),
        numFactureUrl: txt(rec.numFactureUrl),
        omNo: txt(rec.omNo),
        omUrl: txt(rec.omUrl),
        nonComptabiliseEnt: !!rec.nonComptabiliseEnt
          || /pas d[eé]compt/i.test(txt(rec.ent)),
        ent: txt(rec.ent),
        livraisonComplete: txt(rec.livraisonComplete),
        noParcelsComplete: txt(rec.livraisonComplete) === 'Oui'
          && !(Array.isArray(rec.livraisons) && rec.livraisons.length),
        livraisons: initialLivraisons(),
        commentaires: txt(rec.commentaires),
      };
    }
    return {
      description: '', demandeur: '', categorie: '', classification: '',
      statut: '', ligneBudgetaire: '', recetteId: '',
      montant: '', fraisPort: '', dateDemande: '',
      fournisseur: '', contact: '',
      numDevis: '', numDevisUrl: '', numSIFAC: '', dateBC: '',
      numBC: '', numBCUrl: '', dateSignature: '', dateApprobFournisseur: '',
      numFacture: '', numFactureUrl: '', omNo: '', omUrl: '',
      nonComptabiliseEnt: false, ent: '',
      livraisonComplete: '', noParcelsComplete: false,
      livraisons: [EMPTY_LIV()],
      commentaires: '',
    };
  });

  const set = (k) => (ev) => setDraft((d) => ({ ...d, [k]: ev.target.value }));
  const setCheck = (k) => (ev) => setDraft((d) => ({ ...d, [k]: ev.target.checked }));
  const setLiv = (i, k) => (ev) => {
    const v = ev.target.value;
    setDraft((d) => ({
      ...d,
      livraisons: d.livraisons.map((l, j) => (j === i ? { ...l, [k]: v } : l)),
    }));
  };
  const addLiv = () => setDraft((d) => ({ ...d, livraisons: [...d.livraisons, EMPTY_LIV()] }));
  const removeLiv = (i) => setDraft((d) => {
    const livraisons = d.livraisons.filter((_, j) => j !== i);
    return { ...d, livraisons: livraisons.length ? livraisons : [EMPTY_LIV()] };
  });
  const pickRecette = (ev) => {
    const id = ev.target.value;
    const found = recettes.find((r) => r.id === id);
    setDraft((d) => ({
      ...d,
      recetteId: id,
      ligneBudgetaire: found ? found.ligne : d.ligneBudgetaire,
    }));
  };
  const editLigne = (ev) => {
    const v = ev.target.value;
    setDraft((d) => ({ ...d, ligneBudgetaire: v, recetteId: '' }));
  };

  const previewLivs = useMemo(() => keepLivraisons(draft.livraisons), [draft.livraisons]);
  const previewReceived = previewLivs.filter((l) => txt(l.dateReception)).length;
  const previewComplete = completeValue(previewLivs, draft.livraisonComplete, draft.noParcelsComplete);

  const auditor = rec
    ? `${rec.updatedAt ? `modifié le ${toFrDate(isoOf(new Date(rec.updatedAt).toISOString()))}` : ''} ${txt(rec.updatedBy && rec.updatedBy.name)}`
    : '';

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(3px)' }}>
      <div className="bg-slate-50 rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden max-h-[96vh] flex flex-col">
        <div className="px-5 py-3.5 bg-gradient-to-br from-blue-600 to-indigo-700 text-white shrink-0">
          <h2 className="text-lg font-black">{editing ? 'Modifier la dépense' : 'Nouvelle dépense'}</h2>
          <p className="text-blue-100 text-[11px]">
            Formulaire complet de l’onglet « Dépenses » (devis → BC → livraisons → facture).
            Une commande peut avoir plusieurs livraisons ; elles se saisissent dans la partie « Livraisons ».
          </p>
        </div>

        <div className="p-4 overflow-y-auto custom-scrollbar flex flex-col gap-3">
          {/* A. Identification & suivi */}
          <Section icon="🧾" title="Dépense & suivi">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div className="sm:col-span-2 lg:col-span-3">
                <Field label="Description">
                  <input
                    className={MODAL_INPUT} value={draft.description} onChange={set('description')}
                    placeholder="ex. « Imprimante HP LaserJet M209 » ou « 3 bouteilles de détergent 5L »…"
                  />
                </Field>
              </div>
              <Field label="Suivi / Statut" hint="Valeur commune « suivi » et « statut » (statut « BC signé » = engagement suivi par la page Recettes).">
                <input
                  className={MODAL_INPUT} value={draft.statut} onChange={set('statut')} list="depenses-statuts"
                  placeholder="ex. BC signé"
                />
                <datalist id="depenses-statuts">
                  {(statutOptions || []).map((s) => <option key={s} value={s} />)}
                </datalist>
              </Field>
              <Field label="Demandeur">
                <input
                  className={MODAL_INPUT} value={draft.demandeur} onChange={set('demandeur')} list="depenses-demandeurs"
                  placeholder="Prénom Nom"
                />
                <datalist id="depenses-demandeurs">
                  {(demandeurNames || []).map((n) => <option key={n} value={n} />)}
                </datalist>
              </Field>
              <Field label="Catégorie">
                <select className={MODAL_INPUT} value={draft.categorie} onChange={set('categorie')}>
                  <option value="">— non précisée —</option>
                  {(types || []).map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <div className="lg:col-span-2">
                <Field label="Ligne budgétaire (recette)" hint="Choisissez une ligne existante ou tapez librement son code/intitulé ; la liaison se fait automatiquement à l’enregistrement.">
                  <div className="flex gap-2">
                    <select className={`${MODAL_INPUT} w-2/5 shrink-0`} value={draft.recetteId || ''} onChange={pickRecette}>
                      <option value="">… choisir une ligne</option>
                      {(recettes || []).map((r) => <option key={r.id} value={r.id}>{r.ligne}</option>)}
                    </select>
                    <input
                      className={MODAL_INPUT} value={draft.ligneBudgetaire} onChange={editLigne}
                      placeholder="ex. S2R01GEC (INTRUDE)"
                    />
                  </div>
                </Field>
              </div>
              <Field label="Classification / nature">
                <select className={MODAL_INPUT} value={draft.classification} onChange={set('classification')}>
                  <option value="">— non précisée —</option>
                  {(natures || []).map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </Field>
            </div>
          </Section>
          {/* B. Commande & fournisseur */}
          <Section icon="🛒" title="Commande & fournisseur">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <Field label="Montant HT (€)">
                <input
                  className={MODAL_INPUT} value={draft.montant} onChange={set('montant')} inputMode="decimal"
                  placeholder="ex. 129,90"
                />
              </Field>
              <Field label="Frais de port (€)">
                <input
                  className={MODAL_INPUT} value={draft.fraisPort} onChange={set('fraisPort')} inputMode="decimal"
                  placeholder="ex. 8,50 — vide si 0"
                />
              </Field>
              <Field label="Date de la demande">
                <input className={MODAL_INPUT} type="date" value={draft.dateDemande} onChange={set('dateDemande')} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Nom du fournisseur">
                  <input
                    className={MODAL_INPUT} value={draft.fournisseur} onChange={set('fournisseur')} list="depenses-fournisseurs"
                    placeholder="ex. Amazon Marketplace / Fournitures Laposte…"
                  />
                  <datalist id="depenses-fournisseurs">
                    {(fournisseurNames || []).map((n) => <option key={n} value={n} />)}
                  </datalist>
                </Field>
              </div>
              <Field label="Contact fournisseur">
                <input
                  className={MODAL_INPUT} value={draft.contact} onChange={set('contact')} list="depenses-contacts"
                  placeholder="ex. Amazon / nom + email"
                />
                <datalist id="depenses-contacts">
                  {(contactNames || []).map((n) => <option key={n} value={n} />)}
                </datalist>
              </Field>
            </div>
          </Section>
          {/* C. Documents & dates */}
          <Section icon="📎" title="Documents & dates — liens ↗ facultatifs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2 lg:col-span-1">
                <Field label="N° devis">
                  <div className="flex gap-1.5">
                    <input className={MODAL_INPUT} value={draft.numDevis} onChange={set('numDevis')} placeholder="ex. 482750394" />
                    <input
                      className={MODAL_URL_INPUT} value={draft.numDevisUrl} onChange={set('numDevisUrl')}
                      placeholder="🔗 lien doc." title="Lien vers le devis (PDF, dossier…) — collé ou « Lien → Code »"
                    />
                  </div>
                </Field>
              </div>
              <div className="sm:col-span-2 lg:col-span-1">
                <Field label="N° SIFAC">
                  <input className={MODAL_INPUT} value={draft.numSIFAC} onChange={set('numSIFAC')} placeholder="ex. 2026000000" />
                </Field>
              </div>
              <div className="sm:col-span-2 lg:col-span-1">
                <Field label="N° BC">
                  <div className="flex gap-1.5">
                    <input className={MODAL_INPUT} value={draft.numBC} onChange={set('numBC')} placeholder="ex. R20180912" />
                    <input
                      className={MODAL_URL_INPUT} value={draft.numBCUrl} onChange={set('numBCUrl')}
                      placeholder="🔗 lien doc." title="Lien vers le bon de commande"
                    />
                  </div>
                </Field>
              </div>
              <div className="sm:col-span-2 lg:col-span-1">
                <Field label="Date BC">
                  <input className={MODAL_INPUT} type="date" value={draft.dateBC} onChange={set('dateBC')} />
                </Field>
              </div>
              <div className="sm:col-span-2 lg:col-span-1">
                <Field label="Date signature">
                  <input className={MODAL_INPUT} type="date" value={draft.dateSignature} onChange={set('dateSignature')} />
                </Field>
              </div>
              <div className="sm:col-span-2 lg:col-span-1">
                <Field label="Date approbation fournisseur">
                  <input className={MODAL_INPUT} type="date" value={draft.dateApprobFournisseur} onChange={set('dateApprobFournisseur')} />
                </Field>
              </div>
              <div className="sm:col-span-2 lg:col-span-1">
                <Field label="N° facture">
                  <div className="flex gap-1.5">
                    <input className={MODAL_INPUT} value={draft.numFacture} onChange={set('numFacture')} placeholder="ex. F-2026-0041" />
                    <input
                      className={MODAL_URL_INPUT} value={draft.numFactureUrl} onChange={set('numFactureUrl')}
                      placeholder="🔗 lien doc." title="Lien vers la facture"
                    />
                  </div>
                </Field>
              </div>
              <div className="sm:col-span-2 lg:col-span-1">
                <Field label="N° OM / paiement">
                  <div className="flex gap-1.5">
                    <input className={MODAL_INPUT} value={draft.omNo} onChange={set('omNo')} placeholder="ex. OM 2026-124" />
                    <input
                      className={MODAL_URL_INPUT} value={draft.omUrl} onChange={set('omUrl')}
                      placeholder="🔗 lien doc." title="Lien vers l’ordre de paiement / mandatement"
                    />
                  </div>
                </Field>
              </div>
            </div>
          </Section>
          {/* D. Livraisons */}
          <Section icon="🚚" title="Livraisons (réception / BL / service fait / SF)">
            <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
              <p className="text-[11px] text-slate-500">
                Saisissez une ligne par colis reçu ou service effectué — dans l’ordre du classeur :
                <b> date réception colis, n° BL, date service fait, n° SF</b> (liens 🔗 facultatifs).
              </p>
              <span className="text-[10px] font-black uppercase text-slate-400">
                {previewLivs.length} phase{previewLivs.length > 1 ? 's' : ''} · {previewReceived} reçue{previewReceived > 1 ? 's' : ''}
              </span>
            </div>

            <div className="flex flex-col gap-2">
              {draft.livraisons.map((l, i) => (
                <div key={`liv-${i}`} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-black uppercase tracking-wide text-slate-400">
                      Livraison n°{i + 1}
                    </span>
                    <button
                      type="button" onClick={() => removeLiv(i)} title="Retirer cette ligne de livraison"
                      className="text-[10px] font-bold text-red-400 hover:text-red-600 hover:bg-red-50 border border-transparent hover:border-red-200 rounded-lg px-2 py-1"
                    >✕ retirer</button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                    <Field label="Date réception colis">
                      <input className={MODAL_INPUT} type="date" value={l.dateReception} onChange={setLiv(i, 'dateReception')} />
                    </Field>
                    <Field label="N° BL">
                      <input className={MODAL_INPUT} value={l.numBL} onChange={setLiv(i, 'numBL')} placeholder="ex. 1ZW406671209184527" />
                    </Field>
                    <Field label="Date service fait">
                      <input className={MODAL_INPUT} type="date" value={l.dateServiceFait} onChange={setLiv(i, 'dateServiceFait')} />
                    </Field>
                    <Field label="N° SF">
                      <input className={MODAL_INPUT} value={l.numSF} onChange={setLiv(i, 'numSF')} placeholder="ex. 2018/11/0170" />
                    </Field>
                    <div className="sm:col-span-2 lg:col-span-2">
                      <Field label="BL — lien document">
                        <input
                          className={MODAL_URL_INPUT} value={l.numBLUrl} onChange={setLiv(i, 'numBLUrl')}
                          placeholder="🔗 lien vers le bon de livraison"
                        />
                      </Field>
                    </div>
                    <div className="sm:col-span-2 lg:col-span-2">
                      <Field label="SF — lien document">
                        <input
                          className={MODAL_URL_INPUT} value={l.numSFUrl} onChange={setLiv(i, 'numSFUrl')}
                          placeholder="🔗 lien vers le service fait / PV de réception"
                        />
                      </Field>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button" onClick={addLiv}
              className="mt-2 text-xs font-black text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl px-3 py-2"
            >+ Ajouter une autre livraison</button>

            <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex items-start gap-2">
                <div className="mt-0.5 shrink-0"><CompleteBadge value={previewComplete} /></div>
                <div className="text-[11px] text-slate-600 leading-relaxed">
                  {previewLivs.length === 0 ? (
                    <>
                      <b>Aucune phase renseignée.</b> Si cette commande n’attend pas de colis (prestation, inscription,
                      réparation sur place…), cochez ci-dessous pour la déclarer complète :
                    </>
                  ) : allReceived(previewLivs) ? (
                    <>
                      Toutes les <b>{previewLivs.length}</b> livraison{previewLivs.length > 1 ? 's' : ''} renseignée{previewLivs.length > 1 ? 's' : ''} ont leur
                      date de réception : la dépense est automatiquement marquée <b>« Livraison complète »</b> à l’enregistrement.
                    </>
                  ) : (
                    <>
                      <b>{previewLivs.length - previewReceived}</b> livraison{previewLivs.length - previewReceived > 1 ? 's' : ''} sans date de réception :
                      la dépense restera marquée <b>« En attente »</b> (livraison non complète) tant que toutes les dates ne sont pas saisies.
                    </>
                  )}
                </div>
              </div>
              {previewLivs.length === 0 && (
                <label className="flex items-start gap-2 mt-2 text-[11px] text-slate-600 cursor-pointer">
                  <input
                    type="checkbox" checked={draft.noParcelsComplete} onChange={setCheck('noParcelsComplete')}
                    className="mt-0.5 accent-blue-600"
                  />
                  <span>
                    <b>Commande sans colis</b> — tout a été livré / effectué sans réception de colis à suivre
                    (inscription à un congrès, abonnement, prestation, paiement direct…).
                  </span>
                </label>
              )}
            </div>
          </Section>
          {/* E. ENT & commentaires */}
          <Section icon="💬" title="ENT & commentaires">
            <div className="grid grid-cols-1 gap-3">
              <label className="flex items-start gap-2 text-[12px] text-slate-700 cursor-pointer">
                <input
                  type="checkbox" checked={draft.nonComptabiliseEnt} onChange={setCheck('nonComptabiliseEnt')}
                  className="mt-0.5 accent-blue-600"
                />
                <span>
                  Dépense <b>non comptabilisée sur ENT</b> (stock : « pas décompté sur ENT ») — les achats comptés sur ENT
                  (détergents, gants…) apparaissent en stock.
                </span>
              </label>
              {draft.ent && !/pas d[eé]compt/i.test(draft.ent) && (
                <p className="text-[10px] text-slate-400 -mt-1">
                  Valeur déjà présente dans la colonne ENT du classeur, conservée : <b>{draft.ent}</b>
                </p>
              )}
              <Field label="Commentaires (optionnel)">
                <textarea
                  className={`${MODAL_INPUT} min-h-[54px]`} value={draft.commentaires} onChange={set('commentaires')}
                  placeholder="Éventuelles remarques (retard fournisseur, échange SAV…)"
                />
              </Field>
              {rec && (
                <p className="text-[10px] text-slate-400 -mt-1">
                  Créée {rec.createdAt ? `le ${toFrDate(isoOf(new Date(rec.createdAt).toISOString()))}` : ''}{' '}
                  {rec.createdBy && txt(rec.createdBy.name) ? `par ${txt(rec.createdBy.name)}` : ''}
                  {auditor ? ` · Dernière modification : ${auditor.trim()}` : ''}
                </p>
              )}
            </div>
          </Section>
        </div>

        <div className="px-4 py-3 border-t border-slate-200 flex justify-end gap-2 bg-slate-50 shrink-0">
          <button
            type="button" onClick={onCancel}
            className="px-4 py-2 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-200 bg-slate-100"
          >Annuler</button>
          <button
            type="button" onClick={() => onSave(draft, rec && rec.id)}
            className="px-5 py-2 rounded-xl text-sm font-bold text-white bg-blue-600 hover:bg-blue-700"
          >{editing ? 'Enregistrer les modifications' : 'Enregistrer la dépense'}</button>
        </div>
      </div>
    </div>
  );
};
export { DepensesPage };














