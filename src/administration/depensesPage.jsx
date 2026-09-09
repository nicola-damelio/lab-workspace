/* =========================================================================
   src/administration/depensesPage.jsx
   Page « Dépenses » — dépenses / bons de commande (CRUD complet).

   Page dédiée qui remplace l’ancienne liste en lecture seule : ajout, édition
   et suppression de chaque dépense, avec TOUTES les colonnes de l’onglet
   « Dépenses » du classeur Google Sheets du laboratoire :

     Suivi/Statut · ENT · Description · Demandeur · Catégorie · Classification
     · Ligne budgétaire · Montant HT · Frais de port · Date demande ·
     Nom du fournisseur · Contact · N° devis · N° SIFAC/D.A. · Date BC · N° BC ·
     Date signature devis · Date signature · Date approb. fournisseur ·
     N° facture · Livraisons en plusieurs phases (date réception colis,
     n° BL, date service fait, n° SF) · Livraison complète · Commentaires.

    La page est divisée en CINQ onglets, chacun restreint à ses colonnes
    pertinentes :
      • « Achats » — dépenses dont le fournisseur n’est pas « PI » (cycle
        devis → SIFAC/BC → livraisons → facture, mêmes colonnes que le classeur) ;
      • « Prestations internes » (PI) — dépenses dont le fournisseur est « PI » :
        service interne facturé SANS bon de commande, colonnes réduites à
        l’essentiel (pas de devis / BC / SIFAC ni de suivi de livraisons) ;
      • « OM » — lignes de type « om » de la collection `depenses` (dépenses liées
        à un ordre de mission accepté) : tableau INDÉPENDANT de la collection om —
        un OM « Acceptée » de la page « OM prévus / souhaités » y est transféré
        via son bouton « → Dépenses », et chaque ligne peut ensuite être déplacée
        entre les onglets Achats / PI / OM (colonne « Déplacer… ») ;
      • « Rémunération stages » — dépenses dont la « Classification / nature »
        est « Stages » (gratifications de stagiaires) : mêmes colonnes que les
        Achats. Elles sont retirées des autres onglets et alimentent la
        colonne « Stages » de la page Recettes (déduite de la « Dispo
        université » dans le calcul du solde).
      • « Remboursements » — registre INDÉPENDANT de la table Dépenses
        (collection `reimbursements`) : frais avancés par un membre puis
        remboursés par le laboratoire. Formulaire sur le modèle d’un OM prévu
        (dates, bénéficiaire, coûts détaillés) — NI devis, NI N° SIFAC/D.A.,
        NI BC, NI fournisseur. Un remboursement reste dans son registre, même
        une fois le remboursement effectué : il ne migre jamais vers les
        onglets Achats / PI / OM. La page Recettes le décompte dans sa
        colonne « Remboursements » (déduite de la « Dispo université » dans le
        calcul du solde). Les anciennes lignes du classeur classées
        « Remboursements » sont rapatriées ici automatiquement.

   Modèle stocké (mêmes clés que l’import Google Sheets) :
     { type: 'achat' | 'pi' | 'om', suivi, statut, ent, nonComptabiliseEnt,
       description, demandeur, categorie, classification, ligneBudgetaire,
       recetteId, montant, fraisPort, dateDemande, fournisseur, contact,
       numDevis, numDevisUrl, numSIFAC, dateBC, numBC, numBCUrl, dateSignature,
       dateSignatureDevis, dateApprobFournisseur, numFacture, numFactureUrl,
       omNo, omUrl, omId, destination, dateMission, dateRetour,
       livraisonComplete, livraisons: [{ dateReception, numBL, numBLUrl,
       dateServiceFait, numSF, numSFUrl }], commentaires }
     + enveloppe d’audit posée par upsert() (createdAt/By, updatedAt/By).
     Le type « om » est stocké explicitement ; sinon il se déduit du fournisseur
     « PI » (voir depenseKindOf dans adminSchema.js).

   « Livraison complète » passe automatiquement à « Oui » dès que toutes les
   phases renseignées ont leur date de réception (sinon « Non »). Une commande
   sans colis à suivre (prestation, inscription…) peut être déclarée complète
   manuellement via la case « sans colis » du formulaire.

   À l’enregistrement, les documents Google Drive liés (champs « lien document »
   devis, BC, facture, OM, BL/SF) sont automatiquement RANGÉS sur Google Drive
   dans le dossier du dataset › Budget_labo/<année courante>/Devis|BC|BL|OM|Factures
   (dossiers créés si besoin) — voir ./driveFiling.js.
   ========================================================================= */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAdmin } from './AdminContext';
import { SmartTable } from './smartTable';
import { AdminImportModal } from './adminImportModal';
import { toFrDate } from './congesDates';
import { relinkDepenseDocuments, depenseDocSlots } from './budgetLink';
import {
  RECETTE_TYPES, DEPENSE_NATURES, DEPENSE_STATUSES, DEPENSE_FOURNISSEUR_PI,
  isPiFournisseur, depenseKindOf, DEPENSE_KIND_META, DEPENSE_FIELD_LABEL,
  DEFAULT_DEPENSE_MANDATORY, ADMIN_PAGES,
  REIMBURSEMENT_COST_FIELDS, reimbTotalOf, SERVICE_DEMANDEUR,
} from './adminSchema';
import { parseEuroAmount } from './importUtils';
import { fileBudgetDocs, budgetDocPath, budgetDocFileName, budgetDocLinkSlots, BUDGET_DOC_FOLDER_BY_FIELD } from './driveFiling';
import { uploadLocalFile, cloudBackendAvailable, sharedWorkspaceMode } from '../utils/driveUpload';
import { reimportBudgetDriveDocs } from './driveReimport';
import { findRecetteByLabel, findRecetteTwin, sameCatType } from './recetteLink';
import { useDepenseLinkRepair } from './useDepenseLinkRepair';

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
const todayIso = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const addScheme = (u) => {
  const s = txt(u);
  if (!s) return '';
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`;
};
const norm = (s) => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/* « Rémunération stages » : dépenses dont la « Classification / nature »
   (`classification`, valeur « Stages » du sélecteur) correspond à une
   gratification de stagiaire. Ces lignes sont retirées des onglets
   Achats / PI / OM et listées dans l’onglet « Rémunération stages » — la page
   Recettes les décompte dans sa colonne « Stages », déduite du solde (jamais
   comptées deux fois : elles ne sont pas non plus dans « Achats (BC signé) » /
   « Prestations internes » / « OM payés »). */
const isStageNature = (v) => {
  const s = txt(v).toLowerCase();
  if (!s) return false;
  // « Stages », « Stage », « Rémunération stages »… → toute valeur contenant « stage(s) ».
  return /(^|[^a-zà-ÿ])stages?([^a-zà-ÿ]|$)/.test(s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
};
const isStageDepense = (d) => isStageNature(d && (d.classification || d.nature));

/* « Remboursements » (collection `reimbursements`, onglet du même nom) : frais
   avancés par un membre puis remboursés par le laboratoire. Registre
   INDÉPENDANT de la table Dépenses — jamais de devis / N° SIFAC/D.A. / BC /
   fournisseur, et jamais de migration vers les onglets Achats / PI / OM. La
   détection ci-dessous ne sert plus qu’au RAPATRIEMENT des anciennes lignes
   Dépenses classées « Remboursements » (import du classeur) vers le registre
   dédié, opéré automatiquement par AdminContext. */
const isReimbNature = (v) => {
  const s = txt(v).toLowerCase();
  if (!s) return false;
  // « Remboursements », « Remboursement », « Remboursé », « Reimbursement »…
  // → toute valeur contenant « rembours… » / « reimburs… ».
  return /(^|[^a-zà-ÿ])(rembours\w*|reimburs\w*)([^a-zà-ÿ]|$)/.test(s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
};
const isReimbDepense = (d) => isReimbNature(d && (d.classification || d.nature));

/* Prestation interne (PI) : service interne facturé SANS bon de commande — ni
   N° BC, ni N° SIFAC. Ces champs « commande » n’ont donc pas d’objet pour une
   PI : on ne les exigera jamais, même s’ils sont cochés dans Paramètres ›
   Champs obligatoires. */
const PI_NO_COMMAND_FIELDS = ['numBC', 'numSIFAC'];
/** Vrai pour une ligne / un brouillon de prestation interne : fournisseur
 *  « PI » (ou « prestation interne ») ou type canonique « pi ». */
const isPiEntry = (d) => depenseKindOf(d) === 'pi' || isPiFournisseur(d && d.fournisseur);

/* ── Champs obligatoires (configurés dans Paramètres) ─────────────────────
   Valeur « présente » d’un champ d’une dépense : vide → champ manquant. */
const mandatoryValueOf = (rec, key) => {
  const r = rec || {};
  if (key === 'ligne') return txt(r.recetteId) || txt(r.ligneBudgetaire);
  if (key === 'statut') return pick(r, ['statut', 'suivi']);
  if (key === 'montant') {
    const m = r.montant;
    return m === null || m === undefined || m === '' ? '' : String(m).trim();
  }
  const v = r[key];
  return v === null || v === undefined ? '' : String(v).trim();
};
const mandatoryLabelOf = (k) => DEPENSE_FIELD_LABEL[k] || k;

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
   le fait l’import (« S2R01GEC (INTRUDE) » → ligne correspondante).
   `type` (Fonctionnement / Investissement) restreint la recherche à la
   catégorie de la dépense — on ne relie JAMAIS vers une fiche de l’autre
   type : la dépense serait sinon comptée sur la mauvaise ligne de la page
   Recettes. */
const findRecetteId = (recettes, label, type) => {
  const found = findRecetteByLabel(recettes, label, type);
  return found ? found.id : '';
};

/* Options « Ligne budgétaire » uniques pour le sélecteur : une même ligne peut
   exister en deux fiches (Fonctionnement et Investissement) — on n’en propose
   qu’une seule dans la liste, en privilégiant celle dont le type correspond à
   la « Catégorie » déjà choisie (la catégorie est un champ séparé du formulaire). */
const uniqueRecetteOptions = (recettes, categorie, currentId) => {
  const want = txt(categorie);
  const byKey = new Map();
  (Array.isArray(recettes) ? recettes : []).forEach((r) => {
    if (!r || !r.id) return;
    const key = norm(r.ligne) || r.id;
    if (r.id === currentId) { byKey.set(key, r); return; }
    const existing = byKey.get(key);
    if (!existing) { byKey.set(key, r); return; }
    const eMatches = want && txt(existing.type) === want;
    const nMatches = want && txt(r.type) === want;
    if (nMatches && !eMatches) byKey.set(key, r);
  });
  return [...byKey.values()];
};

/* ── Petits éléments d’affichage ────────────────────────────────────────── */
const TONES = {
  slate: 'bg-slate-100 border-slate-200 text-slate-600',
  blue: 'bg-blue-50 border-blue-200 text-blue-700',
  sky: 'bg-sky-50 border-sky-200 text-sky-700',
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

/* « Etat » d’une dépense — déduit automatiquement des documents saisis, la
   première condition vraie l’emporte (du plus avancé au moins avancé) :
     « Livraison complète » = Oui → « Complète »
     n° SF            → « service fait »
     n° BL            → « Colis partiellement livré »
     n° facture       → « Facture signé »
     date approbation fournisseur → « Validé par le fournisseur »
     date signature BC → « BC signé »
     date signature devis → « Devis signé »
   La colonne « Etat » (lecture seule) est en tête du tableau. */
const hasLivraisonField = (r, keys) => {
  const arr = Array.isArray(r && r.livraisons) ? r.livraisons : [];
  return arr.some((l) => l && keys.some((k) => txt(l[k])));
};
const etatOf = (r) => {
  if (!r) return '';
  if (txt(r.livraisonComplete).toLowerCase() === 'oui') return 'Complète';
  if (pick(r, ['numSF', 'sfNo']) || hasLivraisonField(r, ['numSF', 'sfNo'])) return 'service fait';
  if (pick(r, ['numBL', 'blNo']) || hasLivraisonField(r, ['numBL', 'blNo'])) return 'Colis partiellement livré';
  if (pick(r, ['numFacture', 'factureNo'])) return 'Facture signé';
  if (pick(r, ['dateApprobFournisseur', 'dateAcceptationFournisseur'])) return 'Validé par le fournisseur';
  if (pick(r, ['dateSignature', 'dateSignatureBC'])) return 'BC signé';
  if (pick(r, ['dateSignatureDevis', 'dateDevis'])) return 'Devis signé';
  return '';
};
const etatTone = (v) => ({
  'Complète': 'emerald',
  'service fait': 'sky',
  'Colis partiellement livré': 'amber',
  'Facture signé': 'blue',
  'Validé par le fournisseur': 'indigo',
  'BC signé': 'indigo',
  'Devis signé': 'slate',
}[txt(v)] || 'slate');
const EtatBadge = ({ value }) =>
  txt(value) ? <Badge tone={etatTone(value)}>{txt(value)}</Badge> : <span className="text-slate-300">—</span>;

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

/* Cellule « Livraisons » : quand une commande a plusieurs phases de livraison,
   seule la ligne de synthèse (« N phases · colis reçus ») est affichée tant
   que le détail est replié — ainsi la ligne reste aussi compacte que les
   autres lignes achats, quel que soit le nombre de phases. Un bouton
   « Détails » permet d’étendre la liste. */
const LivraisonsCell = ({ livs }) => {
  const kept = keepLivraisons(livs);
  const [expanded, setExpanded] = useState(false);
  if (!kept.length) return <span className="text-slate-300">—</span>;
  const received = kept.filter((l) => txt(l.dateReception)).length;
  const multi = kept.length > 1;
  const showDetails = !multi || expanded;
  const sub = (d) => {
    const fr = toFrDate(d);
    return fr
      ? <span className="whitespace-nowrap text-[11px] font-semibold text-slate-600">{fr}</span>
      : <span className="text-slate-300">—</span>;
  };
  return (
    <div className="min-w-[300px]">
      <div className={`flex items-center gap-2 ${showDetails ? 'mb-1' : ''}`}>
        <span className="font-black text-slate-700 text-xs">{kept.length} phase{multi ? 's' : ''}</span>
        <span className="text-[10px] text-slate-400">{received}/{kept.length} colis reçu{received > 1 ? 's' : ''}</span>
        {multi && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="ml-auto text-[10px] font-black px-2 py-0.5 rounded-md border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
            title={expanded ? 'Replier les phases' : 'Voir le détail de chaque phase'}
          >
            {expanded ? 'Replier ▴' : 'Détails ▾'}
          </button>
        )}
      </div>
      {showDetails && (
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
      )}
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
  const {
    data, settings, upsert, remove, currentUser,
    access, navigate, focus, clearFocus, updateMany,
  } = useAdmin();
  const list = useMemo(() => (Array.isArray(data.depenses) ? data.depenses : []), [data.depenses]);
  const recettes = useMemo(() => (Array.isArray(data.recettes) ? data.recettes : []), [data.recettes]);
  const personnel = useMemo(() => (Array.isArray(data.personnel) ? data.personnel : []), [data.personnel]);
  const librerie = useMemo(() => (Array.isArray(data.librerie) ? data.librerie : []), [data.librerie]);
  /* Registre « Remboursements » — collection dédiée, indépendante de la table
     Dépenses (ni devis, ni BC/SIFAC ; jamais de migration vers les autres
     onglets). Les fiches sont saisies sur le modèle d’un OM prévu. */
  const reimbRecords = useMemo(
    () => (Array.isArray(data.reimbursements) ? data.reimbursements : []),
    [data.reimbursements]
  );

  const [modal, setModal] = useState(null); // { rec } | null
  const [importOpen, setImportOpen] = useState(false);
  /* Onglet actif : 'achats' | 'pi' | 'om' | 'stages' — voir le regroupement plus bas. */
  const [tab, setTab] = useState('achats');
  /* Rangement « à la demande » des documents liés (bouton « Ranger les liens »). */
  const [filingBusy, setFilingBusy] = useState(false);
  /* Ré-import des documents que l'app ne voit pas (déposés à la main — limite
     « drive.file ») : téléchargement public + dépôt d'une copie de l'app. */
  const [reimportBusy, setReimportBusy] = useState(false);
  const [reimportProgress, setReimportProgress] = useState(null); // { done, total }

  /* Réattribution automatique des dépenses dont la « Catégorie » contredit le
     type de la ligne budgétaire imputée (page Recettes) — voir le hook. */
  const linkRepair = useDepenseLinkRepair();

  /* Après un import « Dépenses » depuis un fichier (ou l’ouverture de la page),
     on rétablit automatiquement les liens des documents Google Drive dont seul
     le numéro a été importé : recherche par N° dans Budget_labo/<année>/… — les
     numéros redeviennent cliquables. La signature évite de relancer le scan en
     boucle : les liens retrouvés font changer la signature, et les documents
     introuvables restent silencieux jusqu’au prochain changement des lignes. */
  const budgetRelinkSigRef = useRef('');
  useEffect(() => {
    const sig = JSON.stringify(list.map((r) => depenseDocSlots(r)
      .map((s) => `${s.code}|${s.urlField}|${s.livraisonIndex === undefined ? '' : s.livraisonIndex}`)
      .join('§')));
    if (!sig || sig === budgetRelinkSigRef.current) return;
    budgetRelinkSigRef.current = sig;
    let cancelled = false;
    (async () => {
      try {
        const { updates } = await relinkDepenseDocuments(list);
        if (!cancelled && updates.length) updateMany('depenses', updates);
      } catch (err) {
        console.warn('Restauration des liens budget impossible :', err && err.message);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);

  /* Ligne « cible » d’une navigation inter-page (bouton « → Dépenses » de la
     page OM) : on bascule sur son onglet puis on la surligne dans le tableau. */
  const [focusRow, setFocusRow] = useState(null);

  /* Pages cibles des liens « vers la bibliothèque » (Librerie / Personnel) —
     le lien n’est actif que si le profil de l’utilisateur peut ouvrir la page. */
  const canViewLibrerie = useMemo(
    () => !!ADMIN_PAGES.find((p) => p.id === 'librerie' && access.canViewPage(p)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [access]
  );
  const canViewPersonnel = useMemo(
    () => !!ADMIN_PAGES.find((p) => p.id === 'personnel' && access.canViewPage(p)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [access]
  );
  const canViewOm = useMemo(
    () => !!ADMIN_PAGES.find((p) => p.id === 'om' && access.canViewPage(p)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [access]
  );
  const goToLibrerie = (kind, recordId) => {
    if (!canViewLibrerie || !recordId) return;
    if (typeof navigate === 'function') navigate('librerie', { kind, recordId });
  };
  const goToPersonnel = (personId) => {
    if (!canViewPersonnel || !personId) return;
    if (typeof navigate === 'function') navigate('personnel', { kind: 'person', recordId: personId });
  };

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
    set.add(SERVICE_DEMANDEUR); // demandeur collectif « Service » (visible par tous sur la page Approbation devis & BC)
    return [...set].sort((a, b) => a.localeCompare(b, 'fr'));
  }, [personnel, list, currentUser]);

  const fournisseurNames = useMemo(() => {
    const set = new Set([DEPENSE_FOURNISSEUR_PI]); // « PI » = prestation interne (dépense comptée sans BC signé)
    librerie.forEach((l) => {
      const n = pick(l, ['fournisseur', 'nomFournisseur', 'nom', 'name']);
      if (n) set.add(n);
    });
    list.forEach((r) => {
      if (txt(r.fournisseur)) set.add(txt(r.fournisseur));
    });
    const pi = DEPENSE_FOURNISSEUR_PI;
    const others = [...set].filter((n) => n !== pi).sort((a, b) => a.localeCompare(b, 'fr'));
    return [pi, ...others]; // « PI » toujours proposé en tête de la liste
  }, [librerie, list]);

  const ligneLabelOf = (r) => {
    const found = recettes.find((x) => x.id === r.recetteId);
    return found ? found.ligne : txt(r.ligneBudgetaire);
  };

  /* Index de recherche pour les liens vers les fiches « bibliothèque ». */
  const librerieById = useMemo(() => new Map(librerie.map((l) => [l.id, l])), [librerie]);
  const recettesById = useMemo(() => new Map(recettes.map((r) => [r.id, r])), [recettes]);
  const fournisseurByKey = useMemo(() => {
    const map = new Map();
    librerie.forEach((l) => {
      const k = norm(pick(l, ['fournisseur', 'nomFournisseur', 'nom', 'name']));
      if (k) map.set(k, l);
    });
    return map;
  }, [librerie]);
  const recetteOf = (r) => (r && r.recetteId ? (recettesById.get(r.recetteId) || null) : null);
  const fournisseurEntryOf = (r) => {
    if (!r) return null;
    const direct = r.fournisseurId ? librerieById.get(r.fournisseurId) : null;
    if (direct) return direct;
    const k = norm(txt(r.fournisseur));
    return k ? (fournisseurByKey.get(k) || null) : null;
  };
  const personnelByKey = useMemo(() => {
    const map = new Map();
    personnel.forEach((p) => {
      ['nom', 'prenom', 'name'].forEach((k) => {
        const key = norm(p && p[k]);
        if (key && !map.has(key)) map.set(key, p);
      });
    });
    return map;
  }, [personnel]);
  const personEntryOf = (r) => {
    const k = norm(txt(r && r.demandeur));
    return k ? (personnelByKey.get(k) || null) : null;
  };
  /* Gestion d’une éventuelle cible de navigation vers cette page (Dépenses) :
     focus.kind === 'depense' → on ouvre l’onglet de la famille de la dépense
     et on surligne la ligne correspondante (même mécanique que la Librairie). */
  useEffect(() => {
    if (!focus || focus.pageId !== 'depenses') return;
    const rid = focus.recordId;
    if (rid) {
      const reimb = reimbRecords.find((x) => x.id === rid);
      if (reimb) {
        setTab('remboursements');
        setFocusRow(rid);
      } else {
        const dep = (Array.isArray(data.depenses) ? data.depenses : []).find((d) => d.id === rid);
        if (dep) {
          setTab(isStageDepense(dep) ? 'stages' : depenseKindOf(dep));
          setFocusRow(rid);
        }
      }
    }
    clearFocus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  /* Champs obligatoires configurés dans Paramètres (clés de DEPENSE_FIELD_CATALOG).
     Indéfini = valeurs par défaut ; [] explicite = aucun champ obligatoire. */
  const mandatoryFields = useMemo(() => {
    if (Array.isArray(settings.depenseMandatoryFields)) return settings.depenseMandatoryFields;
    return DEFAULT_DEPENSE_MANDATORY;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.depenseMandatoryFields]);
  const missingMandatoryFor = (r) => mandatoryFields.filter((k) =>
    !(k === 'fournisseur' && depenseKindOf(r) === 'om')
    // Remboursement de frais (avancés par un membre) : pas de fournisseur.
    && !(k === 'fournisseur' && isReimbDepense(r))
    // Prestation interne : aucun N° BC / N° SIFAC attendu (même s’ils sont
    // cochés dans Paramètres › Champs obligatoires).
    && !(isPiEntry(r) && PI_NO_COMMAND_FIELDS.includes(k))
    && !mandatoryValueOf(r, k));

  /* « Ranger les documents liés » — relance le classement Budget_labo/<année>/…
     sur TOUTES les dépenses (y compris celles saisies avant l’arrivée du
     classement automatique). Chaque document accessible est COPIÉ (jamais
     déplacé) dans le bon sous-dossier avec le nom de la convention ; un lien
     inaccessible reste en place avec l’explication (même règle qu’à
     l’enregistrement). */
  const runBudgetFiling = async () => {
    if (filingBusy) return;
    if (!cloudBackendAvailable()) {
      alert('Google Drive n’est pas connecté : connectez-le d’abord, puis relancez le rangement des documents.');
      return;
    }
    const recs = (Array.isArray(list) ? list : []).filter((r) => r && r.id);
    if (!recs.length) return;
    let copied = 0; let renamed = 0; let already = 0; let failed = 0;
    const reasons = [];
    setFilingBusy(true);
    try {
      for (const rec of recs) {
        const res = await fileBudgetDocs(rec, { year: new Date().getFullYear() });
        if (!res) continue;
        copied += res.copied || 0;
        renamed += res.renamed || 0;
        already += res.skipped || 0;
        failed += Array.isArray(res.failed) ? res.failed.length : 0;
        (Array.isArray(res.failed) ? res.failed : []).forEach((f) => {
          const label = txt(rec.description) || pick(rec, ['numBC', 'numSIFAC', 'numFacture']) || rec.id;
          reasons.push(`· « ${label} » — ${f.folder} : ${f.reason}`);
        });
      }
    } catch (err) {
      console.error(err);
      alert(`Erreur pendant le rangement : ${(err && err.message) || err}`);
      setFilingBusy(false);
      return;
    }
    setFilingBusy(false);
    if (copied === 0 && renamed === 0 && already === 0 && failed === 0) {
      alert('Aucun lien Google Drive à ranger : aucune dépense ne possède de document lié (devis, BC, facture, OM, BL/SF).');
      return;
    }
    const head = `Rangement terminé sur ${recs.length} dépense${recs.length > 1 ? 's' : ''} : `
      + `${copied} copie${copied > 1 ? 's' : ''} créée${copied > 1 ? 's' : ''} dans Budget_labo/${new Date().getFullYear()}/… (l’original reste en place) · `
      + `${renamed} fichier${renamed > 1 ? 's' : ''} renommé${renamed > 1 ? 's' : ''} selon la convention · `
      + `${already} déjà en place · ${failed} échec${failed > 1 ? 's' : ''}.`;
    alert([
      head,
      failed
        ? `\n\nDocuments non copiés dans Budget_labo (leur lien d’origine reste valide) :\n${reasons.slice(0, 15).join('\n')}${reasons.length > 15 ? `\n· … et ${reasons.length - 15} autre${reasons.length - 15 > 1 ? 's' : ''}` : ''}`
        : '',
    ].join(''));
  };

  /* « Ré-importer les documents Drive » — chaque document Google Drive lié que
     l'app ne voit pas (déposé à la main ; limite « drive.file ») est téléchargé
     par son adresse PUBLIQUE puis ré-téléversé comme copie de l'application
     dans Budget_labo/<année>/… ; le lien de la dépense bascule sur cette copie
     (l'original n'est jamais supprimé). Les documents déjà visibles par l'app
     ne sont pas touchés (« Ranger les liens Drive » les classe). */
  const runDriveReimport = async () => {
    if (reimportBusy || filingBusy) return;
    if (!cloudBackendAvailable()) {
      alert('Google Drive n’est pas connecté : connectez-le d’abord, puis relancez le ré-import des documents.');
      return;
    }
    const recs = (Array.isArray(list) ? list : []).filter((r) => r && r.id);
    if (!recs.length) return;
    const linkedSlots = recs.reduce((n, r) => n + budgetDocLinkSlots(r).length, 0);
    if (!linkedSlots) {
      alert('Aucun lien Google Drive à ré-importer : aucune dépense ne possède de document lié (devis, BC, facture, OM, BL/SF).');
      return;
    }
    const go = window.confirm(
      'Ré-importer les documents Google Drive invisibles pour l’application ?\n\n'
      + 'Pour chaque document lié déposé à la main (donc invisible sous l’autorisation « drive.file »), '
      + 'l’app télécharge le fichier par son adresse publique puis le ré-téléverse comme SA copie '
      + 'dans Budget_labo/<année>/… avec le nom de la convention. Le lien de la dépense bascule sur '
      + 'cette copie ; l’original n’est jamais supprimé.\n\n'
      + 'Prérequis : le dossier Google Drive concerné doit être partagé en « Toute personne disposant du lien ».'
    );
    if (!go) return;
    setReimportBusy(true);
    setReimportProgress(null);
    try {
      const res = await reimportBudgetDriveDocs(recs, {
        year: new Date().getFullYear(),
        concurrency: 3,
        onProgress: (p) => setReimportProgress(p || null),
      });
      if (Array.isArray(res.updates) && res.updates.length) {
        updateMany('depenses', res.updates);
      }
      const imported = res.imported || 0;
      const adopted = res.adopted || 0;
      const accessible = res.accessible || 0;
      const failed = Array.isArray(res.failed) ? res.failed.length : 0;
      if (imported + adopted + accessible + failed === 0) {
        alert('Aucun document à ré-importer : tous les documents liés sont déjà visibles par l’application (classez-les avec « Ranger les liens Drive ») ou aucun lien Google Drive valide n’a été trouvé.');
        return;
      }
      const lines = (Array.isArray(res.failed) ? res.failed : [])
        .map((f) => `· « ${f.label || 'dépense'} » — ${f.folder} : ${f.reason}`);
      const head = `Ré-import terminé sur ${recs.length} dépense${recs.length > 1 ? 's' : ''} : `
        + `${imported} copie${imported > 1 ? 's' : ''} créée${imported > 1 ? 's' : ''} pour l’application · `
        + `${adopted} reliée${adopted > 1 ? 's' : ''} à une copie déjà classée · `
        + `${accessible} déjà visible${accessible > 1 ? 's' : ''} par l’app (à classer via « Ranger les liens Drive ») · `
        + `${failed} échec${failed > 1 ? 's' : ''}.`;
      alert([
        head,
        failed
          ? `\n\nDocuments non ré-importés (leur lien d’origine reste valide) :\n${lines.slice(0, 15).join('\n')}${lines.length > 15 ? `\n· … et ${lines.length - 15} autre${lines.length - 15 > 1 ? 's' : ''}` : ''}\n\nCause la plus fréquente : le dossier n’est pas partagé en « Toute personne disposant du lien » (partagez-le puis relancez), ou le fichier n’est pas téléchargeable — dans ce cas utilisez « ⬆ PC » pour le document concerné.`
          : '',
      ].join(''));
    } catch (err) {
      console.error(err);
      alert(`Erreur pendant le ré-import : ${(err && err.message) || err}`);
    } finally {
      setReimportBusy(false);
      setReimportProgress(null);
    }
  };

  const sorted = useMemo(() => [...list].sort((a, b) => {
    const da = isoOf(a.dateDemande);
    const db = isoOf(b.dateDemande);
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return db.localeCompare(da);
  }), [list]);

  /* Regroupement par famille (TOUTES les lignes de ce tableau vivent dans la
     collection `depenses`) :
       · « Achats » — type achat (fournisseur « normal », cycle devis → BC → livraisons) ;
       · « Prestations internes » (PI) — fournisseur « PI », service interne sans BC ;
       · « OM » — type om : lignes liées à un ordre de mission (créées depuis la
         page « OM prévus / souhaités » ou saisies ici). Ce tableau est
         INDÉPENDANT de la collection om (il n’en rejoue pas les éléments) ;
       · « Rémunération stages » — lignes dont la « Classification / nature »
         est « Stages » (gratifications de stagiaires) : elles sortent des
         autres onglets et sont listées ici avec les mêmes colonnes que les
         Achats.
       Les remboursements, eux, vivent dans la collection DÉDIÉE
       `reimbursements` (registre indépendant, onglet « Remboursements ») —
       jamais dans `depenses` : une fiche de remboursement n’est pas un bon de
       commande et n’y migre jamais. */
  const stageRows = sorted.filter((r) => isStageDepense(r));
  const achatRows = sorted.filter((r) => depenseKindOf(r) === 'achat' && !isStageDepense(r) && !isReimbDepense(r));
  const piRows = sorted.filter((r) => depenseKindOf(r) === 'pi' && !isStageDepense(r) && !isReimbDepense(r));
  const omRows = sorted.filter((r) => depenseKindOf(r) === 'om' && !isStageDepense(r) && !isReimbDepense(r));
  /* Lignes du tableau Dépenses selon l’onglet (Achats / PI / OM / Stages).
     L’onglet « Remboursements » ne passe PAS ici : c’est un registre dédié
     (collection `reimbursements`) affiché par son propre tableau. */
  const depViewRows = tab === 'remboursements'
    ? []
    : (tab === 'pi' ? piRows : (tab === 'om' ? omRows : (tab === 'stages' ? stageRows : achatRows)));

  /* Fiches du registre « Remboursements », les plus récentes d’abord (départ /
     date de la demande, comme les OM). Chiffres de l’onglet : total déduit du
     solde dans la page Recettes (colonne « Remboursements »). */
  const reimbList = useMemo(() => [...reimbRecords].sort((a, b) => {
    const da = isoOf(a.dateMission) || isoOf(a.dateDemande);
    const db = isoOf(b.dateMission) || isoOf(b.dateDemande);
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return db.localeCompare(da);
  }), [reimbRecords]);

  /* Résumé du haut de page (restreint aux lignes de l’onglet de dépenses actif). */
  const buildSummary = (rows) => {
    const out = {
      count: 0, moneyCount: 0, total: 0,
      parcelsReceived: 0, parcelsTotal: 0, pendingCount: 0,
    };
    rows.forEach((d) => {
      out.count += 1;
      const m = numOf(d.montant);
      const p = numOf(d.fraisPort);
      if (m !== null || p !== null) {
        out.total += (m || 0) + (p || 0);
        out.moneyCount += 1;
      }
      const liv = keepLivraisons(d.livraisons);
      out.parcelsTotal += liv.length;
      out.parcelsReceived += liv.filter((l) => txt(l.dateReception)).length;
      if (liv.length && !allReceived(liv)) out.pendingCount += 1;
    });
    return out;
  };
  /* depViewRows est recalculé à chaque rendu (tableau de l’onglet actif) — la
     somme de l’onglet ne doit pas dépendre de son identité. */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const summary = useMemo(() => buildSummary(depViewRows), [depViewRows]);

  /* Chiffres du bloc OM : lignes de type om suivies dans CETTE page (indépendante
     de la collection om) — nombre de lignes, total des montants, facturées et
     lignes restant à facturer. */
  const omStats = useMemo(() => {
    const s = buildSummary(omRows);
    const factured = omRows.filter((r) => txt(r.numFacture)).length;
    return { ...s, factured, toInvoice: Math.max(0, s.count - factured) };
  }, [omRows]);

  /* Chiffres du bloc « Rémunération stages » (lignes classées « Stages »). */
  const stageStats = useMemo(() => {
    const s = buildSummary(stageRows);
    const factured = stageRows.filter((r) => txt(r.numFacture)).length;
    return { ...s, factured, toInvoice: Math.max(0, s.count - factured) };
  }, [stageRows]);

  /* Chiffres du registre « Remboursements » (collection dédiée, sans statut :
     chaque fiche décrit des frais avancés, intégralement déduits du solde des
     lignes budgétaires dans la page Recettes). */
  const reimbStats = useMemo(() => {
    let moneyCount = 0;
    let total = 0;
    reimbList.forEach((r) => {
      const t = reimbTotalOf(r);
      if (t > 0) {
        total += t;
        moneyCount += 1;
      }
    });
    const withoutLine = reimbList.filter((r) => !r.recetteId && !txt(r.ligneBudgetaire)).length;
    return { count: reimbList.length, moneyCount, total, withoutLine };
  }, [reimbList]);

  /* Enregistrement : normalise + valide, puis upsert (ou remove si absent). */
  const onSaveDepense = async (draft, existingId) => {
    const description = txt(draft.description);
    const numBC = txt(draft.numBC);
    const numFacture = txt(draft.numFacture);
    if (!description && !numBC && !numFacture && !txt(draft.numDevis)) {
      alert('Merci de renseigner au moins une description ou une référence (N° devis, BC ou facture).');
      return false;
    }
    // Champs obligatoires (Paramètres › Champs obligatoires) — sinon ligne rouge.
    // Le fournisseur n’est jamais exigé pour une ligne de type « OM », ni pour
    // un remboursement (frais avancés par un membre) ; une prestation interne
    // (PI) n’a ni N° BC ni N° SIFAC à fournir.
    const omRequested = txt(draft.type) === 'om';
    const reimbRequested = isReimbDepense(draft);
    const missing = mandatoryFields.filter((k) =>
      !(k === 'fournisseur' && (omRequested || reimbRequested))
      && !(isPiEntry(draft) && PI_NO_COMMAND_FIELDS.includes(k))
      // Le « Suivi / Statut » est calculé automatiquement pour une nouvelle
      // dépense : il n’est jamais exigé à la création.
      && !(k === 'statut' && !existingId)
      && !mandatoryValueOf(draft, k));
    if (missing.length) {
      alert(`Merci de renseigner le(s) champ(s) obligatoire(s) : ${missing.map(mandatoryLabelOf).join(', ')}.`);
      return false;
    }
    const statut = txt(draft.statut);
    const livraisons = keepLivraisons(draft.livraisons);
    const complete = completeValue(livraisons, draft.livraisonComplete, draft.noParcelsComplete);
    const ligneBudgetaire = txt(draft.ligneBudgetaire);
    const categorie = txt(draft.categorie);
    /* Ligne budgétaire imputée : la « Catégorie » (Fonctionnement /
       Investissement) doit correspondre au type de la fiche Recettes —
       sinon la dépense serait comptée sur la mauvaise ligne de la page
       Recettes. Si une fiche homonyme du bon type existe on bascule dessus ;
       sinon on refuse l’enregistrement avec un message explicite (l’utilisateur
       corrige la catégorie, choisit une autre ligne ou crée d’abord la fiche). */
    let recetteId = '';
    const explicit = draft.recetteId && recettes.some((r) => r.id === draft.recetteId)
      ? recettes.find((r) => r.id === draft.recetteId)
      : null;
    if (explicit) {
      if (!categorie || !txt(explicit.type) || sameCatType(categorie, explicit.type)) {
        recetteId = explicit.id;
      } else {
        const twin = findRecetteTwin(recettes, explicit, categorie);
        if (twin) {
          recetteId = twin.id;
        } else {
          alert(
            `Impossible d’enregistrer : la dépense est classée « ${categorie} » mais liée à la ligne « ${explicit.ligne || explicit.id} » (${explicit.type || 'type inconnu'}).\n\n`
            + `Aucune ligne budgétaire homonyme de type « ${categorie} » n’existe dans Recettes.\n`
            + `Corrigez la catégorie, choisissez une autre ligne, ou créez d’abord la ligne « ${categorie} » correspondante (page Recettes).`
          );
          return false;
        }
      }
    } else if (categorie) {
      const found = findRecetteByLabel(recettes, ligneBudgetaire, categorie);
      if (found) {
        recetteId = found.id;
      } else if (ligneBudgetaire && findRecetteByLabel(recettes, ligneBudgetaire)) {
        const other = findRecetteByLabel(recettes, ligneBudgetaire);
        alert(
          `Aucune ligne budgétaire de type « ${categorie} » ne correspond à « ${ligneBudgetaire} » — seule « ${other.ligne || other.id} » (${other.type || 'type inconnu'}) existe dans Recettes.\n\n`
          + `Corrigez la catégorie de la dépense ou créez d’abord la ligne budgétaire « ${categorie} » correspondante (page Recettes).`
        );
        return false;
      }
    } else {
      recetteId = findRecetteId(recettes, ligneBudgetaire);
    }
    const entPhrase = 'pas décompté sur ENT';
    const rawEnt = txt(draft.ent);
    const fournisseur = txt(draft.fournisseur);
    /* Famille canonique : « om » si demandée explicitement, sinon « pi » dès que
       le fournisseur est « PI », sinon « achat ». */
    const type = omRequested ? 'om' : (isPiFournisseur(fournisseur) ? 'pi' : 'achat');
    const patch = {
      type,
      description,
      demandeur: txt(draft.demandeur),
      categorie,
      classification: txt(draft.classification),
      ligneBudgetaire,
      recetteId: recetteId || '',
      montant: parseNum(draft.montant),
      fraisPort: parseNum(draft.fraisPort),
      dateDemande: isoOf(draft.dateDemande),
      fournisseur,
      numDevis: txt(draft.numDevis),
      numDevisUrl: txt(draft.numDevisUrl),
      numSIFAC: txt(draft.numSIFAC),
      dateBC: isoOf(draft.dateBC),
      numBC,
      numBCUrl: txt(draft.numBCUrl),
      dateSignature: isoOf(draft.dateSignature),
      dateSignatureDevis: isoOf(draft.dateSignatureDevis),
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

    /* Classement automatique des documents Google Drive liés dans
       Budget_labo/<année>/<Devis|BC|BL|OM|Factures> — best-effort, exécuté
       après la sauvegarde : un échec de classement ne bloque jamais
       l'enregistrement de la dépense (le lien d'origine est conservé). */
    const filing = await fileBudgetDocs(patch, { year: new Date().getFullYear() });
    /* Le lien reste valide et la dépense est enregistrée ; on n’alerte que
       lorsque Drive était connecté et qu’un document précis n’a pas pu être
       copié dans Budget_labo (sans Drive, le bouton « Ranger les liens Drive »
       le fera plus tard). */
    if (cloudBackendAvailable() && filing && filing.failed && filing.failed.length > 0) {
      const lines = filing.failed
        .map((f) => `· ${f.folder} : ${f.reason}`)
        .join('\n');
      const explain = filing.failed.some((f) => /INACCESSIBLE/i.test(String(f.reason || '')))
        ? (sharedWorkspaceMode()
          ? `\n\nLe plus rapide : « ⬆ PC » (l’app crée une copie dans Budget_labo/<année> et la range) — `
          + `un fichier resté dans votre Drive personnel n’est pas visible par le compte « Lab Workspace » qu’utilise l’app.`
          : `\n\nLe plus rapide : « ⬆ PC » (l’app crée sa propre copie dans Budget_labo/<année> et la range) — `
          + `même connecté à votre Google, l’app ne voit que les fichiers qu’elle a créés elle-même (autorisation limitée « drive.file »).`)
        + `\n\nPour traiter d’un coup TOUS les documents déjà déposés à la main, utilisez le bouton `
        + `« Ré-importer les documents Drive » de la page (téléchargement par le lien public, copie classée de l’app, `
        + `lien remplacé) — le dossier Google Drive doit être partagé en « Toute personne disposant du lien ».`
        : '';
      alert(
        `Dépense enregistrée (le lien d’origine reste valide), mais ${filing.failed.length} document${filing.failed.length > 1 ? 's' : ''} Google Drive n'a pas pu être copié${filing.failed.length > 1 ? 's' : ''} dans Budget_labo/<année> :\n\n${lines}${explain}`
      );
    }

    setModal(null);
    return true;
  };

  /* Enregistrement d’une fiche du registre « Remboursements » (collection
     dédiée). Même résolution « Catégorie / Ligne budgétaire » que les Dépenses,
     mais aucun pipeline devis / SIFAC / BC : le formulaire suit le modèle d’un
     OM prévu (sans la partie statut). La fiche reste dans son registre — elle
     ne migre jamais vers la table Dépenses. */
  const onSaveReimb = (draft, existingId) => {
    const description = txt(draft.description);
    if (!description) {
      alert('Merci de renseigner l’objet du remboursement : c’est son intitulé (obligatoire).');
      return false;
    }
    const couts = {};
    REIMBURSEMENT_COST_FIELDS.forEach((c) => { couts[c.key] = parseNum(draft[c.key]); });
    const coutTotal = parseNum(draft.coutTotal);
    const categorie = txt(draft.categorie);
    const ligneBudgetaire = txt(draft.ligneBudgetaire);
    /* Imputation : la « Catégorie » (Fonctionnement / Investissement) doit
       correspondre au type de la ligne Recettes — sinon le remboursement serait
       décompté sur la mauvaise ligne (colonne « Remboursements »). */
    let recetteId = '';
    const explicit = draft.recetteId && recettes.some((r) => r.id === draft.recetteId)
      ? recettes.find((r) => r.id === draft.recetteId)
      : null;
    if (explicit) {
      if (!categorie || !txt(explicit.type) || sameCatType(categorie, explicit.type)) {
        recetteId = explicit.id;
      } else {
        const twin = findRecetteTwin(recettes, explicit, categorie);
        if (twin) {
          recetteId = twin.id;
        } else {
          alert(
            `Impossible d’enregistrer : le remboursement est classé « ${categorie} » mais lié à la ligne « ${explicit.ligne || explicit.id} » (${explicit.type || 'type inconnu'}).\n\n`
            + `Aucune ligne budgétaire homonyme de type « ${categorie} » n’existe dans Recettes.\n`
            + `Corrigez la catégorie, choisissez une autre ligne, ou créez d’abord la ligne « ${categorie} » correspondante (page Recettes).`
          );
          return false;
        }
      }
    } else if (categorie) {
      const found = findRecetteByLabel(recettes, ligneBudgetaire, categorie);
      if (found) {
        recetteId = found.id;
      } else if (ligneBudgetaire && findRecetteByLabel(recettes, ligneBudgetaire)) {
        const other = findRecetteByLabel(recettes, ligneBudgetaire);
        alert(
          `Aucune ligne budgétaire de type « ${categorie} » ne correspond à « ${ligneBudgetaire} » — seule « ${other.ligne || other.id} » (${other.type || 'type inconnu'}) existe dans Recettes.\n\n`
          + `Corrigez la catégorie du remboursement ou créez d’abord la ligne budgétaire « ${categorie} » correspondante (page Recettes).`
        );
        return false;
      }
    } else {
      recetteId = findRecetteId(recettes, ligneBudgetaire);
    }
    const patch = {
      description,
      demandeur: txt(draft.demandeur),
      destination: txt(draft.destination),
      numOM: txt(draft.numOM),
      etatLiquidatifUrl: txt(draft.etatLiquidatifUrl),
      categorie,
      ligneBudgetaire,
      recetteId: recetteId || '',
      /* Fiches créées automatiquement depuis un OM prévu : drapeau « À
         corriger » tant que les montants estimés n'ont pas été vérifiés /
         corrigés (case du formulaire). */
      aCorriger: draft.aCorriger === true,
      dateDemande: isoOf(draft.dateDemande),
      dateMission: isoOf(draft.dateMission),
      dateRetour: isoOf(draft.dateRetour),
      coutStatut: txt(draft.coutStatut) || 'Exact',
      commentaires: txt(draft.commentaires),
      ...couts,
      coutTotal,
    };
    upsert('reimbursements', patch, existingId);
    /* Classement best-effort de l’« état liquidatif » : copie du fichier signé
       (lien Drive collé) dans Budget_labo/<année>/OM — même règle que pour les
       documents d’une dépense (./driveFiling.js). L’enregistrement reste
       valide même si Drive n’est pas joignable ou le fichier inaccessible. */
    if (txt(patch.etatLiquidatifUrl) && cloudBackendAvailable()) {
      fileBudgetDocs({ ...patch, id: existingId || undefined }, { year: new Date().getFullYear() }).catch(() => {});
    }
    setModal(null);
    return true;
  };

  const removeReimb = (rec) => {
    if (!rec || !rec.id) return;
    const label = txt(rec.description) || 'ce remboursement';
    if (window.confirm(`Supprimer définitivement le remboursement « ${label} » ?`)) {
      remove('reimbursements', rec.id);
    }
  };

  const removeDepense = (rec) => {
    if (!rec || !rec.id) return;
    const label = txt(rec.description) || pick(rec, ['numBC', 'numSIFAC', 'numFacture']) || rec.id;
    if (window.confirm(`Supprimer définitivement la dépense « ${label} » ?`)) {
      remove('depenses', rec.id);
    }
  };

  /* Déplacement d’une ligne entre les trois onglets (Achats / PI / OM).
     Familles possibles : toutes, sauf celle courante. */
  const moveTargetsOf = (r) => ['achat', 'pi', 'om'].filter((t) => t !== depenseKindOf(r));
  const moveDepenseTo = (r, target) => {
    if (!r || !r.id || !['achat', 'pi', 'om'].includes(target)) return;
    const from = depenseKindOf(r);
    if (from === target) return;
    const label = txt(r.description) || pick(r, ['numBC', 'numSIFAC', 'numFacture']) || r.id;
    const note = target === 'om'
      ? '\n\nCette ligne devient une dépense « OM » (onglet OM, indépendant de la page « OM prévus / souhaités »). Elle n’est plus comptée dans « Engagé (BC signés + PI) » des pages Recettes / Budget : son coût se retrouve via la collection om.'
      : target === 'pi'
        ? '\n\nLe fournisseur « PI » est appliqué : la ligne sera comptée comme engagée (prestation interne) dans les pages Recettes / Budget.'
        : isPiFournisseur(r.fournisseur)
          ? '\n\nLe fournisseur « PI » est effacé : pensez à renseigner le vrai fournisseur dans la fiche.'
          : '';
    if (!window.confirm(`Déplacer « ${label} » de « ${DEPENSE_KIND_META[from].label} » vers « ${DEPENSE_KIND_META[target].label} » ?${note}`)) return;
    const patch = { type: target };
    if (target === 'pi') patch.fournisseur = DEPENSE_FOURNISSEUR_PI;
    else if (target === 'achat' && isPiFournisseur(r.fournisseur)) patch.fournisseur = '';
    upsert('depenses', patch, r.id);
  };

  /* ── Colonnes du tableau (ordre de l’onglet du classeur) ──────────────── */
  const columns = [
    {
      key: 'etat', label: 'Etat', filter: 'facet',
      value: (r) => etatOf(r),
      display: (r) => <EtatBadge value={etatOf(r)} />,
    },
    {
      key: 'description', label: 'Dépense', filter: 'text',
      value: (r) => [r.description, r.classification, r.ent, r.numSIFAC, r.numBC, r.numFacture].filter(Boolean).join(' '),
      display: (r) => {
        const statut = pick(r, ['statut', 'suivi']);
        const classification = txt(r.classification);
        const ent = txt(r.ent);
        const isOmLine = depenseKindOf(r) === 'om';
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
            {isOmLine && (
              <div
                className="text-[10px] font-semibold text-indigo-500/90 mt-0.5 truncate max-w-[280px]"
                title={[r.destination, r.dateMission && `Mission du ${r.dateMission}${r.dateRetour ? ` au ${r.dateRetour}` : ''}`].filter(Boolean).join(' · ')}
              >
                {[r.destination, r.dateMission && `du ${r.dateMission}${r.dateRetour ? ` au ${r.dateRetour}` : ''}`].filter(Boolean).join(' · ') || 'Ordre de mission'}
              </div>
            )}
            {ent && <div className="text-[10px] text-slate-400 mt-0.5 truncate max-w-[280px]" title={`ENT : ${ent}`}>ENT : {ent}</div>}
            {missingMandatoryFor(r).length > 0 && (
              <div className="text-[10px] font-black text-red-600 mt-0.5 truncate max-w-[280px]" title={`Champ(s) obligatoire(s) manquant(s) : ${missingMandatoryFor(r).map(mandatoryLabelOf).join(', ')}`}>
                ⚠ {missingMandatoryFor(r).map(mandatoryLabelOf).join(', ')} manquant(s)
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: 'demandeur', label: 'Demandeur', filter: 'facet',
      value: (r) => txt(r.demandeur),
      display: (r) => {
        const name = txt(r.demandeur);
        if (!name) return <span className="text-slate-300">—</span>;
        const person = personEntryOf(r);
        if (person && canViewPersonnel) {
          return (
            <button
              type="button"
              onClick={() => goToPersonnel(person.id)}
              title={`Ouvrir la fiche de ${name} dans Personnel`}
              className="whitespace-nowrap text-xs font-semibold text-slate-600 underline decoration-slate-300 underline-offset-2 hover:text-blue-700 hover:decoration-blue-300 transition-colors"
            >{name}</button>
          );
        }
        return (
          <span
            className="whitespace-nowrap text-xs font-semibold text-slate-600"
            title={person && !canViewPersonnel ? 'Page Personnel réservée au superutilisateur' : name}
          >{name}</span>
        );
      },
    },
    {
      key: 'categorie', label: 'Catégorie', filter: 'facet',
      value: (r) => txt(r.categorie),
      display: (r) => <CategorieBadge value={r.categorie} />,
    },
    {
      key: 'ligne', label: 'Ligne budgétaire', filter: 'facet',
      value: (r) => ligneLabelOf(r),
      display: (r) => {
        const v = ligneLabelOf(r);
        if (!v) return <span className="text-slate-300">—</span>;
        const rec = recetteOf(r);
        if (rec && canViewLibrerie) {
          return (
            <button
              type="button"
              onClick={() => goToLibrerie('recette', rec.id)}
              title="Ouvrir la fiche de cette ligne budgétaire dans la Librairie"
              className="text-left max-w-[240px] font-mono text-[11px] font-bold text-indigo-700 underline decoration-indigo-300 underline-offset-2 hover:text-indigo-900 break-words leading-tight transition-colors"
            >{v}</button>
          );
        }
        return (
          <div className="max-w-[240px]">
            <div
              className="font-mono text-[11px] font-bold text-indigo-700 leading-tight break-words"
              title={rec ? v : `${v} — pas de fiche au catalogue de la Librairie`}
            >{v}</div>
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
      key: 'fournisseur', label: 'Nom du fournisseur', filter: 'facet',
      value: (r) => txt(r.fournisseur),
      display: (r) => {
        const name = txt(r.fournisseur);
        if (!name) return <span className="text-slate-300">—</span>;
        const entry = fournisseurEntryOf(r);
        if (entry && canViewLibrerie) {
          return (
            <button
              type="button"
              onClick={() => goToLibrerie('fournisseur', entry.id)}
              title={`Ouvrir la fiche « ${name} » dans la Librairie`}
              className="whitespace-nowrap text-xs font-bold text-slate-700 underline decoration-slate-300 underline-offset-2 hover:text-blue-700 hover:decoration-blue-300 transition-colors"
            >{name}</button>
          );
        }
        if (isPiFournisseur(r.fournisseur)) {
          return (
            <span
              className="whitespace-nowrap text-xs font-bold text-slate-500"
              title="Prestation interne : service interne facturé sans BC — pas de fiche dans la Librairie"
            >{name}</span>
          );
        }
        return (
          <span
            className="whitespace-nowrap text-xs font-bold text-slate-700"
            title={canViewLibrerie
              ? 'Fournisseur pas encore au catalogue — créez sa fiche dans Librairie (bouton « ↻ Créer depuis les Dépenses »).'
              : name}
          >{name}</span>
        );
      },
    },
    {
      key: 'numDevis', label: 'N° devis', filter: 'text',
      value: (r) => txt(r.numDevis),
      display: (r) => <Ref value={r.numDevis} url={r.numDevisUrl} />,
    },
    {
      key: 'numSIFAC', label: 'N° SIFAC/D.A.', filter: 'text',
      header: <span title="N° SIFAC / D.A. : n° de la Demande d’Achat (D.A.) dans l’application SIFAC de l’université (ex. 2026000000) — attribué par la gestionnaire lors de la transmission du devis, il suit la commande jusqu’au BC signé">N° SIFAC/D.A.</span>,
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
          <select
            value=""
            onChange={(e) => {
              const t = e.target.value;
              if (t) moveDepenseTo(r, t);
            }}
            title="Déplacer cette dépense vers un autre onglet (Achats / PI / OM)"
            className="text-[10px] font-black text-slate-600 border border-slate-200 bg-slate-50 rounded-lg px-1 py-1 outline-none cursor-pointer hover:border-slate-300"
          >
            <option value="">↔ Déplacer</option>
            {moveTargetsOf(r).map((t) => (
              <option key={t} value={t}>
                {DEPENSE_KIND_META[t].icon} vers {DEPENSE_KIND_META[t].label}
              </option>
            ))}
          </select>
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

  /* Colonnes par onglet : les achats et les dépenses OM affichent toutes les
     colonnes du classeur (devis → BC/SIFAC → livraisons → facture, N° OM…).
     Seules les prestations internes (PI — pas de devis / BC / SIFAC ni de suivi
     de livraisons) gardent la liste réduite à l’essentiel. */
  const columnByKey = new Map(columns.map((c) => [c.key, c]));
  const simpleColumns = [
    columnByKey.get('etat'),
    columnByKey.get('description'),
    columnByKey.get('demandeur'),
    columnByKey.get('categorie'),
    columnByKey.get('ligne'),
    columnByKey.get('montant'),
    columnByKey.get('dateDemande'),
    columnByKey.get('numFacture'),
    columnByKey.get('omNo'),
    columnByKey.get('commentaires'),
    columnByKey.get('actions'),
  ].filter(Boolean);

  /* Colonnes du registre « Remboursements » — formulaire calqué sur un OM
     prévu (sans la partie statut En attente / Acceptée / Refusée) : AUCUNE
     colonne devis / N° SIFAC / BC / fournisseur, et pas de « Déplacer » vers
     les onglets Achats / PI / OM (une fiche ne migre jamais). */
  const reimbCostDetail = (r) => REIMBURSEMENT_COST_FIELDS
    .map((c) => {
      const n = numOf(r && (r[c.key] !== undefined && r[c.key] !== null && r[c.key] !== '' ? r[c.key] : null));
      return n === null ? null : { label: c.label, n };
    })
    .filter((x) => x !== null);
  const reimbCols = [
    {
      key: 'objet', label: 'Objet du remboursement', filter: 'text',
      value: (r) => [r.description, r.destination, r.numOM, r.demandeur, ligneLabelOf(r)].filter(Boolean).join(' '),
      display: (r) => (
        <div className="min-w-[220px]">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-bold text-slate-800 leading-snug">{txt(r.description) || 'Remboursement'}</span>
            {r.aCorriger && (
              <span
                className="inline-block text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 whitespace-nowrap"
                title="Créée automatiquement depuis un OM prévu — montants encore estimés : à corriger à la main une fois les justificatifs réels connus (case « Frais corrigés » du formulaire)."
              >À corriger</span>
            )}
          </div>
          <div className="text-[11px] text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {r.destination ? <span>📍 {txt(r.destination)}</span> : null}
            {r.numOM ? <span className="font-mono text-[10px] text-slate-500"># {txt(r.numOM)}</span> : null}
          </div>
        </div>
      ),
    },
    {
      key: 'beneficiaire', label: 'Bénéficiaire', filter: 'text',
      value: (r) => txt(r.demandeur),
      display: (r) => (txt(r.demandeur)
        ? <span className="text-slate-700 whitespace-nowrap">{txt(r.demandeur)}</span>
        : <span className="text-slate-300">—</span>),
    },
    {
      key: 'dates', label: 'Dates', filter: 'text',
      value: (r) => [r.dateDemande, r.dateMission, r.dateRetour].filter(Boolean).join(' '),
      display: (r) => {
        const asked = isoOf(r.dateDemande);
        const start = isoOf(r.dateMission);
        const end = isoOf(r.dateRetour);
        const period = start ? (end ? `${toFrDate(start)} → ${toFrDate(end)}` : toFrDate(start)) : (end ? `→ ${toFrDate(end)}` : '');
        return (
          <div className="text-[11px] text-slate-500 leading-snug whitespace-nowrap">
            {asked ? <div title="Date de la demande">📅 {toFrDate(asked)}</div> : null}
            {period ? <div className="text-slate-400">{period}</div> : null}
          </div>
        );
      },
    },
    {
      key: 'ligne', label: 'Ligne budgétaire', filter: 'text',
      value: (r) => ligneLabelOf(r) || txt(r.ligneBudgetaire) || '',
      display: (r) => {
        const label = ligneLabelOf(r) || txt(r.ligneBudgetaire);
        return label
          ? <span className="text-slate-700 whitespace-nowrap">{label}</span>
          : <span className="text-amber-600 text-[11px] font-semibold whitespace-nowrap" title="Imputez ce remboursement sur une ligne budgétaire pour qu’il soit déduit du bon budget (page Recettes).">non imputé</span>;
      },
    },
    {
      key: 'cout', label: 'Coût total', dataType: 'number', align: 'right', nowrap: true,
      value: (r) => reimbTotalOf(r),
      display: (r) => {
        const total = reimbTotalOf(r);
        const parts = reimbCostDetail(r);
        const statut = txt(r.coutStatut) || 'Exact';
        const hint = [
          total > 0 ? `Coût total : ${euro.format(total)}` : 'Non chiffré',
          parts.length ? parts.map((p) => `${p.label} : ${euro.format(p.n)}`).join(' · ') : '',
          `Montant ${statut}`,
        ].filter(Boolean).join('\n');
        return (
          <div className="text-right" title={hint}>
            <div className="font-semibold text-slate-800 whitespace-nowrap">
              {total > 0 ? euro.format(total) : <span className="text-slate-300">—</span>}
            </div>
            <div className="text-[10px] text-slate-400 uppercase font-black">
              {statut}
            </div>
          </div>
        );
      },
    },
    {
      key: 'etatLiquidatif', label: 'État liquidatif', filter: 'none', filterable: false, nowrap: true,
      value: (r) => [txt(r.numOM), txt(r.etatLiquidatifUrl)].filter(Boolean).join(' '),
      display: (r) => {
        const url = txt(r.etatLiquidatifUrl);
        const num = txt(r.numOM);
        if (!url) {
          return (
            <span
              className="text-slate-300 text-[11px] whitespace-nowrap"
              title="Aucun état liquidatif signé joint — ouvrez la fiche et collez le lien du document signé : il sera classé dans Budget_labo/…/OM et apparaîtra ici."
            >—</span>
          );
        }
        return (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-700 hover:underline whitespace-nowrap"
            title="Ouvrir l’état liquidatif signé — classé dans Budget_labo/…/OM"
          >
            🖋️ {num ? `OM ${num}` : 'Pièce signée'} ↗
          </a>
        );
      },
    },
    { key: 'commentaires', label: 'Commentaires', filter: 'text', hidden: true, value: (r) => txt(r.commentaires) },
    {
      key: 'actions', label: '', filter: 'none', filterable: false, value: () => '',
      display: (r) => (
        <div className="flex items-center gap-1 whitespace-nowrap">
          <button
            type="button"
            title="Modifier le remboursement"
            onClick={() => setModal({ mode: 'edit', rec: r, reimb: true })}
            className="text-[11px] font-black px-2 py-1 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
          >✏️ Modifier</button>
          <button
            type="button"
            title="Supprimer le remboursement"
            onClick={() => removeReimb(r)}
            className="text-[11px] font-black px-2 py-1 rounded-lg border border-red-200 bg-red-50 text-red-500 hover:bg-red-100 transition-colors"
          >🗑️</button>
        </div>
      ),
    },
  ];

  /* Lignes incomplètes de l’onglet actif : au moins un champ obligatoire manque. */
  const redRows = depViewRows.filter((r) => missingMandatoryFor(r).length > 0);
  const redLabels = [...new Set(redRows.flatMap((r) => missingMandatoryFor(r).map(mandatoryLabelOf)))];
  const piFactured = piRows.filter((r) => txt(r.numFacture)).length;
  /* Famille de la dépense en cours d’édition / création (pour le formulaire).
     L’onglet « achats » correspond à la famille canonique « achat » ; l’onglet
     « Rémunération stages » garde le formulaire complet des achats (seule la
     classification « Stages » est pré-remplie pour une nouvelle ligne). Les
     remboursements ouvrent leur PROPRE formulaire (RemboursementModal),
     calqué sur un OM prévu : ils ne passent pas par cette dépense. */
  const KIND_BY_TAB = { achats: 'achat', pi: 'pi', om: 'om', stages: 'achat' };
  const modalKind = modal
    ? (modal.mode === 'edit' ? depenseKindOf(modal.rec) : KIND_BY_TAB[tab] || 'achat')
    : 'achat';

  return (
    <div className="h-full min-h-0 w-full min-w-0 mx-auto flex flex-col gap-4">
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
              ? `✓ ${linkRepair.report.fixed} dépense${linkRepair.report.fixed > 1 ? 's' : ''} réattribuée${linkRepair.report.fixed > 1 ? 's' : ''} automatiquement sur la ligne budgétaire du type correspondant à sa catégorie (trace dans « Commentaires »).`
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
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {tab === 'om' ? (
          <p className="text-xs font-bold text-slate-400">
            {omStats.count} ligne{omStats.count > 1 ? 's' : ''} OM transférée{omStats.count > 1 ? 's' : ''} (dépenses liées à un ordre de mission) · {omStats.factured} facturée{omStats.factured > 1 ? 's' : ''} — tableau <b>indépendant</b> de la collection om : les OM à préparer / approuver se trouvent sur la page « OM prévus / souhaités ».
          </p>
        ) : tab === 'pi' ? (
          <p className="text-xs font-bold text-slate-400">
            {summary.count} prestation{summary.count > 1 ? 's' : ''} interne{summary.count > 1 ? 's' : ''} (fournisseur « PI », sans BC) · {piFactured} facturée{piFactured > 1 ? 's' : ''} — comptées « engagées » dès leur saisie dans la page Recettes.
          </p>
        ) : tab === 'stages' ? (
          <p className="text-xs font-bold text-slate-400">
            {stageStats.count} rémunération{stageStats.count > 1 ? 's' : ''} de stage (classification « Stages ») · {stageStats.factured} facturée{stageStats.factured > 1 ? 's' : ''} — édition complète, mêmes colonnes que les Achats ; déduites du solde des lignes budgétaires (page Recettes › colonne « Stages »).
          </p>
        ) : tab === 'remboursements' ? (
          <p className="text-xs font-bold text-slate-400">
            {reimbStats.count} remboursement{reimbStats.count > 1 ? 's' : ''} de frais · {reimbStats.moneyCount ? euro.format(reimbStats.total) : '—'} — registre <b>dédié</b> (sur le modèle d’un OM prévu : dates, bénéficiaire, coûts) ; aucune fiche ne comporte de devis / N° SIFAC / BC et rien ne migre vers les onglets Achats / PI / OM. Total déduit du solde des lignes budgétaires (page Recettes › colonne « Remboursements »).
          </p>
        ) : (
          <p className="text-xs font-bold text-slate-400">
            {summary.count} achat{summary.count > 1 ? 's' : ''} (BC/SIFAC) · {summary.parcelsReceived}/{summary.parcelsTotal} colis reçu{summary.parcelsReceived > 1 ? 's' : ''} ·{' '}
            {summary.pendingCount ? ` ${summary.pendingCount} livraison${summary.pendingCount > 1 ? 's' : ''} en attente` : ' toutes les livraisons reçues'} — édition complète, mêmes colonnes que l’onglet « Dépenses » du classeur.
          </p>
        )}
        <div className="flex items-center gap-2">
          {tab === 'om' && canViewOm && (
            <button
              type="button"
              onClick={() => navigate('om')}
              title="Ouvrir la page « OM prévus / souhaités » pour préparer et approuver des ordres de mission, puis les transférer ici (bouton « → Dépenses »)"
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm px-4 py-2 rounded-xl shadow-sm transition-colors flex items-center gap-1.5"
            >
              <span className="text-base leading-none">✈️</span> OM prévus / souhaités
            </button>
          )}
          {tab !== 'om' && (
            <button
              onClick={() => setImportOpen(true)}
              className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-bold text-sm px-4 py-2 rounded-xl shadow-sm transition-colors flex items-center gap-1.5"
              title={tab === 'remboursements'
                ? 'Importer les lignes du classeur — les lignes classées « Remboursements » arriveront dans cet onglet (registre dédié, jamais dans les Dépenses BC/SIFAC)'
                : 'Importer les dépenses depuis la feuille Google Sheets (coller, CSV ou Excel)'}
            >
              <span className="text-base leading-none">📥</span> Importer
            </button>
          )}
          {tab !== 'remboursements' && (
            <button
              type="button"
              onClick={runBudgetFiling}
              disabled={filingBusy || reimportBusy}
              className="bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 font-bold text-sm px-4 py-2 rounded-xl shadow-sm transition-colors flex items-center gap-1.5 disabled:opacity-50"
              title="Copier dans Budget_labo/<année>/… les documents Google Drive liés aux dépenses déjà saisies (devis, BC, facture, OM, BL/SF) — l’original n’est jamais déplacé ; possible quand le fichier est accessible à l’application"
            >
              <span className="text-base leading-none">{filingBusy ? '⏳' : '📎'}</span>{filingBusy ? 'Rangement…' : 'Ranger les liens Drive'}
            </button>
          )}
          {tab !== 'remboursements' && (
            <button
              type="button"
              onClick={runDriveReimport}
              disabled={reimportBusy || filingBusy}
              className="bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 font-bold text-sm px-4 py-2 rounded-xl shadow-sm transition-colors flex items-center gap-1.5 disabled:opacity-50"
              title="Ré-importer comme copie de l’application chaque document Google Drive que l’app ne voit pas (déposé à la main — autorisation limitée « drive.file ») : téléchargement par le lien public puis dépôt dans Budget_labo/<année>/… avec le nom de la convention, et remplacement du lien de la dépense (l’original n’est jamais supprimé). Prérequis : dossier partagé en « Toute personne disposant du lien »."
            >
              <span className="text-base leading-none">{reimportBusy ? '⏳' : '🔁'}</span>
              {reimportBusy
                ? (reimportProgress && reimportProgress.total
                  ? `Ré-import ${reimportProgress.done}/${reimportProgress.total}…`
                  : 'Ré-import…')
                : 'Ré-importer les documents Drive'}
            </button>
          )}
          <button
            onClick={() => setModal(tab === 'remboursements' ? { mode: 'new', reimb: true } : { mode: 'new' })}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm px-4 py-2 rounded-xl shadow-sm transition-colors flex items-center gap-1.5"
            title={tab === 'om'
              ? 'Ajouter une dépense liée à un ordre de mission (type OM)'
              : tab === 'stages'
                ? 'Ajouter une dépense de rémunération de stage (classification « Stages » pré-remplie)'
                : tab === 'remboursements'
                  ? 'Ajouter un remboursement de frais avancés par un membre — registre dédié (modèle OM prévu : ni devis, ni N° SIFAC/D.A., ni BC, ni fournisseur). Une fois saisi, il reste ici et ne migre jamais vers les Dépenses (Achats / PI / OM).'
                  : 'Ajouter une dépense'}
          >
            <span className="text-base leading-none">+</span>{tab === 'om' ? 'Ajouter une dépense OM' : tab === 'stages' ? 'Ajouter une rémunération de stage' : tab === 'remboursements' ? 'Ajouter un remboursement' : 'Ajouter une dépense'}
          </button>
        </div>
      </div>

      {/* Sélecteur d’onglet : Achats · Prestations internes · OM · Rémunération stages · Remboursements. */}
      <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl p-1 shadow-sm w-fit flex-wrap">
        {[
          { id: 'achats', icon: '🛒', label: 'Achats', count: achatRows.length },
          { id: 'pi', icon: '🛠️', label: 'Prestations internes', count: piRows.length },
          { id: 'om', icon: '✈️', label: 'OM', count: omRows.length },
          { id: 'stages', icon: '🎓', label: 'Rémunération stages', count: stageRows.length },
          { id: 'remboursements', icon: '💸', label: 'Remboursements', count: reimbList.length },
        ].map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => setTab(v.id)}
            title={
              v.id === 'achats'
                ? 'Dépenses avec fournisseur « normal » : cycle devis → BC → livraisons → facture (hors rémunérations de stage)'
                : v.id === 'pi'
                  ? 'Prestations internes : fournisseur « PI », service interne facturé sans BC (colonnes réduites)'
                  : v.id === 'om'
                    ? 'Lignes OM : dépenses liées à un ordre de mission accepté — tableau indépendant de la page « OM prévus / souhaités »'
                    : v.id === 'stages'
                      ? 'Rémunérations de stage : dépenses dont la « Classification / nature » est « Stages » (gratifications de stagiaires), retirées des autres onglets et déduites du solde dans la page Recettes'
                      : 'Remboursements : registre dédié de frais avancés par un membre puis remboursés par le laboratoire — jamais de devis / N° SIFAC / BC, indépendant des Achats / PI / OM, déduit du solde dans la page Recettes'
            }
            className={`px-3 py-1.5 rounded-lg text-xs font-black transition-colors ${tab === v.id ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:bg-blue-50 hover:text-blue-700'}`}
          >
            <span className="mr-1.5">{v.icon}</span>{v.label}
            <span className={`ml-1.5 font-mono text-[10px] ${tab === v.id ? 'text-blue-200' : 'text-slate-400'}`}>{v.count}</span>
          </button>
        ))}
      </div>

      {/* Cartes de synthèse propres aux onglets OM, PI et Rémunération stages.
          L’onglet Achats n’a plus de cartes : le nombre d’achats / BC figure
          dans le sélecteur d’onglet. */}
      {tab === 'om' ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <SummaryCard label="Dépenses OM" value={omStats.count} tone="slate" hint="Nombre de lignes de type « om » suivies ici (indépendantes de la page « OM prévus / souhaités »)." />
          <SummaryCard label="Montant total (HT + port)" value={omStats.moneyCount ? euro.format(omStats.total) : '—'} tone="blue" hint={`Somme des montants renseignés sur ${omStats.moneyCount} ligne(s) OM.`} />
          <SummaryCard label="Facturées" value={omStats.factured} tone="indigo" hint="Lignes OM avec un N° facture renseigné (service fait / paiement)." />
          <SummaryCard label="À facturer" value={omStats.toInvoice} tone="amber" hint="Lignes OM sans N° facture — à compléter pour le paiement." />
        </div>
      ) : tab === 'pi' ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <SummaryCard label="Prestations internes" value={summary.count} tone="slate" hint="Dépenses dont le fournisseur est « PI » — service interne facturé sans BC." />
          <SummaryCard label="Montant total (HT + port)" value={summary.moneyCount ? euro.format(summary.total) : '—'} tone="blue" hint={`Somme des montants renseignés sur ${summary.moneyCount} prestation(s).`} />
          <SummaryCard label="Facturées" value={piFactured} tone="indigo" hint="Prestations internes avec un N° facture renseigné." />
          <SummaryCard label="À facturer" value={Math.max(0, summary.count - piFactured)} tone="amber" hint="Prestations internes sans N° facture — à compléter pour le paiement." />
        </div>
      ) : tab === 'stages' ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <SummaryCard label="Rémunérations de stage" value={stageStats.count} tone="slate" hint="Dépenses dont la « Classification / nature » est « Stages » (gratifications de stagiaires) — retirées des onglets Achats / PI / OM." />
          <SummaryCard label="Montant total (HT + port)" value={stageStats.moneyCount ? euro.format(stageStats.total) : '—'} tone="blue" hint={`Somme des montants renseignés sur ${stageStats.moneyCount} rémunération(s) de stage.`} />
          <SummaryCard label="Facturées" value={stageStats.factured} tone="indigo" hint="Rémunérations de stage avec un N° facture renseigné." />
          <SummaryCard label="À facturer" value={stageStats.toInvoice} tone="amber" hint="Rémunérations de stage sans N° facture — à compléter pour le paiement." />
        </div>
      ) : tab === 'remboursements' ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          <SummaryCard label="Remboursements" value={reimbStats.count} tone="slate" hint="Fiches du registre dédié « Remboursements » (frais avancés par un membre puis remboursés par le laboratoire)." />
          <SummaryCard label="Montant total (coûts)" value={reimbStats.moneyCount ? euro.format(reimbStats.total) : '—'} tone="blue" hint={`Somme des coûts renseignés sur ${reimbStats.moneyCount} remboursement(s) — déduite du solde des lignes budgétaires (page Recettes › colonne « Remboursements »).`} />
          <SummaryCard label="Non imputés" value={reimbStats.withoutLine} tone={reimbStats.withoutLine ? 'amber' : 'slate'} hint="Remboursements sans ligne budgétaire liée — à imputer pour qu’ils soient déduits du bon budget dans la page Recettes." />
        </div>
      ) : null}

      {tab === 'om' ? (
        <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-2.5 text-[11px] text-slate-600 leading-relaxed">
          <b>Dépenses OM :</b> ce tableau est <b>indépendant</b> de la page « OM prévus / souhaités » — il ne rejoue pas ses
          éléments. Il liste les <b>lignes de type « om »</b> de la collection Dépenses : un OM « Acceptée » de la page
          « OM prévus / souhaités » y arrive via son bouton <b>« → Dépenses »</b>, et chaque ligne peut ensuite être
          <b> déplacée</b> vers « Achats » ou « PI » (colonne « ↔ Déplacer ») — et inversement. Le coût d’un OM reste
          compté dans les pages Recettes / Budget via la collection om ; ces lignes suivent la facture / le paiement
          (N° facture, service fait…).
        </div>
      ) : tab === 'pi' ? (
        <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-2.5 text-[11px] text-slate-600 leading-relaxed">
          <b>Prestations internes :</b> service interne (atelier, autre équipe…) facturé <b>sans bon de commande</b> — pas de
          devis / BC / SIFAC ni de suivi de livraisons, d’où des colonnes réduites à l’essentiel (ligne budgétaire, montant,
          facture, N° OM / paiement). Une telle dépense est comptée <b>« engagée » dès sa saisie</b> dans la page Recettes.
          Cliquez sur « + Ajouter une dépense » : le fournisseur « PI » est pré-rempli.
        </div>
      ) : tab === 'stages' ? (
        <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-2.5 text-[11px] text-slate-600 leading-relaxed">
          <b>Rémunérations de stage :</b> ces lignes sont identifiées par la <b>« Classification / nature » = « Stages »</b>
          (colonne « Classification » de l’onglet Dépenses du classeur, ou sélecteur « Classification / nature » du
          formulaire). Elles sont <b>retirées des onglets Achats / PI / OM</b> et listées ici avec les mêmes colonnes que les
          Achats ; la page Recettes les décompte dans sa <b>colonne « Stages »</b> (déduite de la « Dispo université » dans le
          calcul du solde), sans jamais les compter deux fois.
        </div>
      ) : tab === 'remboursements' ? (
        <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-2.5 text-[11px] text-slate-600 leading-relaxed">
          <b>Remboursements :</b> frais <b>avancés par un membre</b> (billet, inscription, mission…) puis <b>remboursés par le laboratoire</b>.
          C’est un <b>registre à part</b> : le formulaire suit le modèle d’un <b>OM prévu</b> (objet, bénéficiaire, dates, coûts
          détaillés) — <b>ni devis, ni N° SIFAC/D.A., ni BC, ni fournisseur</b> — et une fiche <b>reste ici</b>, elle ne migre
          jamais vers les onglets Achats / PI / OM, même une fois le remboursement effectué. La page Recettes les décompte
          dans sa <b>colonne « Remboursements »</b> (déduite de la « Dispo université » dans le calcul du solde), sans jamais
          les compter deux fois. <b>Bénéficiaire = le demandeur</b> (membre qui a payé).
        </div>
      ) : null}

      {redRows.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50/80 px-4 py-2.5 text-[11px] text-red-700 leading-relaxed">
          ⚠️ <b>{redRows.length} ligne{redRows.length > 1 ? 's' : ''} en rouge</b> — champ{redLabels.length > 1 ? 's' : ''} obligatoire{redLabels.length > 1 ? 's' : ''} manquant{redLabels.length > 1 ? 's' : ''} :{' '}
          {redLabels.join(', ')}. Ces champs se configurent dans Setup › Champs obligatoires.
        </div>
      )}

      {tab === 'remboursements' ? (
        reimbList.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-10 text-center">
            <div className="text-4xl mb-2">💸</div>
            <p className="font-black text-slate-700">Aucun remboursement de frais</p>
            <p className="text-sm text-slate-400 mt-1 mb-4">
              Le registre des remboursements est vide. Utilisez « ＋ Ajouter un remboursement » pour saisir des frais
              avancés par un membre (objet, bénéficiaire, dates, coûts…), sur le modèle d’un OM prévu : pas de devis, de
              N° SIFAC/D.A. ni de BC, pas de fournisseur. Une fiche créée reste ici — elle est déduite du solde de sa ligne
              budgétaire (page Recettes › colonne « Remboursements ») et ne migre jamais vers les Dépenses réelles.
            </p>
          </div>
        ) : (
          <div className="flex-1 min-h-[280px] flex flex-col">
            <SmartTable
              columns={reimbCols}
              rows={reimbList}
              focusRowKey={focusRow}
              onFocusDone={() => setFocusRow(null)}
              minWidth="1500px"
              quickFilters={['demandeur', 'ligne']}
              searchPlaceholder="Rechercher objet, bénéficiaire, destination, référence, ligne budgétaire…"
              emptyLabel="Aucun remboursement"
              noMatchLabel="Aucun remboursement ne correspond aux filtres."
              fillHeight
            />
          </div>
        )
      ) : depViewRows.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-10 text-center">
          <div className="text-4xl mb-2">{tab === 'pi' ? '🛠️' : (tab === 'om' ? '✈️' : (tab === 'stages' ? '🎓' : (tab === 'remboursements' ? '💸' : '📦')))}</div>
          <p className="font-black text-slate-700">
            {tab === 'pi' ? 'Aucune prestation interne' : (tab === 'om' ? 'Aucune dépense OM pour le moment' : (tab === 'stages' ? 'Aucune rémunération de stage' : (tab === 'remboursements' ? 'Aucun remboursement de frais' : 'Aucune dépense d’achat (BC/SIFAC)')))}
          </p>
          <p className="text-sm text-slate-400 mt-1">
            {tab === 'pi'
              ? 'Les prestations internes (fournisseur « PI », service interne sans BC) s’afficheront ici. Ajoutez-en une via « + Ajouter une dépense » : le fournisseur « PI » est pré-rempli.'
              : tab === 'om'
                ? 'Aucune ligne de type « OM » n’a encore été transférée. Sur la page « OM prévus / souhaités » (bouton ci-dessus), mettez un OM « Acceptée » puis cliquez sur « → Dépenses » — ou ajoutez directement une dépense OM ici.'
                : tab === 'stages'
                  ? 'Les rémunérations de stage (gratifications de stagiaires) sont les dépenses dont la « Classification / nature » est « Stages ». Ajoutez-en une via « + Ajouter une rémunération de stage » (classification « Stages » pré-remplie), ou importez l’onglet « Dépenses » du classeur : les lignes classées « Stages » arriveront automatiquement ici.'
                  : tab === 'remboursements'
                    ? 'Les remboursements sont les dépenses dont la « Classification / nature » est « Remboursements » : frais avancés par un membre puis remboursés par le laboratoire (pas de fournisseur). Ajoutez-en un via « + Ajouter un remboursement » (classification pré-remplie), ou importez l’onglet « Dépenses » du classeur : les lignes classées « Remboursements » arriveront automatiquement ici.'
                    : 'Ajoutez la première dépense via « + Ajouter une dépense », ou importez l’onglet « Dépenses » de la feuille Google Sheets. Les prestations internes « PI », les OM, les rémunérations de stage et les remboursements ont leurs propres onglets ci-dessus.'}
          </p>
        </div>
      ) : (
        <div className="flex-1 min-h-[280px] flex flex-col">
          <SmartTable
            key={tab}
            columns={tab === 'pi' ? simpleColumns : columns}
            rows={depViewRows}
            rowClass={(r) => (missingMandatoryFor(r).length ? 'bg-red-100/70' : '')}
            minWidth={tab === 'pi' ? '1560px' : '2250px'}
            quickFilters={['demandeur', 'ligne'].concat(tab === 'pi' ? [] : ['fournisseur'])}
            focusRowKey={focusRow}
            onFocusDone={() => setFocusRow(null)}
            searchPlaceholder={tab === 'pi'
              ? 'Rechercher description, demandeur, ligne budgétaire, n° facture / OM…'
              : 'Rechercher description, fournisseur, n° BC / SIFAC / facture, BL, service fait…'}
            emptyLabel="Aucune dépense"
            noMatchLabel={tab === 'achats'
              ? 'Aucune dépense ne correspond aux filtres.'
              : tab === 'pi'
                ? 'Aucune prestation interne ne correspond aux filtres.'
                : tab === 'om'
                  ? 'Aucune dépense OM ne correspond aux filtres.'
                  : tab === 'stages'
                    ? 'Aucune rémunération de stage ne correspond aux filtres.'
                    : 'Aucun remboursement ne correspond aux filtres.'}
            fillHeight
          />
        </div>
      )}

      {importOpen && <AdminImportModal kind="depenses" onClose={() => setImportOpen(false)} />}

      {modal && (modal.reimb ? (
        <RemboursementModal
          rec={modal.mode === 'edit' ? modal.rec : null}
          recettes={recettes}
          types={types}
          demandeurNames={demandeurNames}
          onCancel={() => setModal(null)}
          onSave={onSaveReimb}
        />
      ) : (
        <DepenseModal
          rec={modal.mode === 'edit' ? modal.rec : null}
          recettes={recettes}
          types={types}
          natures={natures}
          statutOptions={statutOptions}
          demandeurNames={demandeurNames}
          fournisseurNames={fournisseurNames}
          kind={modalKind}
          defaultFournisseur={modalKind === 'pi' && modal.mode === 'new' ? DEPENSE_FOURNISSEUR_PI : ''}
          defaultClassification={modal.mode === 'new' && tab === 'stages' ? 'Stages' : ''}
          fournisseurRequired={mandatoryFields.includes('fournisseur') && modalKind !== 'om'}
          onCancel={() => setModal(null)}
          onSave={onSaveDepense}
        />
      ))}
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

/* Champ « lien document » avec téléversement d’un fichier DEPUIS CE PC.
   Le fichier choisi est copié dans Budget_labo/<année>/<folder> sur Google
   Drive (dossiers créés si besoin) et son lien remplit le champ — le document
   est donc classé dans la structure convenue dès la saisie, sans dépendre
   d’un lien Drive collé ailleurs. */
const BudgetDocLinkInput = ({ folder, value, onChange, placeholder, title, nameFor }) => {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const pick = async (file) => {
    if (!file) return;
    setMsg('');
    if (!cloudBackendAvailable()) {
      setMsg('⚠️ Google Drive n’est pas connecté — collez le lien du fichier ci-contre.');
      return;
    }
    setBusy(true);
    const year = new Date().getFullYear();
    try {
      const drive = await uploadLocalFile({
        name: String((typeof nameFor === 'function' ? nameFor(file) : '') || file.name || 'document').trim().slice(0, 180),
        mimeType: file.type || 'application/octet-stream',
        file,
        path: budgetDocPath(year, folder),
      });
      if (drive && drive.driveUrl) {
        onChange(drive.driveUrl);
        setMsg(`✓ Téléversé dans Budget_labo/${year}/${folder} — dossier créé si besoin.`);
      } else {
        setMsg('⚠️ Téléversement impossible (Drive non connecté ?) — collez le lien ci-contre.');
      }
    } catch (err) {
      console.error(err);
      setMsg(`⚠️ Téléversement impossible : ${(err && err.message) || err}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="min-w-0">
      <div className="flex gap-1.5 items-center">
        <input
          type="file"
          ref={fileRef}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files && e.target.files[0];
            if (e.target) e.target.value = '';
            if (f) pick(f);
          }}
        />
        <input
          className={MODAL_URL_INPUT}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          title={title}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => { if (fileRef.current) fileRef.current.click(); }}
          title={`Téléverser un fichier depuis ce PC vers Budget_labo/<année>/${folder}`}
          className="shrink-0 text-[11px] font-black px-2 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 disabled:opacity-50"
        >
          {busy ? '⏳' : '⬆ PC'}
        </button>
      </div>
      {msg ? <p className="text-[11px] text-slate-500 mt-1 leading-snug break-words">{msg}</p> : null}
    </div>
  );
};

/* Nom de fichier Drive « conventionnel » d’un document budget téléversé depuis
   le formulaire Dépenses : BC_<N°>_<ligne>_<fournisseur>_<demandeur>_<date>.
   `docDate` est la date propre au document (date du BC, signature du devis,
   réception du BL…) ; à défaut on utilise la date de la demande. Sans N° de
   document on renvoie '' → le nom de fichier local d’origine est conservé (un
   document sans N° ne doit pas prendre un nom conventionnel incomplet). */
const depenseDocDriveName = (draft, { prefix, code, docDate }, file) => {
  if (!txt(code)) return '';
  return budgetDocFileName({
    prefix,
    code: txt(code),
    ligne: txt(draft && draft.ligneBudgetaire),
    fournisseur: txt(draft && draft.fournisseur),
    demandeur: txt(draft && draft.demandeur),
    date: txt(docDate) || txt(draft && draft.dateDemande),
    fileName: file && file.name,
  });
};

const DepenseModal = ({
  rec, recettes, types, natures, statutOptions,
  demandeurNames, fournisseurNames, defaultFournisseur = '',
  defaultClassification = '',
  kind = 'achat', fournisseurRequired = false, onCancel, onSave,
}) => {
  const editing = !!rec;
  const kindNow = editing ? depenseKindOf(rec) : (kind === 'pi' || kind === 'om' ? kind : 'achat');
  const omKind = kindNow === 'om';
  const kindLabel = (DEPENSE_KIND_META[kindNow] && DEPENSE_KIND_META[kindNow].label) || kindNow;
  const kindIcon = (DEPENSE_KIND_META[kindNow] && DEPENSE_KIND_META[kindNow].icon) || '🧾';
  /* Nouvelle ligne saisie depuis l’onglet « Rémunération stages » : on garde le
     formulaire complet des achats, seule la classification « Stages » est
     pré-remplie (l’utilisateur peut la changer dans le sélecteur). */
  const stageForm = !editing && isStageNature(defaultClassification);
  /* Idem depuis l’onglet « Remboursements » : classification « Remboursements »
     pré-remplie, formulaire complet des achats conservé. */
  const reimbForm = !editing && isReimbNature(defaultClassification);

  const initialLivraisons = () => {
    const stored = Array.isArray(rec && rec.livraisons) && rec.livraisons.length
      ? rec.livraisons : null;
    if (!stored) return [EMPTY_LIV()];
    return stored.map((l) => normalizeLiv(l));
  };

  const [draft, setDraft] = useState(() => {
    if (rec) {
      return {
        type: depenseKindOf(rec),
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
        numDevis: txt(rec.numDevis),
        numDevisUrl: txt(rec.numDevisUrl),
        numSIFAC: txt(rec.numSIFAC),
        dateBC: isoOf(rec.dateBC),
        numBC: txt(rec.numBC),
        numBCUrl: txt(rec.numBCUrl),
        dateSignature: isoOf(rec.dateSignature),
        dateSignatureDevis: isoOf(rec.dateSignatureDevis),
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
      type: kindNow,
      description: '', demandeur: '', categorie: '', classification: defaultClassification,
      statut: '', ligneBudgetaire: '', recetteId: '',
      montant: '', fraisPort: '', dateDemande: todayIso(),
      fournisseur: defaultFournisseur,
      numDevis: '', numDevisUrl: '', numSIFAC: '', dateBC: '',
      numBC: '', numBCUrl: '', dateSignature: '', dateSignatureDevis: '',
      dateApprobFournisseur: '',
      numFacture: '', numFactureUrl: '', omNo: '', omUrl: '',
      nonComptabiliseEnt: false, ent: '',
      livraisonComplete: '', noParcelsComplete: false,
      livraisons: [EMPTY_LIV()],
      commentaires: '',
    };
  });

  /* Lignes budgétaires proposées dans le sélecteur : chaque intitulé n’apparaît
     qu’une fois — même si deux fiches existent (Fonctionnement / Investissement),
     la « Catégorie » (champ séparé) précisant le type à retenir. */
  const recetteOptions = useMemo(
    () => uniqueRecetteOptions(recettes, draft.categorie, draft.recetteId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recettes, draft.categorie, draft.recetteId]
  );

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
  /* Changer la « Catégorie » peut rendre incohérente la ligne déjà choisie :
     si une fiche homonyme du bon type existe, on bascule immédiatement dessus
     (visible dans le sélecteur) pour ne jamais enregistrer une dépense
     « Fonctionnement » sur une fiche « Investissement » (ou l’inverse). */
  const setCategorie = (ev) => {
    const value = ev.target.value;
    setDraft((d) => {
      if (!d.recetteId) return { ...d, categorie: value };
      const cur = recettes.find((r) => r.id === d.recetteId);
      if (!cur || !value || !txt(cur.type) || sameCatType(value, cur.type)) {
        return { ...d, categorie: value };
      }
      const twin = findRecetteTwin(recettes, cur, value);
      return twin
        ? { ...d, categorie: value, recetteId: twin.id, ligneBudgetaire: txt(twin.ligne) }
        : { ...d, categorie: value };
    });
  };
  /* Conflit résiduel affiché pendant l’édition : catégorie choisie ≠ type de la
     ligne imputée (fiche homonyme du bon type absente, ou ancien enregistrement
     que la réattribution automatique n’a pas pu corriger). */
  const catConflict = useMemo(() => {
    if (!draft.categorie || !draft.recetteId) return null;
    const cur = recettes.find((r) => r.id === draft.recetteId);
    if (!cur || !txt(cur.type) || sameCatType(draft.categorie, cur.type)) return null;
    const twin = findRecetteTwin(recettes, cur, draft.categorie);
    return {
      cur,
      hint: twin
        ? 'la ligne sera basculée sur la fiche homonyme du bon type lors de l’enregistrement.'
        : 'aucune fiche homonyme du bon type n’existe dans Recettes : créez-la d’abord ou corrigez la catégorie.',
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.categorie, draft.recetteId, recettes]);
  /* Enregistrement (asynchrone) : laisse le bouton afficher « Enregistrement… »
     pendant le classement des documents liés sur Google Drive. */
  const [saving, setSaving] = useState(false);
  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const ok = await onSave(draft, rec && rec.id);
      if (ok === false) setSaving(false); // validation refusée → le formulaire reste ouvert
    } catch (err) {
      console.error(err);
      setSaving(false);
    }
  };


  const previewLivs = useMemo(() => keepLivraisons(draft.livraisons), [draft.livraisons]);
  const previewReceived = previewLivs.filter((l) => txt(l.dateReception)).length;
  const previewComplete = completeValue(previewLivs, draft.livraisonComplete, draft.noParcelsComplete);

  /* « Rémunération stages » / « Remboursements » au sens du formulaire : nouvelle
     ligne saisie depuis l’onglet du même nom (classification pré-remplie) ou
     dépense existante dont la classification correspond. */
  const showStageBadge = stageForm || (editing && isStageDepense(draft));
  const showReimbBadge = reimbForm || (editing && isReimbDepense(draft));

  const auditor = rec
    ? `${rec.updatedAt ? `modifié le ${toFrDate(isoOf(new Date(rec.updatedAt).toISOString()))}` : ''} ${txt(rec.updatedBy && rec.updatedBy.name)}`
    : '';

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(3px)' }}>
      <div className="bg-slate-50 rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden max-h-[96vh] flex flex-col">
        <div className="px-5 py-3.5 bg-gradient-to-br from-blue-600 to-indigo-700 text-white shrink-0">
          <h2 className="text-lg font-black flex items-center gap-2">
            <span aria-hidden="true">{showStageBadge ? '🎓' : (showReimbBadge ? '💸' : kindIcon)}</span>
            {editing ? 'Modifier la dépense' : (showStageBadge ? 'Nouvelle rémunération de stage' : (showReimbBadge ? 'Nouveau remboursement de frais' : 'Nouvelle dépense'))}
            <span className={`text-[10px] font-black uppercase rounded-full px-2 py-0.5 ${omKind ? 'bg-white/20 text-white' : 'bg-white/15 text-blue-100'}`}>{showStageBadge ? 'Rémunération stages' : (showReimbBadge ? 'Remboursements' : kindLabel)}</span>
          </h2>
          <p className="text-blue-100 text-[11px]">
            {omKind && !isStageDepense(draft) && !isReimbDepense(draft)
              ? 'Dépense liée à un ordre de mission (type « OM ») : saisissez le montant de la mission acceptée et suivez la facture / le paiement. Vous pourrez ensuite la déplacer vers les onglets « Achats » ou « PI » via la colonne « ↔ Déplacer » du tableau.'
              : showStageBadge
                ? 'Rémunération de stage (gratification de stagiaire) : la « Classification / nature » est « Stages » (pré-remplie pour une nouvelle ligne depuis l’onglet « Rémunération stages »). Le formulaire complet des Achats est conservé (devis → BC / SIFAC → livraisons → facture). Cette dépense sera déduite du solde de la ligne budgétaire dans la page Recettes (colonne « Stages »).'
                : showReimbBadge
                  ? 'Cette ligne est classée « Remboursements » : les remboursements de frais sont désormais gérés par le registre dédié (onglet « Remboursements » de la page Dépenses) et seront rapatriés automatiquement ici — cette ligne Dépenses sera retirée de la table (ni devis, ni N° SIFAC/D.A., ni BC).'
                  : 'Formulaire complet de l’onglet « Dépenses » (devis → BC → livraisons → facture). Une commande peut avoir plusieurs livraisons ; elles se saisissent dans la partie « Livraisons ».'}
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
              {editing ? (
                <Field label="Suivi / Statut" hint="Valeur commune « suivi » et « statut » (statut « BC signé » = engagement suivi par la page Recettes).">
                  <input
                    className={MODAL_INPUT} value={draft.statut} onChange={set('statut')} list="depenses-statuts"
                    placeholder="ex. BC signé"
                  />
                  <datalist id="depenses-statuts">
                    {(statutOptions || []).map((s) => <option key={s} value={s} />)}
                  </datalist>
                </Field>
              ) : (
                <Field label="Suivi / Statut">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500 leading-snug">
                    <b className="text-slate-600">Automatique</b> — calculé à partir des documents saisis
                    (colonne « Etat » du tableau : devis signé → BC signé → livraison → facture → clôture).
                    Ce champ n’est pas à renseigner pour une nouvelle dépense.
                  </div>
                </Field>
              )}
              <Field label="Demandeur">
                <input
                  className={MODAL_INPUT} value={draft.demandeur} onChange={set('demandeur')} list="depenses-demandeurs"
                  placeholder="Prénom Nom"
                />
                <datalist id="depenses-demandeurs">
                  {(demandeurNames || []).map((n) => <option key={n} value={n} />)}
                </datalist>
              </Field>
              <Field label="Catégorie" hint="Fonctionnement / Investissement. La ligne budgétaire choisie ci-contre est automatiquement du même type ; une dépense classée « Fonctionnement » ne doit jamais être comptée sur une ligne « Investissement » de la page Recettes.">
                <select className={MODAL_INPUT} value={draft.categorie} onChange={setCategorie}>
                  <option value="">— non précisée —</option>
                  {(types || []).map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                {catConflict ? (
                  <div className="text-[10px] mt-1 leading-snug text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
                    ⚠ Catégorie « {draft.categorie} » mais ligne « {catConflict.cur.ligne} » ({catConflict.cur.type}) — {catConflict.hint}
                  </div>
                ) : null}
              </Field>
              <div className="lg:col-span-2">
                <Field label="Ligne budgétaire" hint="Chaque ligne n’apparaît qu’une fois — le type Fonctionnement / Investissement est porté par le champ « Catégorie » ci-dessus. Choisissez une ligne existante ou tapez librement son code/intitulé ; la liaison se fait automatiquement à l’enregistrement.">
                  <div className="flex gap-2">
                    <select className={`${MODAL_INPUT} w-2/5 shrink-0`} value={draft.recetteId || ''} onChange={pickRecette}>
                      <option value="">… choisir une ligne</option>
                      {(recetteOptions || []).map((r) => <option key={r.id} value={r.id}>{r.ligne}</option>)}
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
                  {/* La valeur courante (pré-remplie « Stages », ou classée dans le
                      classeur) est toujours proposée, même si la liste des natures a
                      été personnalisée dans Paramètres. « Remboursements » est
                      volontairement exclu : un remboursement vit dans son registre
                      dédié (onglet « Remboursements »), jamais dans la table Dépenses. */}
                  {(natures || [])
                    .concat([draft.classification])
                    .filter((n, i, a) => n && a.indexOf(n) === i)
                    .filter((n) => !isReimbNature(n))
                    .map((n) => <option key={n} value={n}>{n}</option>)}
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
              <Field
                label="Date de la demande"
                hint={editing ? '' : 'Renseignée automatiquement : jour de la création de la dépense.'}
              >
                <input
                  className={MODAL_INPUT} type="date" value={draft.dateDemande} onChange={set('dateDemande')}
                  disabled={!editing}
                />
              </Field>
              <div className="sm:col-span-2 lg:col-span-3">
                {omKind ? (
                  <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 px-3 py-2 text-[11px] text-indigo-700 leading-relaxed">
                    Dépense liée à un ordre de mission : <b>pas de fournisseur</b> attendu.
                    Si cette ligne est finalement payée via un fournisseur (ou un service interne), déplacez-la vers
                    « Achats » / « PI » (colonne « ↔ Déplacer » du tableau) puis renseignez le fournisseur ici.
                  </div>
                ) : (
                  <Field
                    label={showReimbBadge ? 'Nom du fournisseur' : (fournisseurRequired ? 'Nom du fournisseur *' : 'Nom du fournisseur')}
                    hint={showReimbBadge
                      ? 'Facultatif pour un remboursement : les frais ont été avancés par un membre, il n’y a pas de fournisseur. « PI » = prestation interne : service interne facturé sans BC.'
                      : fournisseurRequired
                        ? 'Obligatoire. « PI » = prestation interne : service interne facturé sans BC — comptée comme engagée/consommée dans la page Recettes. Le contact se gère dans la fiche du fournisseur (Librairie).'
                        : '« PI » = prestation interne : service interne facturé sans BC — comptée comme engagée/consommée dans la page Recettes. Le contact se gère dans la fiche du fournisseur (Librairie).'}
                  >
                    <input
                      className={MODAL_INPUT} value={draft.fournisseur} onChange={set('fournisseur')} list="depenses-fournisseurs"
                      placeholder="ex. Amazon Marketplace / Fournitures Laposte / PI…"
                    />
                    <datalist id="depenses-fournisseurs">
                      {(fournisseurNames || []).map((n) => <option key={n} value={n} />)}
                    </datalist>
                  </Field>
                )}
              </div>
            </div>
          </Section>
          {/* C. Documents & dates */}
          <Section icon="📎" title="Documents & dates — liens ↗ facultatifs">
            <p className="text-[10px] text-slate-500 leading-relaxed mb-3 -mt-0.5">
              💡 À l’enregistrement, chaque lien Google Drive saisi dans ce formulaire (devis, BC, facture, OM ci-dessous,
              BL / SF dans la section Livraisons) est automatiquement rangé dans le dossier du dataset
              › <b>Budget_labo/{new Date().getFullYear()}/</b><b>Devis · BC · BL · OM · Factures</b> — les dossiers manquants
              sont créés et une <b>copie</b> du fichier (nommée selon la convention) y est déposée : l’original
              n’est jamais déplacé ni modifié, et un fichier déjà au bon endroit n’est pas dupliqué.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2 lg:col-span-1">
                <Field label="N° devis">
                  <div className="flex flex-col gap-1.5">
                    <input className={MODAL_INPUT} value={draft.numDevis} onChange={set('numDevis')} placeholder="ex. 482750394" />
                    <BudgetDocLinkInput
                      folder={BUDGET_DOC_FOLDER_BY_FIELD.numDevisUrl || 'Devis'}
                      value={draft.numDevisUrl}
                      onChange={(v) => setDraft((d) => ({ ...d, numDevisUrl: v }))}
                      nameFor={(file) => depenseDocDriveName(draft, { prefix: 'Devis', code: draft.numDevis, docDate: draft.dateSignatureDevis }, file)}
                      placeholder="🔗 lien du devis (Drive) — ou fichier depuis ce PC"
                      title="Lien vers le devis — rangé à l’enregistrement dans Budget_labo/<année>/Devis"
                    />
                  </div>
                </Field>
              </div>
              <div className="sm:col-span-2 lg:col-span-1">
                <Field label={<abbr title="D.A. = Demande d’Achat. Le « N° SIFAC » (ex. 2026000000) est le n° de la demande d’achat enregistrée dans SIFAC par la gestionnaire (transmission du devis) — il suit la commande jusqu’au bon de commande signé." className="cursor-help">N° SIFAC/D.A.</abbr>}>
                  <input className={MODAL_INPUT} value={draft.numSIFAC} onChange={set('numSIFAC')} placeholder="ex. 2026000000" />
                </Field>
              </div>
              <div className="sm:col-span-2 lg:col-span-1">
                <Field label="N° BC">
                  <div className="flex flex-col gap-1.5">
                    <input className={MODAL_INPUT} value={draft.numBC} onChange={set('numBC')} placeholder="ex. R20180912" />
                    <BudgetDocLinkInput
                      folder={BUDGET_DOC_FOLDER_BY_FIELD.numBCUrl || 'BC'}
                      value={draft.numBCUrl}
                      onChange={(v) => setDraft((d) => ({ ...d, numBCUrl: v }))}
                      nameFor={(file) => depenseDocDriveName(draft, { prefix: 'BC', code: draft.numBC, docDate: draft.dateBC }, file)}
                      placeholder="🔗 lien du BC (Drive) — ou fichier depuis ce PC"
                      title="Lien vers le bon de commande — rangé dans Budget_labo/<année>/BC"
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
                <Field label="Date signature devis">
                  <input className={MODAL_INPUT} type="date" value={draft.dateSignatureDevis} onChange={set('dateSignatureDevis')} />
                </Field>
              </div>
              <div className="sm:col-span-2 lg:col-span-1">
                <Field label="Date approbation fournisseur">
                  <input className={MODAL_INPUT} type="date" value={draft.dateApprobFournisseur} onChange={set('dateApprobFournisseur')} />
                </Field>
              </div>
              <div className="sm:col-span-2 lg:col-span-1">
                <Field label="N° facture">
                  <div className="flex flex-col gap-1.5">
                    <input className={MODAL_INPUT} value={draft.numFacture} onChange={set('numFacture')} placeholder="ex. F-2026-0041" />
                    <BudgetDocLinkInput
                      folder={BUDGET_DOC_FOLDER_BY_FIELD.numFactureUrl || 'Factures'}
                      value={draft.numFactureUrl}
                      onChange={(v) => setDraft((d) => ({ ...d, numFactureUrl: v }))}
                      placeholder="🔗 lien de la facture (Drive) — ou fichier depuis ce PC"
                      title="Lien vers la facture — rangée dans Budget_labo/<année>/Factures"
                    />
                  </div>
                </Field>
              </div>
              <div className="sm:col-span-2 lg:col-span-1">
                <Field label="N° OM / paiement">
                  <div className="flex flex-col gap-1.5">
                    <input className={MODAL_INPUT} value={draft.omNo} onChange={set('omNo')} placeholder="ex. OM 2026-124" />
                    <BudgetDocLinkInput
                      folder={BUDGET_DOC_FOLDER_BY_FIELD.omUrl || 'OM'}
                      value={draft.omUrl}
                      onChange={(v) => setDraft((d) => ({ ...d, omUrl: v }))}
                      placeholder="🔗 lien du paiement (Drive) — ou fichier depuis ce PC"
                      title="Lien vers l’ordre de paiement / mandatement — rangé dans Budget_labo/<année>/OM"
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

            <p className="text-[10px] text-slate-400 leading-relaxed mb-2">
              Les liens BL / SF sont également rangés à l’enregistrement dans Budget_labo/{new Date().getFullYear()}/BL.
            </p>

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
                        <BudgetDocLinkInput
                          folder={BUDGET_DOC_FOLDER_BY_FIELD.numBLUrl || 'BL'}
                          value={l.numBLUrl}
                          onChange={(v) => setDraft((d) => ({
                            ...d,
                            livraisons: d.livraisons.map((x, j) => (j === i ? { ...x, numBLUrl: v } : x)),
                          }))}
                          nameFor={(file) => depenseDocDriveName(draft, { prefix: 'BL', code: l.numBL, docDate: l.dateReception }, file)}
                          placeholder="🔗 lien du BL (Drive) — ou fichier depuis ce PC"
                          title="Lien du BL — classé à l’enregistrement dans Budget_labo/<année>/BL"
                        />
                      </Field>
                    </div>
                    <div className="sm:col-span-2 lg:col-span-2">
                      <Field label="SF — lien document">
                        <BudgetDocLinkInput
                          folder={BUDGET_DOC_FOLDER_BY_FIELD.numSFUrl || 'BL'}
                          value={l.numSFUrl}
                          onChange={(v) => setDraft((d) => ({
                            ...d,
                            livraisons: d.livraisons.map((x, j) => (j === i ? { ...x, numSFUrl: v } : x)),
                          }))}
                          placeholder="🔗 lien du SF / PV (Drive) — ou fichier depuis ce PC"
                          title="Lien du SF / PV — classé à l’enregistrement dans Budget_labo/<année>/BL"
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
            type="button" onClick={handleSave} disabled={saving}
            className="px-5 py-2 rounded-xl text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-wait"
          >{saving ? 'Enregistrement…' : (editing ? 'Enregistrer les modifications' : 'Enregistrer la dépense')}</button>
        </div>
      </div>
    </div>
  );
};

/* ═════════════════════════════════════════════════════════════════════════
   Fenêtre d’ajout / édition d’un remboursement de frais — registre dédié
   (collection `reimbursements`). Formulaire calqué sur le modèle d’un OM
   prévu (objet, bénéficiaire, destination, référence, dates, coûts détaillés,
   imputation budgétaire, commentaires) SANS la partie statut (En attente /
   Acceptée / Refusée) et SANS aucune section devis / N° SIFAC / BC /
   fournisseur. Une fiche créée reste dans son registre : elle ne migre jamais
   vers les onglets Achats / PI / OM de la table Dépenses.
   ═════════════════════════════════════════════════════════════════════════ */
const pickReimbCost = (rec, c) => {
  if (!rec) return null;
  for (const k of [c.key, ...(c.legacy || [])]) {
    const v = rec[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return null;
};

const RemboursementModal = ({ rec, recettes, types, demandeurNames, onCancel, onSave }) => {
  const editing = !!rec;
  const [error, setError] = useState('');
  const [draft, setDraft] = useState(() => ({
    description: txt(rec && rec.description),
    demandeur: txt(rec && rec.demandeur),
    destination: txt(rec && rec.destination),
    numOM: txt(rec && rec.numOM),
    etatLiquidatifUrl: txt(rec && rec.etatLiquidatifUrl),
    categorie: txt(rec && rec.categorie),
    recetteId: (rec && rec.recetteId) || '',
    ligneBudgetaire: txt(rec && rec.ligneBudgetaire),
    dateDemande: isoOf(rec && rec.dateDemande) || todayIso(),
    dateMission: isoOf(rec && rec.dateMission),
    dateRetour: isoOf(rec && rec.dateRetour),
    coutVoyage: numToInput(pickReimbCost(rec, REIMBURSEMENT_COST_FIELDS[0])),
    coutLogement: numToInput(pickReimbCost(rec, REIMBURSEMENT_COST_FIELDS[1])),
    coutRepas: numToInput(pickReimbCost(rec, REIMBURSEMENT_COST_FIELDS[2])),
    coutInscription: numToInput(pickReimbCost(rec, REIMBURSEMENT_COST_FIELDS[3])),
    coutStatut: txt(rec && rec.coutStatut) || 'Exact',
    commentaires: txt(rec && rec.commentaires),
    aCorriger: !!(rec && rec.aCorriger),
  }));
  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  /* Ligne budgétaire : sélection parmi les fiches Recettes (une seule par
     intitulé, celle du type correspondant à la catégorie si possible) ou
     saisie libre — la liaison est résolue à l’enregistrement. */
  const recetteOptions = useMemo(
    () => uniqueRecetteOptions(recettes, draft.categorie, draft.recetteId),
    [recettes, draft.categorie, draft.recetteId]
  );
  const pickRecette = (e) => {
    const id = e.target.value;
    setDraft((d) => {
      const cur = recettes.find((r) => r.id === id);
      return {
        ...d,
        recetteId: id,
        ligneBudgetaire: cur ? cur.ligne : d.ligneBudgetaire,
        categorie: d.categorie || (cur && cur.type) || '',
      };
    });
  };
  const editLigne = (e) => {
    const val = e.target.value;
    setDraft((d) => {
      const cur = d.recetteId ? recettes.find((r) => r.id === d.recetteId) : null;
      const same = cur && norm(cur.ligne) === norm(val);
      return { ...d, ligneBudgetaire: val, recetteId: same ? d.recetteId : '' };
    });
  };

  /* Coûts : le total est recalculé en direct (comme sur le formulaire OM). */
  const liveTotal = useMemo(() => {
    const parts = REIMBURSEMENT_COST_FIELDS
      .map((c) => parseNum(draft[c.key]))
      .filter((n) => n !== null);
    return parts.length ? Math.round(parts.reduce((s, n) => s + n, 0) * 100) / 100 : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.coutVoyage, draft.coutLogement, draft.coutRepas, draft.coutInscription]);
  const previousTotal = numOf(rec && rec.coutTotal);
  const displayTotal = liveTotal !== null ? liveTotal : previousTotal;

  const submit = () => {
    const description = txt(draft.description);
    if (!description) {
      setError('Merci de renseigner l’objet du remboursement : c’est son intitulé (obligatoire).');
      return;
    }
    setError('');
    onSave(
      {
        description,
        demandeur: txt(draft.demandeur),
        destination: txt(draft.destination),
        numOM: txt(draft.numOM),
        etatLiquidatifUrl: txt(draft.etatLiquidatifUrl),
        categorie: txt(draft.categorie),
        recetteId: draft.recetteId,
        ligneBudgetaire: txt(draft.ligneBudgetaire),
        dateDemande: isoOf(draft.dateDemande),
        dateMission: isoOf(draft.dateMission),
        dateRetour: isoOf(draft.dateRetour),
        coutVoyage: parseNum(draft.coutVoyage),
        coutLogement: parseNum(draft.coutLogement),
        coutRepas: parseNum(draft.coutRepas),
        coutInscription: parseNum(draft.coutInscription),
        coutStatut: txt(draft.coutStatut) || 'Exact',
        coutTotal: displayTotal,
        commentaires: txt(draft.commentaires),
        aCorriger: draft.aCorriger === true,
      },
      editing && rec.id
    );
  };

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(3px)' }}>
      <div className="bg-slate-50 rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden max-h-[94vh] flex flex-col">
        <div className="px-6 py-4 bg-gradient-to-br from-blue-700 to-indigo-800 text-white flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-black flex items-center gap-2">
              <span className="text-xl" aria-hidden="true">💸</span>
              {editing ? 'Modifier le remboursement' : 'Ajouter un remboursement'}
            </h2>
            <p className="text-blue-100 text-xs">
              Frais avancés par un membre puis remboursés par le laboratoire — formulaire sur le modèle d’un OM prévu,
              sans devis / N° SIFAC / BC ni fournisseur.
            </p>
          </div>
          <button type="button" onClick={onCancel} className="shrink-0 w-8 h-8 rounded-lg bg-white/15 hover:bg-white/30 text-white font-bold" title="Fermer">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-5 flex flex-col gap-3">
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-semibold text-red-600">
              {error}
            </div>
          )}

          {editing && rec && rec.aCorriger && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[11px] text-amber-800 leading-relaxed">
              ⚠️ Fiche créée automatiquement depuis un OM prévu : montants encore <b>estimés</b>. Corrigez-les une fois
              les justificatifs réels connus, puis décochez la case « Frais À corriger » dans la section Coûts.
            </div>
          )}

          <Section icon="💸" title="Remboursement">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <Field label="Objet du remboursement *">
                  <input
                    className={MODAL_INPUT} value={draft.description} onChange={set('description')}
                    placeholder="ex. Congrès — frais d’inscription, billet de train…" autoFocus
                  />
                </Field>
              </div>
              <Field label="Bénéficiaire" hint="Le membre qui a avancé les frais — il n’y a pas de fournisseur.">
                <input
                  className={MODAL_INPUT} value={draft.demandeur} onChange={set('demandeur')}
                  list="remboursements-beneficiaires" placeholder="Prénom Nom"
                />
                <datalist id="remboursements-beneficiaires">
                  {(demandeurNames || []).map((n) => <option key={n} value={n} />)}
                </datalist>
              </Field>
              <Field label="Destination / contexte" hint="Optionnel — lieu de la mission, boutique, salon…">
                <input className={MODAL_INPUT} value={draft.destination} onChange={set('destination')} placeholder="ex. Barcelone (Espagne)" />
              </Field>
              <Field label="N° OM / référence" hint="Si un numéro d’ordre de mission ou de justificatif a été attribué.">
                <input className={MODAL_INPUT} value={draft.numOM} onChange={set('numOM')} placeholder="ex. 2025-042" />
              </Field>
              <Field label="Commentaires">
                <input className={MODAL_INPUT} value={draft.commentaires} onChange={set('commentaires')} placeholder="Contexte, justificatif, remarque…" />
              </Field>
            </div>
          </Section>

          <Section icon="📅" title="Dates">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Date de la demande">
                <input className={MODAL_INPUT} type="date" value={draft.dateDemande} onChange={set('dateDemande')} />
              </Field>
              <Field label="Début des frais" hint="Départ (période concernée).">
                <input className={MODAL_INPUT} type="date" value={draft.dateMission} onChange={set('dateMission')} />
              </Field>
              <Field label="Fin des frais" hint="Retour (période concernée).">
                <input className={MODAL_INPUT} type="date" value={draft.dateRetour} onChange={set('dateRetour')} />
              </Field>
            </div>
          </Section>

          <Section icon="🧾" title="Coûts (frais avancés)">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {REIMBURSEMENT_COST_FIELDS.map((c) => (
                <Field key={c.key} label={c.label}>
                  <div className="flex items-center gap-2">
                    <span className="text-sm leading-none">{c.icon}</span>
                    <input
                      className={MODAL_INPUT} value={draft[c.key]} onChange={set(c.key)}
                      placeholder="0,00 €" inputMode="decimal"
                    />
                  </div>
                </Field>
              ))}
              <div className="sm:col-span-2 flex items-center justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-2.5">
                <span className="text-xs font-black uppercase text-slate-500">Coût total</span>
                <span className="text-lg font-black text-blue-800">{displayTotal !== null ? euro.format(displayTotal) : '—'}</span>
              </div>
              <div className="sm:col-span-2">
                <Field label="Montant estimé ou exact" hint="« Estimé » avant la dépense, « Exact » une fois les justificatifs connus.">
                  <select className={MODAL_INPUT} value={draft.coutStatut} onChange={set('coutStatut')}>
                    <option value="Estimé">Estimé</option>
                    <option value="Exact">Exact</option>
                  </select>
                </Field>
              </div>
              {editing && rec && rec.aCorriger && (
                <div className="sm:col-span-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
                  <label className="flex items-start gap-2 text-[11px] text-amber-800 cursor-pointer leading-snug">
                    <input
                      type="checkbox"
                      className="mt-0.5 shrink-0"
                      checked={draft.aCorriger !== false}
                      onChange={(e) => setDraft((d) => ({ ...d, aCorriger: e.target.checked }))}
                    />
                    <span>
                      <b>Frais « À corriger »</b> — fiche créée automatiquement depuis un OM prévu : montants encore
                      estimés. <b>Corrigez</b> les montants une fois les justificatifs réels connus, puis <b>décochez
                      cette case</b> : le badge « À corriger » disparaît de la liste et solde les postes de l'OM dans la
                      page « OM prévus / souhaités ».
                    </span>
                  </label>
                </div>
              )}
            </div>
          </Section>

          <Section icon="🗄️" title="État liquidatif (fichier signé du remboursement)">
            <div className="grid grid-cols-1 gap-3">
              <Field
                label="Lien Google Drive du document signé"
                hint="État liquidatif / pièce signée qui valide le remboursement. Collez le lien du fichier (PDF de préférence) : à l’enregistrement, une copie est classée dans Budget_labo/<année>/OM et le lien apparaît sur la ligne du tableau « Remboursements »."
              >
                <input
                  className={MODAL_INPUT}
                  value={draft.etatLiquidatifUrl || ''}
                  onChange={set('etatLiquidatifUrl')}
                  placeholder="https://drive.google.com/file/d/…/view"
                />
              </Field>
            </div>
          </Section>

          <Section icon="🏦" title="Imputation budgétaire">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Catégorie" hint="Fonctionnement / Investissement — doit correspondre au type de la ligne budgétaire choisie.">
                <select className={MODAL_INPUT} value={draft.categorie} onChange={set('categorie')}>
                  <option value="">— non précisée —</option>
                  {(types || []).map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <div>
                <Field label="Ligne budgétaire" hint="Chaque ligne n’apparaît qu’une fois — choisissez une ligne existante ou tapez librement son code / intitulé ; la liaison se fait automatiquement à l’enregistrement.">
                  <div className="flex gap-2">
                    <select className={`${MODAL_INPUT} w-2/5 shrink-0`} value={draft.recetteId || ''} onChange={pickRecette}>
                      <option value="">… choisir</option>
                      {recetteOptions.map((r) => <option key={r.id} value={r.id}>{r.ligne}</option>)}
                    </select>
                    <input
                      className={MODAL_INPUT} value={draft.ligneBudgetaire} onChange={editLigne}
                      placeholder="ex. S2R01GEC (INTRUDE)"
                    />
                  </div>
                </Field>
              </div>
            </div>
            <p className="text-[11px] text-slate-400 mt-2 leading-snug">
              Le total sera déduit du solde de cette ligne dans la page Recettes (colonne « Remboursements »). Le
              remboursement reste ici, dans son registre : il ne migre jamais vers les Dépenses (Achats / PI / OM).
            </p>
          </Section>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button" onClick={onCancel}
              className="px-5 py-2 rounded-xl text-sm font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50"
            >Annuler</button>
            <button
              type="button" onClick={submit}
              className="px-5 py-2 rounded-xl text-sm font-bold text-white bg-blue-600 hover:bg-blue-700"
            >{editing ? 'Enregistrer les modifications' : 'Ajouter le remboursement'}</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export { DepensesPage };














