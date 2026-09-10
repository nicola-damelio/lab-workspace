/* =========================================================================
   src/administration/desiderataPage.jsx
   Page « Achats prévus / souhaités » (souhaits d’achat, collection desiderate).
   CRUD complet en remplacement de la liste générique :

     · bouton « ＋ Ajouter un achat prévu / souhaité » : le demandeur déclare
       l’article, le fournisseur, la ligne budgétaire suggérée, le COÛT
       estimé et les FRAIS DE PORT ;
     · isolation par membre : CHAQUE utilisateur ne voit que les achats qu’il
       a lui-même déposés (et leur état : décision, devis, BC) — jamais ceux
       des autres. Le superutilisateur, qui décide et transfère, voit tout.
       Le champ « demandeur » est verrouillé sur soi-même (« demandeur = moi ») ;
     · pour qu’un transfert produise un devis COMPLET, un membre doit fournir
       à la saisie : la description, le N° devis, la ligne budgétaire, le
       fournisseur, le montant, les frais de port et le fichier du devis
       (téléversé sur Google Drive Budget_labo/<année>/Devis, ou lien collé) ;
     · la PREMIÈRE colonne contient la décision du superutilisateur
       (Approuvé / En attente / Test / Pas maintenant — personnalisable dans
       Setup › Options des listes déroulantes) ; les autres membres ne
       peuvent pas modifier cette décision. « Test » = montant compté dans les
       prévisions « Achats prévus » de la page Recettes sans acceptation réelle ;
     · colonnes cliquables : fournisseur → Librerie, ligne budgétaire →
       Librerie (onglet Lignes budgétaires), demandeur → fiche Personnel.

   Modèle stocké (mêmes clés que l’import Google Sheets « Souhaités ») :
     { description, urgence / priorite, demandeur, categorie,
       recetteSuggereeId, ligneBudgetaire, montantEstime, fraisPort,
       dateDemande, fournisseur, contact, numDevis, numDevisUrl, devis2,
       devis3, codeProduit, commentaires, statut, statutChangedBy?,
       statutChangedAt? }
     + enveloppe d’audit posée par upsert() (createdAt/By, updatedAt/By).
   ========================================================================= */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAdmin } from './AdminContext';
import { SmartTable } from './smartTable';
import { AdminImportModal } from './adminImportModal';
import {
  ADMIN_PAGES, RECETTE_TYPES, URGENCES, DESIDERATE_STATUSES, DESIDERATE_TEST,
  desiderataDecisionOf, isDesiderataApproved, isDesiderataTest, APPROVAL_GESTION,
} from './adminSchema';
import { parseEuroAmount, extractNumeroFromDoc } from './importUtils';
import {
  sendAdminMail, personnelEmailsMatching, superuserEmailsOf, mergeEmails,
  summarizeMail, mailBodyText,
} from './emailNotify';
import { uploadLocalFile, cloudBackendAvailable } from '../utils/driveUpload';
import { budgetDocPath, budgetDocFileName } from './driveFiling';
import { scopeMeNames, scopeMePersonId, scopeCanSeeItem, scopePersonIdForName } from './ownScope';
import {
  TRANSFER_TARGETS, targetMetaOf, cibleEmailsOf, TRANSFER_MODES,
  devisPatchFromDesiderata, desiderataTransferStatus, isDepenseBcSigne,
  demandeDevisCompleteOf, isDevisGestion,
} from './transferAchats';

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
const norm = (s) => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const demandeurOf = (r) => pick(r, ['demandeur', 'porteur', 'nom', 'name']);
const devisUrlOf = (r) => txt(pick(r, ['fichierUrl', 'numDevisUrl', 'devisUrl', 'urlDevis', 'lienDevis', 'devisLink']));
const addScheme = (u) => (/^(https?:|mailto:|tel:)/i.test(u) ? u : `https://${u}`);

/* Code « devis » avec lien Google Drive facultatif vers le document. */
const DevisLink = ({ code, url }) => {
  const v = txt(code);
  const u = txt(url);
  if (!v && !u) return <span className="text-slate-300">—</span>;
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
        <span className="font-mono text-[11px] font-semibold text-slate-600 truncate" title={v}>{label}</span>
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

/* Petits éléments d’affichage (mêmes classes que les autres pages d’admin). */
const TONES = {
  slate: 'bg-slate-100 border-slate-200 text-slate-600',
  blue: 'bg-blue-50 border-blue-200 text-blue-700',
  indigo: 'bg-indigo-50 border-indigo-200 text-indigo-700',
  emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  amber: 'bg-amber-50 border-amber-200 text-amber-700',
  orange: 'bg-orange-50 border-orange-200 text-orange-700',
  red: 'bg-red-50 border-red-200 text-red-600',
  violet: 'bg-violet-50 border-violet-200 text-violet-700',
  teal: 'bg-teal-50 border-teal-200 text-teal-700',
};
const Badge = ({ tone = 'slate', children }) => (
  <span className={`inline-block text-[10px] font-black uppercase px-2 py-0.5 rounded-full border ${TONES[tone] || TONES.slate}`}>
    {children}
  </span>
);

/* Pastille de DÉCISION (superutilisateur) à partir de la valeur stockée.
   « Approved » / « Pending » / « Rejected / Pas maintenant » (anciens imports)
   sont automatiquement affichés dans leur équivalent français. Seul
   « Approuvé » est vert ; « En attente », « Test » (compté en prévision, sans
   acceptation) et « Pas maintenant » restent en AMBRE (jaune) pour ne jamais
   laisser croire à un refus ou à une acceptation. */
const DECISION_TONES = {
  [desiderataDecisionOf('Approved')]: 'emerald',
  [desiderataDecisionOf('Pending')]: 'amber',
  [desiderataDecisionOf('Test')]: 'amber',
  [desiderataDecisionOf('Rejected / Pas maintenant')]: 'amber',
};
const decisionTone = (raw) => DECISION_TONES[desiderataDecisionOf(raw)] || 'slate';
const DecisionBadge = ({ raw }) =>
  txt(raw)
    ? <Badge tone={decisionTone(raw)}>{desiderataDecisionOf(raw)}</Badge>
    : <Badge tone="slate">En attente</Badge>;

/* ── Fenêtre d’ajout / édition d’un achat prévu / souhaité ─────────────── */
const MODAL_INPUT = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500';
const MODAL_URL_INPUT = `${MODAL_INPUT} font-mono text-xs text-blue-700 placeholder:text-slate-300 placeholder:font-sans`;
const MODAL_LABEL = 'block text-[10px] font-black uppercase text-slate-400 tracking-wide mb-1';

const Field = ({ label, required, children, className = '', hint }) => (
  <div className={className}>
    <label className={MODAL_LABEL}>{label}{required ? <span className="text-red-400"> *</span> : null}</label>
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


/* Le formulaire complet : le membre décrit le souhait d’achat avec TOUTES les
   informations nécessaires à la création du devis au transfert (description,
   N° devis, ligne budgétaire, fournisseur, montant, frais de port, fichier du
   devis). Le champ « demandeur » est verrouillé sur soi-même pour les membres
   (« demandeur = moi ») : chacun ne voit que ses propres souhaits. La décision
   reste réservée au superutilisateur. */
const DesiderataModal = ({
  rec, recettes, demandeurNames, fournisseurNames,
  types, urgenceOptions, decisionOptions, canDecide, currentUser,
  meNames = [], mePersonId = null, personnel = [], lockDemandeurToMe = false,
  onApproved, onCancel, onSave,
}) => {
  const editing = !!rec;
  const meName = (meNames && meNames[0]) || '';
  /* Le membre (et toute NOUVELLE demande) doit fournir toutes les informations
     nécessaires à la création du devis au transfert. Seul le superutilisateur
     qui édite une ancienne ligne d’import minimale en est dispensé. */
  const requiredInfo = !editing || !canDecide;
  const [draft, setDraft] = useState(() => {
    const r = rec || {};
    const url = devisUrlOf(r);
    return {
      description: txt(r && r.description),
      /* Nouvelle demande : le demandeur est automatiquement le membre connecté
         (« demandeur = moi »). Le superutilisateur peut le changer pour une
         autre personne quand il saisit une demande pour le compte de l’équipe. */
      demandeur: editing ? txt(demandeurOf(r)) : (meName || txt(demandeurOf(r))),
      categorie: txt(r && r.categorie),
      urgence: txt(pick(r, ['priorite', 'urgence'])),
      recetteSuggereeId: (r && r.recetteSuggereeId) || '',
      ligneBudgetaire: txt(r && r.ligneBudgetaire),
      montantEstime: numToInput(r && r.montantEstime),
      fraisPort: numToInput(r && r.fraisPort),
      fournisseur: txt(pick(r, ['fournisseur', 'nomFournisseur'])),
      contact: txt(r && r.contact),
      numDevis: txt(pick(r, ['numDevis', 'devisNo'])),
      numDevisUrl: url,
      fichierNom: txt(r && (r.fichierNom || r.devisFileName)),
      fichierUrl: url,
      fichierMime: txt(r && r.fichierMime),
      devis2: txt(r && r.devis2),
      devis2Url: txt(r && r.devis2Url),
      devis2Nom: txt(r && (r.devis2Nom || r.fichierNom2)),
      devis2Mime: txt(r && r.devis2Mime),
      devis3: txt(r && r.devis3),
      devis3Url: txt(r && r.devis3Url),
      devis3Nom: txt(r && (r.devis3Nom || r.fichierNom3)),
      devis3Mime: txt(r && r.devis3Mime),
      codeProduit: txt(r && r.codeProduit),
      /* La date de la demande se remplit automatiquement (jour de la
         soumission) pour une nouvelle demande. */
      dateDemande: editing
        ? isoOf(r && r.dateDemande)
        : (() => {
          const d = new Date();
          const p = (n) => String(n).padStart(2, '0');
          return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
        })(),
      commentaires: txt(r && r.commentaires),
      statut: txt(r && r.statut) || 'En attente',
    };
  });
  const [error, setError] = useState('');
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');
  const fileInputRef = useRef(null);
  const devis2FileRef = useRef(null);
  const devis3FileRef = useRef(null);
  const set = (key) => (e) => setDraft((d) => ({ ...d, [key]: e.target.value }));

  const setRecette = (e) => {
    const id = e.target.value;
    const found = recettes.find((x) => x.id === id);
    setDraft((d) => ({
      ...d,
      recetteSuggereeId: id,
      ligneBudgetaire: found ? txt(found.ligne) : '',
      categorie: found && found.type && !txt(d.categorie) ? txt(found.type) : txt(d.categorie),
    }));
  };

  /* Même intitulé de ligne budgétaire = plusieurs fiches dans Recettes (une
     par type Fonctionnement / Investissement). Dans le menu on n’en propose
     qu’UNE par intitulé : la « Catégorie (Fonct. / Invest.) » choisie
     ci-dessus précise le type à retenir (une fiche de l’autre type ne reçoit
     jamais la demande). */
  const catKey = (v) => txt(v).toLowerCase().replace(/\s+/g, ' ').trim();
  const lineKey = (r) => txt(r && (r.ligne || r.name) || r.id).toLowerCase().replace(/\s+/g, ' ').trim();
  const recetteGroups = new Map();
  (Array.isArray(recettes) ? recettes : []).forEach((r) => {
    if (!r || !r.id) return;
    const k = lineKey(r);
    if (!k) return;
    if (!recetteGroups.has(k)) recetteGroups.set(k, []);
    recetteGroups.get(k).push(r);
  });
  const wantCat = catKey(draft.categorie);
  const recetteOptions = [...recetteGroups.values()].map((group) =>
    (wantCat ? group.find((r) => catKey(r.type) === wantCat) : null)
    || group.find((r) => r.id === draft.recetteSuggereeId)
    || group.find((r) => catKey(r.type).includes('fonctionnement'))
    || group[0]);
  const recetteDupCount = (Array.isArray(recettes) ? recettes : []).length - recetteOptions.length;

  /* Changement de la catégorie : si la ligne déjà choisie est d’un autre type,
     on bascule sur la fiche homonyme du bon type quand elle existe. */
  const setDesCategorie = (e) => {
    const cat = e.target.value;
    setDraft((d) => {
      const cur = (Array.isArray(recettes) ? recettes : []).find((x) => x.id === d.recetteSuggereeId);
      if (cur && cat && catKey(cur.type) !== catKey(cat)) {
        const twin = (Array.isArray(recettes) ? recettes : []).find(
          (x) => x.id !== cur.id && lineKey(x) === lineKey(cur) && catKey(x.type) === catKey(cat)
        );
        if (twin) {
          return {
            ...d,
            categorie: cat,
            recetteSuggereeId: twin.id,
            ligneBudgetaire: txt(twin.ligne),
          };
        }
      }
      return { ...d, categorie: cat };
    });
  };

  const todayIso = () => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };

  /* Lien du devis : si aucun N° n’est saisi, on le pré-remplit depuis le nom du
     fichier porté par l’adresse (ex. « Devis_2026-015_Fournisseur.pdf »).
     Modifier le lien « à la main » retire les métadonnées d’un fichier téléversé
     depuis le PC (le lien reste, seuls le nom et le MIME redeviennent vides). */
  const setNumDevisUrl = (e) => {
    const u = e.target.value;
    setDraft((d) => {
      const sameFile = txt(d.fichierUrl) && txt(u) === txt(d.fichierUrl);
      return {
        ...d,
        numDevisUrl: u,
        fichierUrl: u,
        fichierNom: sameFile ? d.fichierNom : '',
        fichierMime: sameFile ? d.fichierMime : '',
        numDevis: d.numDevis || extractNumeroFromDoc(u),
      };
    });
  };

  /* Lien d'un devis concurrent (2 ou 3) : modifié à la main → le nom / MIME
     d'un fichier téléversé depuis le PC est retiré (le lien reste). */
  const setSlotDevisUrl = (slot) => (e) => {
    const u = e.target.value;
    const urlKey = `devis${slot}Url`;
    const nomKey = `devis${slot}Nom`;
    const mimeKey = `devis${slot}Mime`;
    setDraft((d) => {
      const sameFile = txt(d[urlKey]) && txt(u) === txt(d[urlKey]);
      return { ...d, [urlKey]: u, [nomKey]: sameFile ? d[nomKey] : '', [mimeKey]: sameFile ? d[mimeKey] : '' };
    });
  };

  /* Téléversement du fichier d'un devis concurrent (2 ou 3) vers
     Budget_labo/<année>/Devis, comme pour le devis principal. */
  const pickSlotFile = async (file, slot) => {
    if (!file) return;
    setUploadMsg('');
    if (!cloudBackendAvailable()) {
      setUploadMsg(`⚠️ Google Drive n’est pas connecté — collez le lien du devis ${slot} ci-dessous (nécessaire pour un transfert « pour signature »).`);
      return;
    }
    setUploadBusy(true);
    try {
      const year = new Date().getFullYear();
      const driveName = budgetDocFileName({
        prefix: `Devis${slot}`,
        code: txt(draft[`devis${slot}`]),
        ligne: txt(draft.ligneBudgetaire),
        fournisseur: txt(draft.fournisseur),
        demandeur: txt(draft.demandeur) || meName,
        date: todayIso(),
        fileName: file.name,
      }) || String(file.name || 'document').trim().slice(0, 180);
      const drive = await uploadLocalFile({
        name: driveName,
        mimeType: file.type || 'application/octet-stream',
        file,
        path: budgetDocPath(year, 'Devis'),
      });
      if (drive && drive.driveUrl) {
        const url = txt(drive.driveUrl);
        const storedName = String(drive.name || file.name || driveName).trim().slice(0, 180);
        setDraft((d) => ({
          ...d,
          [`devis${slot}Url`]: url,
          [`devis${slot}Nom`]: storedName,
          [`devis${slot}Mime`]: file.type || '',
          [`devis${slot}`]: txt(d[`devis${slot}`]) || extractNumeroFromDoc(storedName),
        }));
        setUploadMsg(`✓ Devis ${slot} téléversé dans Budget_labo/${year}/Devis.`);
      } else {
        setUploadMsg(`⚠️ Téléversement impossible — collez le lien du devis ${slot} ci-dessous.`);
      }
    } catch (err) {
      console.error(err);
      setUploadMsg(`⚠️ Téléversement impossible : ${(err && err.message) || err}`);
    } finally {
      setUploadBusy(false);
    }
  };

  /* Téléversement du fichier devis vers Budget_labo/<année>/Devis (dossier créé
     si besoin) avec le nom de la convention du laboratoire, puis enregistrement
     du lien + nom + MIME dans le brouillon. Best-effort : sans Drive connecté,
     l’utilisateur colle le lien du fichier dans le champ prévu (obligatoire). */
  const pickFile = async (file) => {
    if (!file) return;
    setUploadMsg('');
    if (!cloudBackendAvailable()) {
      setUploadMsg('⚠️ Google Drive n’est pas connecté — collez le lien du fichier devis ci-dessous (nécessaire pour un transfert « pour signature »).');
      return;
    }
    setUploadBusy(true);
    try {
      const year = new Date().getFullYear();
      const driveName = budgetDocFileName({
        prefix: 'Devis',
        code: txt(draft.numDevis),
        ligne: txt(draft.ligneBudgetaire),
        fournisseur: txt(draft.fournisseur),
        demandeur: txt(draft.demandeur) || meName,
        date: todayIso(),
        fileName: file.name,
      }) || String(file.name || 'document').trim().slice(0, 180);
      const drive = await uploadLocalFile({
        name: driveName,
        mimeType: file.type || 'application/octet-stream',
        file,
        path: budgetDocPath(year, 'Devis'),
      });
      if (drive && drive.driveUrl) {
        const url = txt(drive.driveUrl);
        const storedName = String(drive.name || file.name || driveName).trim().slice(0, 180);
        setDraft((d) => ({
          ...d,
          numDevisUrl: url,
          fichierUrl: url,
          fichierNom: storedName,
          fichierMime: file.type || '',
          numDevis: d.numDevis || extractNumeroFromDoc(storedName),
        }));
        setUploadMsg(`✓ Devis téléversé dans Budget_labo/${year}/Devis (dossier créé si besoin).`);
      } else {
        setUploadMsg('⚠️ Téléversement impossible — collez le lien du fichier devis ci-dessous.');
      }
    } catch (err) {
      console.error(err);
      setUploadMsg(`⚠️ Téléversement impossible : ${(err && err.message) || err}`);
    } finally {
      setUploadBusy(false);
    }
  };

  /* Ligne budgétaire OBLIGATOIRE : le champ passe en rouge tant qu’aucune ligne
     (fiche Recettes ou intitulé repris) n’est choisie, et `submit()` refuse
     l’enregistrement sans elle. */
  const lineMissing = !(draft.recetteSuggereeId || txt(draft.ligneBudgetaire));

  const submit = () => {
    const description = txt(draft.description);
    if (!description) {
      setError('Merci de décrire le souhait d’achat (obligatoire).');
      return;
    }
    /* Champs obligatoires pour un membre (et pour toute NOUVELLE demande) :
       la demande est une REQUÊTE budgétaire — le N° devis et le fichier du
       devis sont désormais FACULTATIFS à la soumission (la demande peut être
       présentée sans eux ; le directeur choisira alors « accepter et transférer
       pour révision », et le devis sera complété avant la signature). Le
       superutilisateur qui édite une ancienne ligne minimale (import Google
       Sheets) reste libre de la compléter à son rythme. */
    const strict = !editing || !canDecide;
    /* La LIGNE BUDGÉTAIRE est obligatoire dans TOUS les cas — nouvelle demande
       comme modification : une demande d’achat est une requête budgétaire, elle
       doit toujours être imputée sur une ligne des Recettes. */
    if (!(draft.recetteSuggereeId || txt(draft.ligneBudgetaire))) {
      setError('Merci de choisir la ligne budgétaire sur laquelle la demande sera imputée (obligatoire) — créez-la d’abord dans la page Recettes si elle manque.');
      return;
    }
    if (strict) {
      const missing = [];
      const need = (ok, label) => { if (!ok) missing.push(label); };
      need(txt(draft.fournisseur), 'le fournisseur');
      need(parseNum(draft.montantEstime) !== null, 'le montant');
      need(parseNum(draft.fraisPort) !== null, 'les frais de port');
      if (missing.length) {
        setError(`Merci de compléter : ${missing.join(', ')}. (Le N° devis et le fichier du devis ne sont pas obligatoires pour soumettre la demande.)`);
        return;
      }
    }
    const fichierUrl = txt(draft.fichierUrl) || txt(draft.numDevisUrl);
    const patch = {
      description,
      demandeur: txt(draft.demandeur),
      categorie: txt(draft.categorie),
      priorite: txt(draft.urgence),
      urgence: txt(draft.urgence),
      recetteSuggereeId: draft.recetteSuggereeId || null,
      ligneBudgetaire: txt(draft.ligneBudgetaire),
      montantEstime: parseNum(draft.montantEstime),
      fraisPort: parseNum(draft.fraisPort),
      fournisseur: txt(draft.fournisseur),
      contact: txt(draft.contact),
      numDevis: txt(draft.numDevis),
      numDevisUrl: fichierUrl,
      fichierNom: txt(draft.fichierNom),
      fichierUrl,
      fichierMime: txt(draft.fichierMime),
      devis2: txt(draft.devis2),
      devis2Url: txt(draft.devis2Url),
      devis2Nom: txt(draft.devis2Nom),
      devis2Mime: txt(draft.devis2Mime),
      devis3: txt(draft.devis3),
      devis3Url: txt(draft.devis3Url),
      devis3Nom: txt(draft.devis3Nom),
      devis3Mime: txt(draft.devis3Mime),
      codeProduit: txt(draft.codeProduit),
      /* La date de la demande se remplit automatiquement si elle est vide
         (nouvelle demande : jour de la soumission). */
      dateDemande: isoOf(draft.dateDemande) || todayIso(),
      commentaires: txt(draft.commentaires),
    };
    /* Attribution stable à la fiche Personnel du demandeur : elle permet à
       chaque membre de ne voir que ses propres souhaits. */
    const demandeurPersonId = lockDemandeurToMe
      ? (mePersonId || scopePersonIdForName(personnel, patch.demandeur))
      : scopePersonIdForName(personnel, patch.demandeur);
    if (demandeurPersonId) patch.demandeurPersonId = demandeurPersonId;
    let approvalNow = false;
    if (canDecide) {
      const decided = desiderataDecisionOf(draft.statut) || 'En attente';
      const previous = desiderataDecisionOf(rec && rec.statut);
      patch.statut = decided;
      if (decided !== previous) {
        patch.statutChangedBy = (currentUser && currentUser.name) || '';
        patch.statutChangedAt = Date.now();
      }
      approvalNow = isDesiderataApproved(decided) && !isDesiderataApproved(previous);
    } else if (!editing) {
      patch.statut = 'En attente'; // nouveau souhait soumis → en attente de décision
    }
    onSave(patch, editing && rec.id);
    /* Une fois le souhait approuvé, un e-mail prévient le superutilisateur et
       le(s) gestionnaire(s). */
    if (approvalNow && typeof onApproved === 'function') onApproved(patch, editing && rec.id);
  };


  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(3px)' }}>
      <div className="bg-slate-50 rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden max-h-[94vh] flex flex-col">
        <div className="px-6 py-4 bg-gradient-to-br from-teal-600 to-cyan-700 text-white flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-black flex items-center gap-2">
              <span className="text-xl" aria-hidden="true">🛒</span>
              {editing ? 'Modifier l’achat prévu / souhaité' : 'Nouvel achat prévu / souhaité'}
            </h2>
            <p className="text-teal-100 text-xs">
              {lockDemandeurToMe
                ? editing
                  ? 'Modification de votre demande — conservez les informations de la demande (description, ligne budgétaire, fournisseur, montant, frais de port). Le N° devis et le fichier du devis peuvent être ajoutés plus tard.'
                  : 'Votre demande : renseignez la description, la ligne budgétaire, le fournisseur, le coût estimé et les frais de port. Le N° devis et le fichier du devis sont facultatifs pour soumettre — elle partira en « En attente » et la décision restera réservée au superutilisateur.'
                : 'Souhait d’achat : description, ligne budgétaire, fournisseur, coût, frais de port et devis (n° + fichier, facultatifs à la soumission) — la décision reste réservée au superutilisateur.'}
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

          <Section icon="📦" title="Article souhaité">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <Field label="Description / article" required>
                  <input
                    className={MODAL_INPUT} value={draft.description} onChange={set('description')}
                    placeholder="ex. Balance de précision 0,1 mg avec certificat d’étalonnage" autoFocus
                  />
                </Field>
              </div>
              <Field label="Urgence">
                <select className={MODAL_INPUT} value={draft.urgence} onChange={set('urgence')}>
                  <option value="">— Aucune —</option>
                  {(urgenceOptions || []).map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </Field>
              <Field label="Catégorie (Fonct. / Invest.)">
                <select className={MODAL_INPUT} value={draft.categorie} onChange={setDesCategorie}>
                  <option value="">— Aucune —</option>
                  {(types || []).map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
            </div>
          </Section>

          <Section icon="👤" title="Demandeur & ligne budgétaire (obligatoire)">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field
                label="Demandeur"
                hint={lockDemandeurToMe
                  ? 'Verrouillé sur vous-même : chacun ne voit que ses propres demandes.'
                  : 'Personne à l’origine de la demande.'}
              >
                <input
                  className={MODAL_INPUT} value={draft.demandeur}
                  onChange={set('demandeur')}
                  readOnly={lockDemandeurToMe}
                  list={lockDemandeurToMe ? undefined : 'desiderata-demandeurs'}
                  placeholder={lockDemandeurToMe ? 'vous-même' : 'ex. Marie Curie'}
                />
                {!lockDemandeurToMe && (
                  <datalist id="desiderata-demandeurs">
                    {(demandeurNames || []).map((n) => <option key={n} value={n} />)}
                  </datalist>
                )}
              </Field>
              <Field
                label="Ligne budgétaire"
                required
                hint={requiredInfo
                  ? 'Obligatoire : la ligne sur laquelle ce devis sera imputé.'
                  : 'Obligatoire : la ligne sur laquelle ce souhait sera imputé.'}
              >
                <select
                  className={`${MODAL_INPUT} ${lineMissing ? 'border-red-300' : ''}`}
                  value={draft.recetteSuggereeId}
                  onChange={setRecette}
                >
                  <option value="">— Choisir une ligne budgétaire (obligatoire) —</option>
                  {recetteOptions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {txt(r.ligne) || txt(r.name) || r.id}
                      {recetteDupCount > 0 && txt(r.type) ? ` — ${r.type}` : ''}
                    </option>
                  ))}
                </select>
                {recetteDupCount > 0 ? (
                  <div className="text-[10px] mt-1 leading-snug text-slate-400">
                    Intitulés présents en double dans Recettes ({recetteDupCount} fiche{recetteDupCount > 1 ? 's' : ''} masquée{recetteDupCount > 1 ? 's' : ''}) : la « Catégorie » choisie ci-dessus précise le type à retenir.
                  </div>
                ) : null}
              </Field>
            </div>
          </Section>

          <Section icon="💶" title="Coût estimé">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Coût estimé (€ HT)" required={requiredInfo} hint={requiredInfo ? 'Montant du devis (HT), obligatoire.' : undefined}>
                <input
                  className={MODAL_INPUT} inputMode="decimal" value={draft.montantEstime} onChange={set('montantEstime')}
                  placeholder="ex. 1 250,00"
                />
              </Field>
              <Field
                label="Frais de port (€)"
                required={requiredInfo}
                hint={requiredInfo
                  ? '0,00 si la livraison est gratuite — toujours renseigné pour le devis.'
                  : 'Livraison si elle est facturée à part.'}
              >
                <input
                  className={MODAL_INPUT} inputMode="decimal" value={draft.fraisPort} onChange={set('fraisPort')}
                  placeholder="ex. 24,90"
                />
              </Field>
            </div>
          </Section>

          <Section icon="🏬" title="Fournisseur">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Nom du fournisseur" required={requiredInfo} hint="Fournisseur du devis (obligatoire pour le transfert).">
                <input
                  className={MODAL_INPUT} value={draft.fournisseur} onChange={set('fournisseur')}
                  list="desiderata-fournisseurs" placeholder="ex. VWR International"
                />
                <datalist id="desiderata-fournisseurs">
                  {(fournisseurNames || []).map((n) => <option key={n} value={n} />)}
                </datalist>
              </Field>
              <Field label="Contact fournisseur">
                <input className={MODAL_INPUT} value={draft.contact} onChange={set('contact')} placeholder="ex. Jean Dupont" />
              </Field>
            </div>
          </Section>


          <Section icon="🧾" title="Devis & code produit">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="N° devis" hint="Facultatif à la soumission — requis pour un transfert « pour signature ».">
                <input className={MODAL_INPUT} value={draft.numDevis} onChange={set('numDevis')} placeholder="ex. 2025-012345" />
              </Field>
              <Field label="Devis 2" hint="2e devis concurrent — fichier (PC) ou lien Google Drive, facultatif">
                <input className={MODAL_INPUT} value={draft.devis2} onChange={set('devis2')} placeholder="N° devis 2 (concurrent)" />
                <div className="mt-1.5 flex items-center gap-1.5">
                  <input
                    ref={devis2FileRef}
                    type="file"
                    className="hidden"
                    accept=".pdf,.doc,.docx,.odt,.xls,.xlsx,.jpg,.jpeg,.png,.txt"
                    onChange={(e) => {
                      const f = e.target.files && e.target.files[0];
                      if (e.target) e.target.value = '';
                      if (f) pickSlotFile(f, '2');
                    }}
                  />
                  <button
                    type="button"
                    disabled={uploadBusy}
                    onClick={() => { if (devis2FileRef.current) devis2FileRef.current.click(); }}
                    className="text-[10px] font-black px-2 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 disabled:opacity-50 whitespace-nowrap"
                  >⬆ Fichier devis 2</button>
                  <input
                    className={`${MODAL_URL_INPUT} flex-1 min-w-0`}
                    value={draft.devis2Url}
                    onChange={setSlotDevisUrl('2')}
                    placeholder="🔗 lien devis 2"
                  />
                </div>
                {txt(draft.devis2Url) ? (
                  <p className="mt-1 text-[10px] text-slate-500 flex items-center gap-1 min-w-0">
                    📎 {txt(draft.devis2Nom) || 'document lié'} :{' '}
                    <a href={addScheme(draft.devis2Url)} target="_blank" rel="noreferrer" className="text-blue-700 underline truncate">{draft.devis2Url}</a>
                  </p>
                ) : null}
              </Field>
              <Field label="Devis 3" hint="3e devis concurrent — fichier (PC) ou lien Google Drive, facultatif">
                <input className={MODAL_INPUT} value={draft.devis3} onChange={set('devis3')} placeholder="N° devis 3 (concurrent)" />
                <div className="mt-1.5 flex items-center gap-1.5">
                  <input
                    ref={devis3FileRef}
                    type="file"
                    className="hidden"
                    accept=".pdf,.doc,.docx,.odt,.xls,.xlsx,.jpg,.jpeg,.png,.txt"
                    onChange={(e) => {
                      const f = e.target.files && e.target.files[0];
                      if (e.target) e.target.value = '';
                      if (f) pickSlotFile(f, '3');
                    }}
                  />
                  <button
                    type="button"
                    disabled={uploadBusy}
                    onClick={() => { if (devis3FileRef.current) devis3FileRef.current.click(); }}
                    className="text-[10px] font-black px-2 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 disabled:opacity-50 whitespace-nowrap"
                  >⬆ Fichier devis 3</button>
                  <input
                    className={`${MODAL_URL_INPUT} flex-1 min-w-0`}
                    value={draft.devis3Url}
                    onChange={setSlotDevisUrl('3')}
                    placeholder="🔗 lien devis 3"
                  />
                </div>
                {txt(draft.devis3Url) ? (
                  <p className="mt-1 text-[10px] text-slate-500 flex items-center gap-1 min-w-0">
                    📎 {txt(draft.devis3Nom) || 'document lié'} :{' '}
                    <a href={addScheme(draft.devis3Url)} target="_blank" rel="noreferrer" className="text-blue-700 underline truncate">{draft.devis3Url}</a>
                  </p>
                ) : null}
              </Field>
              <Field label="Code produit / référence" className="sm:col-span-3">
                <input className={MODAL_INPUT} value={draft.codeProduit} onChange={set('codeProduit')} placeholder="ex. 89501-432" />
              </Field>
            </div>
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <label className={MODAL_LABEL}>
                Fichier du devis — facultatif à la soumission, requis pour un transfert « pour signature » · classé dans Budget_labo/&lt;année&gt;/Devis, renommé « Devis_N°_ligne_fournisseur_demandeur_date »
              </label>
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept=".pdf,.doc,.docx,.odt,.xls,.xlsx,.jpg,.jpeg,.png,.txt"
                  onChange={(e) => {
                    const f = e.target.files && e.target.files[0];
                    if (e.target) e.target.value = '';
                    if (f) pickFile(f);
                  }}
                />
                <button
                  type="button"
                  disabled={uploadBusy}
                  onClick={() => { if (fileInputRef.current) fileInputRef.current.click(); }}
                  className="text-[11px] font-black px-3 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 disabled:opacity-50"
                >
                  {uploadBusy ? '⏳ Téléversement…' : '⬆ Choisir le fichier devis'}
                </button>
                <input
                  className={`${MODAL_URL_INPUT} flex-1 min-w-[200px]`}
                  value={draft.numDevisUrl}
                  onChange={setNumDevisUrl}
                  placeholder="🔗 … ou collez le lien Google Drive du devis"
                />
              </div>
              {txt(draft.numDevisUrl) && (
                <p className="mt-1.5 text-[11px] text-slate-500 flex items-center gap-1.5 flex-wrap">
                  📎 {txt(draft.fichierNom) || 'document lié'} :
                  <a href={addScheme(draft.numDevisUrl)} target="_blank" rel="noreferrer" className="text-blue-700 underline decoration-blue-300 underline-offset-2 truncate max-w-[300px]">{draft.numDevisUrl}</a>
                </p>
              )}
              {uploadMsg && <p className="mt-1.5 text-[11px] leading-snug text-slate-500">{uploadMsg}</p>}
            </div>
          </Section>

          <Section icon="⚖️" title="Décision du superutilisateur">
            {canDecide ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Décision" hint="La décision est enregistrée avec votre nom et l’horodatage.">
                  <select className={MODAL_INPUT} value={draft.statut} onChange={set('statut')}>
                    {(decisionOptions || []).map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </Field>
                <Field label="Date de la demande">
                  <input type="date" className={MODAL_INPUT} value={draft.dateDemande} onChange={set('dateDemande')} />
                </Field>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                <p className="text-xs text-slate-500 leading-relaxed">
                  La décision est prise par le superutilisateur
                  {editing
                    ? ' — elle reste inchangée à l’enregistrement.'
                    : ' — votre demande partira en « En attente ».'}
                </p>
                <Field label="Date de la demande">
                  <input type="date" className={MODAL_INPUT} value={draft.dateDemande} onChange={set('dateDemande')} />
                </Field>
              </div>
            )}
          </Section>

          <Section icon="💬" title="Commentaires">
            <textarea
              className={`${MODAL_INPUT} min-h-[70px]`} value={draft.commentaires} onChange={set('commentaires')}
              placeholder="Contexte, justificatifs, remarques…"
            />
          </Section>
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 bg-white border-t border-slate-200">
          <button type="button" onClick={onCancel} className="px-4 py-2 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-200 bg-slate-100">
            Annuler
          </button>
          <button type="button" onClick={submit} className="bg-teal-600 hover:bg-teal-700 text-white font-bold text-sm px-5 py-2 rounded-xl shadow-sm transition-colors">
            💾 {editing ? 'Enregistrer les modifications' : 'Ajouter l’achat prévu / souhaité'}
          </button>
        </div>
      </div>
    </div>
  );
};


/* ═════════════════════════════════════════════════════════════════════════
   Page « Achats prévus / souhaités »
   ═════════════════════════════════════════════════════════════════════════ */
export const DesiderataPage = () => {
  const {
    data, settings, upsert, removeRecord, currentUser,
    access, navigate, focus, clearFocus, operators,
  } = useAdmin();
  const list = useMemo(() => (Array.isArray(data.desiderate) ? data.desiderate : []), [data.desiderate]);
  const depenses = useMemo(() => (Array.isArray(data.depenses) ? data.depenses : []), [data.depenses]);
  const recettes = useMemo(() => (Array.isArray(data.recettes) ? data.recettes : []), [data.recettes]);
  const personnel = useMemo(() => (Array.isArray(data.personnel) ? data.personnel : []), [data.personnel]);
  const librerie = useMemo(() => (Array.isArray(data.librerie) ? data.librerie : []), [data.librerie]);
  /* Devis / BC déposés (page « Approbation devis & BC ») : un souhait transféré
     y devient un devis « En attente » ; il ne disparaît de cette liste qu'une
     fois son BC signé (date de signature BC de la dépense liée). */
  const devisBc = useMemo(() => (Array.isArray(data.devisBc) ? data.devisBc : []), [data.devisBc]);

  /* Destinataires des notifications d’approbation : le superutilisateur (fiche
     Personnel liée de l’opérateur) et, le cas échéant, la fiche « Gestionnaire ». */
  const superuserEmails = useMemo(
    () => superuserEmailsOf(operators, personnel),
    [operators, personnel]
  );
  const gestionnaireEmails = useMemo(
    () => personnelEmailsMatching(personnel, { fonction: 'Gestionnaire' }),
    [personnel]
  );

  const [modal, setModal] = useState(null); // null | { mode:'new' } | { mode:'edit', rec }
  const [importOpen, setImportOpen] = useState(false);
  const [notice, setNotice] = useState(null);
  /* Souhait « cible » d’une navigation inter-page (page Recettes › survol d’un
     achat prévu) : on surligne le souhait correspondant dans le tableau. */
  const [focusRow, setFocusRow] = useState(null);
  /* Réafficher les souhaits « soldés » (BC signé) masqués par défaut. */
  const [showDone, setShowDone] = useState(false);

  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    if (!focus || focus.pageId !== 'desiderate') return;
    const rid = focus.recordId;
    if (rid && list.some((d) => d.id === rid)) {
      setFocusRow(rid);
      /* La demande ciblée (ex. clic sur un achat prévu de la page Recettes) peut
         être TRANSFÉRÉE — masquée par défaut : on rétablit l’affichage pour
         qu’elle soit bien visible (et supprimable) à l’arrivée. */
      const target = list.find((d) => d.id === rid);
      if (target && target.transfert) setShowDone(true);
    }
    if (typeof clearFocus === 'function') clearFocus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  /* La décision est réservée au superutilisateur. */
  const canDecide = !!access.canChangeWishlistStatus;

  /* Isolation « chacun ne voit que ses propres souhaits » : le superutilisateur
     voit tout (il décide et transfère) ; chaque autre membre ne voit que ses
     propres demandes — et l’évolution de leur état — jamais celles des autres.
     Les lignes sont attribuées par la fiche Personnel du demandeur posée à la
     création (`demandeurPersonId`), sinon par correspondance de nom avec la
     colonne « demandeur » (anciens imports Google Sheets). */
  const isSuper = !!access.isSuperuser;
  const meNames = useMemo(() => scopeMeNames(access, currentUser), [access, currentUser]);
  const mePersonId = useMemo(() => scopeMePersonId(access), [access]);
  const myRows = useMemo(
    () => (isSuper ? list : list.filter((r) => scopeCanSeeItem(r, { isSuper, meNames, mePersonId }))),
    // scopeCanSeeItem dépend de meNames / mePersonId (recalculés à chaque rendu).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [list, isSuper, meNames, mePersonId]
  );

  /* Pages cibles des liens « vers la bibliothèque » (Librerie / Personnel). */
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
  const urgencyOptions = Array.isArray(settings.urgences) && settings.urgences.length
    ? settings.urgences : URGENCES;
  const decisionOptions = useMemo(() => {
    const base = (Array.isArray(settings.desiderateStatuses) && settings.desiderateStatuses.length)
      ? settings.desiderateStatuses : DESIDERATE_STATUSES;
    const set = base.map(desiderataDecisionOf);
    myRows.forEach((r) => set.push(desiderataDecisionOf(r && r.statut)));
    /* Le statut « Test » (compté en prévision dans Recettes, sans acceptation
       réelle) reste toujours proposé, même si la liste personnalisée de Setup
       ne l’a pas encore. */
    set.push(DESIDERATE_TEST);
    return [...new Set(set.filter(Boolean))];
  }, [settings, myRows]);

  /* Suggestions « demandeur » du formulaire : pour un membre, uniquement
     lui-même (« demandeur = moi », verrouillé) ; pour le superutilisateur,
     toute l’équipe (il peut saisir pour le compte d’une autre personne). */
  const demandeurNames = useMemo(() => {
    const set = new Set();
    if (!isSuper) {
      meNames.forEach((n) => { const s = txt(n); if (s) set.add(s); });
      return [...set];
    }
    personnel.forEach((p) => {
      ['nom', 'prenom', 'name'].forEach((k) => { const n = txt(p && p[k]); if (n) set.add(n); });
    });
    list.forEach((r) => { const d = demandeurOf(r); if (d) set.add(d); });
    if (currentUser && txt(currentUser.name)) set.add(txt(currentUser.name));
    return [...set].sort((a, b) => a.localeCompare(b, 'fr'));
  }, [personnel, list, currentUser, isSuper, meNames]);

  const fournisseurNames = useMemo(() => {
    const set = new Set();
    librerie.forEach((l) => {
      const n = pick(l, ['fournisseur', 'nomFournisseur', 'nom', 'name']);
      if (n) set.add(n);
    });
    list.forEach((r) => {
      const n = pick(r, ['fournisseur', 'nomFournisseur']);
      if (n) set.add(n);
    });
    return [...set].sort((a, b) => a.localeCompare(b, 'fr'));
  }, [librerie, list]);

  /* Index de recherche pour les liens (Librerie / Personnel). */
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
  const ligneLabelOf = (r) => {
    const found = r && r.recetteSuggereeId ? (recettesById.get(r.recetteSuggereeId) || null) : null;
    return found ? (found.ligne || '') : txt(r && r.ligneBudgetaire);
  };
  const recetteOf = (r) => (r && r.recetteSuggereeId ? (recettesById.get(r.recetteSuggereeId) || null) : null);
  const fournisseurEntryOf = (r) => {
    if (!r) return null;
    const direct = r.fournisseurId ? librerieById.get(r.fournisseurId) : null;
    if (direct) return direct;
    const k = norm(pick(r, ['fournisseur', 'nomFournisseur']));
    return k ? (fournisseurByKey.get(k) || null) : null;
  };
  const personEntryOf = (r) => {
    const k = norm(demandeurOf(r));
    return k ? (personnelByKey.get(k) || null) : null;
  };

  /* Les plus récentes d’abord (date de demande, sinon création) — sur les
     seules lignes visibles par le membre connecté (les siennes, sauf pour le
     superutilisateur qui voit tout). */
  const sorted = useMemo(() => [...myRows].sort((a, b) => {
    const da = isoOf(a.dateDemande) || '';
    const db = isoOf(b.dateDemande) || '';
    if (!da && !db) return (b.createdAt || 0) - (a.createdAt || 0);
    if (!da) return 1;
    if (!db) return -1;
    return db.localeCompare(da);
  }), [myRows]);


  /* E-mail au superutilisateur quand un membre soumet une NOUVELLE demande
     (« Achats prévus / souhaités ») — il décide puis transfère. */
  const notifySubmitted = async (patch) => {
    const label = txt(patch && patch.description) || 'achat prévu / souhaité';
    const subject = `[Lab Workspace] Nouvel achat prévu / souhaité — ${label}`;
    const lines = [
      'Une nouvelle demande d’achat a été soumise :',
      `  ${label}`,
      `Demandeur : ${txt(patch && patch.demandeur) || '—'}`,
      `Date de la demande : ${txt(patch && patch.dateDemande) || '—'}`,
      (patch && patch.montantEstime !== undefined && patch.montantEstime !== null && patch.montantEstime !== '')
        ? `Coût estimé : ${euro.format(Number(patch.montantEstime))}`
        : '',
      (patch && patch.fraisPort !== undefined && patch.fraisPort !== null && patch.fraisPort !== '')
        ? `Frais de port : ${euro.format(Number(patch.fraisPort))}`
        : '',
      txt(patch && patch.fournisseur) ? `Fournisseur : ${txt(patch.fournisseur)}` : '',
      txt(patch && patch.ligneBudgetaire) ? `Ligne budgétaire suggérée : ${txt(patch.ligneBudgetaire)}` : '',
      txt(patch && patch.codeProduit) ? `Code produit : ${txt(patch.codeProduit)}` : '',
    ].filter(Boolean);
    const res = await sendAdminMail({
      to: superuserEmails,
      subject,
      text: mailBodyText(lines),
    });
    const summary = summarizeMail(res, 'Superutilisateur notifié');
    setNotice({
      tone: res && res.ok ? 'ok' : 'warn',
      text: summary.text,
      mailto: summary.mailto || undefined,
      consoleUrl: summary.consoleUrl || undefined,
    });
  };

  const onSave = (patch, existingId) => {
    const label = txt(patch.description) || 'souhait';
    upsert('desiderate', patch, existingId);
    setModal(null);
    setNotice({
      tone: 'ok',
      text: existingId
        ? `Achat prévu / souhaité « ${label} » enregistré.`
        : `Achat prévu / souhaité « ${label} » ajouté.`,
    });
    /* Nouvelle demande soumise par un membre → prévenir le superutilisateur. */
    if (!existingId && !isSuper && typeof notifySubmitted === 'function') {
      notifySubmitted({ ...patch });
    }
  };

  const onRemove = (rec) => {
    if (!rec) return;
    if (!isSuper && !scopeCanSeeItem(rec, { isSuper, meNames, mePersonId })) return;
    const label = txt(rec.description) || rec.id;
    if (!window.confirm(`Supprimer l’achat prévu / souhaité « ${label} » ?\nCette action est définitive.`)) return;
    removeRecord('desiderate', rec);
    setNotice({ tone: 'ok', text: `Achat prévu / souhaité « ${label} » supprimé.` });
  };

  /* E-mail au superutilisateur (et au(x) gestionnaire(s)) quand un souhait passe « Approuvé ». */
  const notifyApproved = async (patch) => {
    const label = txt(patch && patch.description) || 'achat prévu / souhaité';
    const subject = `[Lab Workspace] Achat prévu / souhaité approuvé — ${label}`;
    const lines = [
      'L’achat prévu / souhaité suivant a été approuvé :',
      `  ${label}`,
      `Demandeur : ${txt(patch && patch.demandeur) || '—'}`,
      (patch && patch.montantEstime !== undefined && patch.montantEstime !== null && patch.montantEstime !== '')
        ? `Coût estimé : ${euro.format(Number(patch.montantEstime))}`
        : '',
      (patch && patch.fraisPort !== undefined && patch.fraisPort !== null && patch.fraisPort !== '')
        ? `Frais de port : ${euro.format(Number(patch.fraisPort))}`
        : '',
      txt(patch && patch.fournisseur) ? `Fournisseur : ${txt(patch.fournisseur)}` : '',
      txt(patch && patch.ligneBudgetaire) ? `Ligne budgétaire suggérée : ${txt(patch.ligneBudgetaire)}` : '',
      txt(patch && patch.codeProduit) ? `Code produit : ${txt(patch.codeProduit)}` : '',
      `Décision prise par : ${(currentUser && currentUser.name) || 'superutilisateur'}`,
    ].filter(Boolean);
    const res = await sendAdminMail({
      to: mergeEmails(superuserEmails, gestionnaireEmails),
      subject,
      text: mailBodyText(lines),
    });
    const summary = summarizeMail(res, 'Superutilisateur & gestionnaire(s)');
    setNotice({
      tone: res && res.ok ? 'ok' : 'warn',
      text: summary.text,
      mailto: summary.mailto || undefined,
      consoleUrl: summary.consoleUrl || undefined,
    });
  };

  /* Changement rapide de décision (colonne 1) — réservé au superutilisateur. */
  const quickDecide = (r, rawValue) => {
    const value = desiderataDecisionOf(rawValue);
    if (!value) return;
    const previous = desiderataDecisionOf(r && r.statut);
    if (value === previous) return;
    upsert('desiderate', {
      statut: value,
      statutChangedBy: (currentUser && currentUser.name) || '',
      statutChangedAt: Date.now(),
    }, r.id);
    /* Passage à « Approuvé » → notification au(x) gestionnaire(s). */
    if (isDesiderataApproved(value) && !isDesiderataApproved(previous)) {
      notifyApproved({ ...r, statut: value }, r.id);
    }
  };

  /* ── Décision du directeur : « accepter et transférer » (signature / révision) ──
     Une seule action regroupe l'ACCEPTATION (statut → « Approuvé ») et le
     transfert vers la responsable d'achats :
       · mode 'signature' — les documents sont complets (N° devis + fichier) :
         un devis « En attente » est créé dans « Approbation devis & BC »,
         affiché « en attente de signature » ;
       · mode 'revision'  — des documents manquent : un devis « En gestion » est
         créé pour être complété (fournisseur, N° devis, fichier…), puis envoyé
         pour signature.
     Dans les deux cas le souhait n'est plus listé (on le retrouve via
     « Afficher les transférées ») et un e-mail prévient la responsable d'achats. */
  const linkedDepenseOf = (rec) =>
    (Array.isArray(depenses) ? depenses : []).find((d) => d && d.desiderataId && d.desiderataId === rec.id) || null;

  const acceptAndTransferWish = async (rec, mode) => {
    if (!rec || !rec.id || !isSuper) return;
    if (rec.transfert || desiderataTransferStatus(rec, devisBc, depenses).devis) {
      setNotice({ tone: 'info', text: `L’achat prévu / souhaité « ${txt(rec.description) || rec.id} » a déjà été transféré (devis créé dans « Approbation devis & BC »).` });
      return;
    }
    if (linkedDepenseOf(rec)) {
      setNotice({ tone: 'info', text: `L’achat prévu / souhaité « ${txt(rec.description) || rec.id} » a déjà été transféré dans Dépenses › Achats.` });
      return;
    }
    const complete = demandeDevisCompleteOf(rec);
    const label = txt(rec.description) || rec.id;
    if (mode === TRANSFER_MODES.SIGNATURE && !complete) {
      setNotice({ tone: 'warn', text: `« ${label} » n’a pas encore de N° devis ni de fichier devis : utilisez « accepter et transférer pour révision » (le devis partira « En gestion »).` });
      return;
    }
    const montant = numOf(rec.montantEstime);
    const port = numOf(rec.fraisPort);
    const confirmText = [
      mode === TRANSFER_MODES.SIGNATURE
        ? `Accepter et transférer l’achat « ${label} » pour signature ?`
        : `Accepter et transférer l’achat « ${label} » pour révision ?`,
      '',
      mode === TRANSFER_MODES.SIGNATURE
        ? 'Les documents sont complets : un devis sera créé « en attente de signature » dans « Approbation devis & BC ».'
        : 'Des documents manquent (N° devis / fichier du devis) : un devis « En gestion » sera créé dans « Approbation devis & BC » pour être complété.',
      montant !== null
        ? `(montant estimé : ${euro.format(montant)}${port !== null ? ` + frais de port ${euro.format(port)}` : ''})`
        : '(montant non chiffré)',
      'La responsable d’achats en sera prévenue par e-mail. Le souhait disparaîtra de cette liste.',
    ].filter(Boolean).join('\n');
    if (!window.confirm(confirmText)) return;
    const wasApproved = isDesiderataApproved(rec && rec.statut);
    const meta = targetMetaOf(TRANSFER_TARGETS.Achats.code);
    const patch = devisPatchFromDesiderata(rec, { cible: meta.code, by: (currentUser && currentUser.name) || '' });
    patch.statut = mode === TRANSFER_MODES.REVISION ? APPROVAL_GESTION : patch.statut;
    if (!patch.transfert) patch.transfert = { cible: meta.code, by: (currentUser && currentUser.name) || '', at: Date.now(), depuis: 'desiderate' };
    patch.transfert.mode = mode;
    if (mode === TRANSFER_MODES.REVISION) {
      const missing = [];
      if (!txt(rec && pick(rec, ['numDevis', 'devisNo']))) missing.push('le N° devis');
      if (!txt(rec && (rec.fichierUrl || rec.numDevisUrl))) missing.push('le fichier du devis (téléversé ou lien)');
      patch.notes = [patch.notes, `⚠️ À compléter avant signature : ${missing.join(' et ')} — demande acceptée le ${new Date().toISOString().slice(0, 10)} par ${(currentUser && currentUser.name) || 'le directeur'}.`].filter(Boolean).join(' · ');
    }
    const saved = upsert('devisBc', patch, null);
    upsert('desiderate', {
      ...(!wasApproved ? { statut: 'Approuvé', statutChangedBy: (currentUser && currentUser.name) || '', statutChangedAt: Date.now() } : {}),
      transfert: {
        cible: meta.code,
        by: (currentUser && currentUser.name) || '',
        at: Date.now(),
        mode,
        devisId: saved && saved.id,
      },
    }, rec.id);
    /* Pas de notification « approuvé » séparée ici : quand la demande n'était
       pas encore décidée, l'e-mail de transfert ci-dessous annonce déjà
       l'acceptation (« accepté … ») à la responsable d'achats. Un avis
       « approuvé » supplémentaire doublerait l'e-mail (deux messages partaient
       au lieu d'un) et prêtait à confusion — surtout en révision, où le devis
       repart « En gestion » et n'est PAS encore approuvé. */
    const signatureWay = mode === TRANSFER_MODES.SIGNATURE;
    const res = await sendAdminMail({
      to: cibleEmailsOf(personnel, meta.code),
      subject: `[Lab Workspace] Achat prévu « ${label} » ${signatureWay ? 'transmis pour signature' : 'accepté — devis à compléter'}`,
      text: mailBodyText([
        signatureWay
          ? `L’achat prévu / souhaité « ${label} » a été accepté et transmis pour signature.`
          : `L’achat prévu / souhaité « ${label} » a été accepté, mais des documents manquent : complétez le devis « En gestion » créé dans « Approbation devis & BC » (fournisseur, N° devis, fichier), puis envoyez-le pour signature.`,
        `Demandeur : ${txt(demandeurOf(rec)) || '—'}`,
        montant !== null
          ? `Coût estimé : ${euro.format(montant)}${port !== null ? ` + frais de port ${euro.format(port)}` : ''}`
          : 'Coût non chiffré',
        txt(rec.fournisseur) ? `Fournisseur : ${txt(rec.fournisseur)}` : '',
        `Décision prise par : ${(currentUser && currentUser.name) || 'directeur'}.`,
      ].filter(Boolean)),
    });
    const mailSummary = summarizeMail(res, `${meta.title} notifiée`);
    setNotice({
      tone: res && res.ok ? 'ok' : 'warn',
      text: `Achat « ${label} » ${signatureWay ? 'accepté et transmis pour signature' : 'accepté — devis « En gestion » créé'}. ${mailSummary.text}`,
      mailto: mailSummary.mailto || undefined,
      consoleUrl: mailSummary.consoleUrl || undefined,
    });
    if (typeof navigate === 'function') navigate('devisBc');
  };


  /* L'ancienne fonction doTransferWish (choix gestionnaire / responsable
     d'achats) a été remplacée par acceptAndTransferWish ci-dessus : le
     directeur choisit désormais « pour signature » ou « pour révision ». */

  /* Suivi des souhaits transférés : un souhait est « soldé » — et disparaît de
     la liste — lorsque son BC est signé (devis transféré : dépense liée portant
     la date de signature BC ; ou souhait déjà transféré directement dans
     Dépenses › Achats dont la dépense a un BC signé). */
  const transferStatus = useMemo(() => {
    const map = new Map();
    myRows.forEach((d) => {
      const devisInfo = desiderataTransferStatus(d, devisBc, depenses);
      const direct = linkedDepenseOf(d);
      map.set(d.id, {
        ...devisInfo,
        direct,
        done: (!!direct && isDepenseBcSigne(direct)) || devisInfo.bcSigned,
      });
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myRows, devisBc, depenses]);

  const visibleSorted = useMemo(() => {
    if (showDone) return sorted;
    return sorted.filter((d) => {
      const st = transferStatus.get(d.id);
      /* Le souhait disparaît de la liste dès qu'il est transféré (signature ou
         révision) ; il ne réapparaît que via « Afficher les transférées ». */
      return !(st && (st.transferred || st.done));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted, showDone, transferStatus]);
  const hiddenDone = sorted.length - visibleSorted.length;

  const DECISION_SELECT_TONE = (value) => {
    /* Seul « Approuvé » est vert. Tout le reste (« En attente », « Test »,
       « Pas maintenant »…) est en AMBRE (jaune) : un état non-accepté ne doit
       jamais être montré en rouge (fausse impression de refus) ni en vert
       (fausse impression d’acceptation). */
    if (value === 'Approuvé') return 'bg-emerald-50 border-emerald-200 text-emerald-700';
    return 'bg-amber-50 border-amber-200 text-amber-700';
  };

  /* ── Colonnes (la DÉCISION du superutilisateur est la première) ───────── */
  const columns = [
    {
      key: 'statut', label: 'Décision', filter: 'facet',
      value: (r) => desiderataDecisionOf(r && r.statut) || 'En attente',
      display: (r) => {
        const value = desiderataDecisionOf(r && r.statut) || 'En attente';
        if (!canDecide) {
          return (
            <span title="Décision réservée au superutilisateur">
              <DecisionBadge raw={r.statut} />
            </span>
          );
        }
        return (
          <select
            value={value}
            onChange={(e) => quickDecide(r, e.target.value)}
            title="Décision du superutilisateur (Approuvé / En attente / Test / Pas maintenant)"
            className={`inline-block max-w-[170px] text-[10px] font-black uppercase rounded-full border pl-2 pr-1 py-0.5 outline-none cursor-pointer ${DECISION_SELECT_TONE(value)}`}
          >
            {decisionOptions.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        );
      },
    },
    {
      key: 'description', label: 'Souhait d’achat', filter: 'text',
      value: (r) => [r.description, r.codeProduit, r.numDevis].filter(Boolean).join(' '),
      display: (r) => (
        <div className="min-w-[220px] max-w-[300px]">
          <div className="font-bold text-slate-800 leading-snug line-clamp-2" title={txt(r.description)}>
            {r.description || r.ligneBudgetaire || r.id}
          </div>
          {r.codeProduit && <div className="text-[10px] font-mono text-slate-400 mt-0.5">Réf. {r.codeProduit}</div>}
        </div>
      ),
    },
    {
      key: 'urgence', label: 'Urgence',
      value: (r) => pick(r, ['priorite', 'urgence']),
      display: (r) => {
        const v = pick(r, ['priorite', 'urgence']);
        return v ? <Badge tone={v.toLowerCase() === 'urgent' ? 'red' : 'amber'}>{v}</Badge> : <span className="text-slate-300">—</span>;
      },
    },
    {
      key: 'demandeur', label: 'Demandeur', filter: 'facet',
      value: (r) => demandeurOf(r),
      display: (r) => {
        const name = demandeurOf(r);
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
      display: (r) => {
        const v = txt(r.categorie);
        return v ? <Badge tone={txt(v).toLowerCase() === 'investissement' ? 'indigo' : 'emerald'}>{v}</Badge> : <span className="text-slate-300">—</span>;
      },
    },

    {
      key: 'fournisseur', label: 'Fournisseur', filter: 'facet',
      value: (r) => pick(r, ['fournisseur', 'nomFournisseur']),
      display: (r) => {
        const name = pick(r, ['fournisseur', 'nomFournisseur']);
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
        return (
          <span
            className="whitespace-nowrap text-xs font-bold text-slate-700"
            title={entry ? 'Fiche dans la Librairie (page réservée à certains profils)' : `${name} — pas de fiche au catalogue de la Librairie`}
          >{name}</span>
        );
      },
    },
    {
      key: 'ligne', label: 'Ligne budgétaire suggérée', filter: 'facet',
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
              title={rec ? v : `${v} — pas de ligne correspondante au catalogue`}
            >{v}</div>
          </div>
        );
      },
    },
    {
      key: 'montantEstime', label: 'Coût estimé', dataType: 'number', align: 'right', nowrap: true,
      value: (r) => numOf(r.montantEstime),
      display: (r) => {
        const n = numOf(r.montantEstime);
        return n === null
          ? <span className="text-slate-300">non chiffré</span>
          : <span className="whitespace-nowrap text-xs font-black text-slate-700 tabular-nums">{euro.format(n)}</span>;
      },
    },
    {
      key: 'fraisPort', label: 'Frais de port', dataType: 'number', align: 'right', nowrap: true,
      value: (r) => numOf(r.fraisPort),
      display: (r) => {
        const n = numOf(r.fraisPort);
        return n === null
          ? <span className="text-slate-300">—</span>
          : <span className="whitespace-nowrap text-xs font-semibold text-slate-500 tabular-nums">{euro.format(n)}</span>;
      },
    },
    {
      key: 'devis', label: 'Devis / code produit', filter: 'text',
      value: (r) => [pick(r, ['numDevis', 'devisNo']), devisUrlOf(r), r.devis2, r.devis3, r.codeProduit].filter(Boolean).join(' '),
      display: (r) => {
        const mainCode = pick(r, ['numDevis', 'devisNo']);
        const mainUrl = devisUrlOf(r);
        const rows = [
          (mainCode || mainUrl) && { label: 'Devis', code: mainCode, url: mainUrl },
          txt(r.devis2) && { label: 'Devis 2', code: txt(r.devis2), url: txt(r.devis2Url) },
          txt(r.devis3) && { label: 'Devis 3', code: txt(r.devis3), url: txt(r.devis3Url) },
        ].filter(Boolean);
        return rows.length
          ? <div className="whitespace-nowrap flex flex-col gap-0.5">
              {rows.map((row) => (
                <div key={row.label} className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold uppercase text-slate-400">{row.label}</span>
                  <DevisLink code={row.code} url={row.url} />
                </div>
              ))}
            </div>
          : <span className="text-slate-300">—</span>;
      },
    },
    {
      key: 'dateDemande', label: 'Date de demande', filter: 'text',
      value: (r) => isoOf(r.dateDemande),
      display: (r) => (isoOf(r.dateDemande) ? <span className="text-xs text-slate-600 whitespace-nowrap">{isoOf(r.dateDemande)}</span> : <span className="text-slate-300">—</span>),
    },
    {
      key: 'commentaires', label: 'Commentaires', hidden: true, filter: 'text',
      value: (r) => pick(r, ['commentaires']),
    },
    {
      key: 'transfert', label: 'Transfert', filter: 'none', filterable: false, sortable: false,
      value: (r) => {
        const st = transferStatus.get(r.id);
        return st && st.transferred ? 'transmis' : '';
      },
      display: (r) => {
        const approved = isDesiderataApproved(r && r.statut);
        const pendingDecision = desiderataDecisionOf(r && r.statut) === 'En attente';
        const inTest = isDesiderataTest(r && r.statut);
        const st = transferStatus.get(r.id);
        const transferred = !!(r.transfert || (st && st.devis));
        const metaT = r.transfert ? targetMetaOf(r.transfert.cible) : null;
        const devisRec = st && st.devis;
        const gestion = devisRec && isDevisGestion(devisRec);
        const complete = demandeDevisCompleteOf(r);
        const badge = (cls, label) => (
          <span className={`inline-block text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full whitespace-nowrap ${cls}`}>{label}</span>
        );
        const transferButton = (mode, tone, label, hint, disabled = false) => (
          <button
            type="button"
            disabled={disabled}
            onClick={() => acceptAndTransferWish(r, mode)}
            title={hint}
            className={`text-left text-[11px] font-black px-2 py-1 rounded-lg border whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${tone}`}
          >
            {label}
          </button>
        );
        return (
          <div className="min-w-[200px] flex flex-col gap-1">
            {transferred && st ? (
              <div className="flex items-center flex-wrap gap-1.5">
                {metaT ? <span className="text-[10px] font-semibold text-slate-500 whitespace-nowrap" title={`Transféré par ${txt(r.transfert.by) || '—'} le ${r.transfert.at ? new Date(r.transfert.at).toLocaleDateString('fr-FR') : '—'}`}>{metaT.icon} {metaT.title}</span> : null}
                {gestion
                  ? badge('bg-orange-50 border border-orange-200 text-orange-700', 'En gestion')
                  : st.state === 'devis-attente'
                    ? badge('bg-amber-50 border border-amber-200 text-amber-700', 'En attente de signature')
                    : st.bcSigned
                      ? badge('bg-emerald-50 border border-emerald-200 text-emerald-700', '✓ BC signé')
                      : badge('bg-blue-50 border border-blue-200 text-blue-700', 'Devis signé · BC à signer')}
              </div>
            ) : null}
            {!transferred && inTest ? (
              <div className="flex items-center gap-1.5">
                <span
                  className="inline-block text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 whitespace-nowrap"
                  title="« Test » : montant compté dans les prévisions « Achats prévus » de la page Recettes, mais la demande n’est PAS acceptée — aucun transfert tant que la décision ne passe pas à « Approuvé »."
                >🧪 en test</span>
              </div>
            ) : null}
            {!transferred && isSuper && !linkedDepenseOf(r) && (pendingDecision || approved) ? (
              <div className="flex flex-col gap-1">
                <span className="text-[9px] uppercase font-black text-slate-400">
                  {approved ? 'Transférer' : 'Accepter & transférer'}
                </span>
                <div className="flex flex-col gap-1">
                  {transferButton(
                    TRANSFER_MODES.SIGNATURE,
                    'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
                    approved ? '📨 Pour signature' : '✓ Signature',
                    'Documents complets (N° devis + fichier) : créer le devis « En attente de signature » dans « Approbation devis & BC »',
                    !complete,
                  )}
                  {transferButton(
                    TRANSFER_MODES.REVISION,
                    'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100',
                    approved ? '🔧 Pour révision' : '✎ Révision',
                    'Documents manquants : créer le devis « En gestion » pour complément par la responsable d’achats',
                  )}
                </div>
              </div>
            ) : null}
            {!transferred && !approved && !pendingDecision && !inTest ? <span className="text-[10px] text-slate-300">demande refusée</span> : null}
          </div>
        );
      },
    },
    {
      key: 'actions', label: '', sortable: false, filter: 'none', filterable: false,
      align: 'right', nowrap: true,
      value: () => '',
      display: (r) => {
        const approved = isDesiderataApproved(r && r.statut);
        const linked = linkedDepenseOf(r);
        const st = transferStatus.get(r.id);
        const transferred = !!(r.transfert || (st && st.devis));
        return (
          <div className="flex items-center gap-1 justify-end">
            {transferred ? (
              <button
                type="button"
                title="Transféré en devis (Approbation devis & BC) — ouvrir la page pour compléter puis faire signer"
                onClick={() => { if (typeof navigate === 'function') navigate('devisBc'); }}
                className="text-[11px] font-black px-2 py-1 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
              >→ Devis & BC</button>
            ) : linked ? (
              <button
                type="button"
                title="Déjà transféré dans Dépenses › Achats — ouvrir la ligne"
                onClick={() => {
                  if (typeof navigate === 'function') navigate('depenses', { kind: 'depense', recordId: linked.id });
                }}
                className="text-[11px] font-black px-2 py-1 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
              >✓ Dans Dépenses</button>
            ) : !approved ? null : null}
            <button
              type="button"
              onClick={() => setModal({ mode: 'edit', rec: r })}
              title="Modifier l’achat prévu / souhaité"
              className="text-[11px] font-black px-2 py-1 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
            >✏️ Modifier</button>
          <button
            type="button"
            onClick={() => onRemove(r)}
            title="Supprimer l’achat prévu / souhaité"
            className="text-[11px] font-black px-2 py-1 rounded-lg border border-red-200 bg-red-50 text-red-500 hover:bg-red-100 transition-colors"
          >🗑️</button>
        </div>
      );
      },
    },
  ];


  return (
    <div className="max-w-full mx-auto flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs font-bold text-slate-400 max-w-2xl">
          {visibleSorted.length} achat{visibleSorted.length > 1 ? 's' : ''} prévu{visibleSorted.length > 1 ? 's' : ''} / souhaité{visibleSorted.length > 1 ? 's' : ''} à suivre
          ({sorted.length} au total{!isSuper ? ' — vos demandes uniquement' : ''}{hiddenDone > 0 ? ` — ${hiddenDone} transférée${hiddenDone > 1 ? 's' : ''} masquée${hiddenDone > 1 ? 's' : ''}` : ''}) ·
          les colonnes sont triables (en-têtes) et filtrables (bouton « Filtres »).
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <label
            className="flex items-center gap-1.5 text-[10px] font-black text-slate-500 cursor-pointer select-none bg-white border border-slate-200 rounded-xl px-3 py-2 hover:border-slate-300 whitespace-nowrap"
            title="Une demande acceptée (transférée pour signature ou pour révision) disparaît de la liste ; cochez pour la réafficher."
          >
            <input type="checkbox" className="accent-teal-600" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
            Afficher les transférées
          </label>
          {isSuper && (
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              title="Importer des souhaits depuis la feuille Google Sheets (feuille « Decision / Code produit ») — action du superutilisateur"
              className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-bold text-sm px-4 py-2 rounded-xl shadow-sm transition-colors flex items-center gap-1.5"
            >
              <span className="text-base leading-none">📥</span> Importer
            </button>
          )}
          <button
            type="button"
            onClick={() => setModal({ mode: 'new' })}
            title="Saisir un nouvel achat prévu / souhaité à la main (coût estimé + frais de port)"
            className="bg-teal-600 hover:bg-teal-700 text-white font-bold text-sm px-4 py-2 rounded-xl shadow-sm transition-colors flex items-center gap-1.5"
          >
            <span className="text-base leading-none">＋</span> Ajouter un achat prévu / souhaité
          </button>
        </div>
      </div>

      {notice && (
        <div className={`rounded-xl border px-4 py-2.5 text-xs font-semibold flex items-center justify-between gap-3 ${notice.tone === 'warn'
          ? 'border-amber-200 bg-amber-50 text-amber-700'
          : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}
        >
          <span className="min-w-0">{notice.text}</span>
          <span className="flex items-center gap-3 shrink-0">
            {notice.mailto && (
              <a href={notice.mailto} className="font-black text-blue-700 underline whitespace-nowrap" title="Ouvrir votre messagerie pour envoyer l’e-mail">✉ Ouvrir ma messagerie</a>
            )}
            {notice.consoleUrl && (
              <a
                href={notice.consoleUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-black text-blue-700 underline whitespace-nowrap"
                title="Console Google Cloud — à faire une seule fois par le propriétaire du projet"
              >
                ⚙ Activer l’API Gmail
              </a>
            )}
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="shrink-0 font-black opacity-60 hover:opacity-100" title="Masquer"
            >✕</button>
          </span>
        </div>
      )}

      <div className="rounded-xl border border-teal-100 bg-teal-50/60 px-4 py-2.5 text-[11px] text-slate-600 leading-relaxed">
        <b>Achats prévus / souhaités :</b> chaque membre déclare ses achats souhaités et ne voit QUE ses propres demandes
        (description, ligne budgétaire, fournisseur, coût estimé, frais de port — le N° devis et le fichier du devis sont facultatifs
        à la soumission) — le superutilisateur, qui décide et transfère, voit tout. La <b>première colonne « Décision »</b> affiche la
        décision du superutilisateur : <b>Approuvé / En attente / Test / Pas maintenant</b> (personnalisable dans Setup › Options des listes
        déroulantes). La décision <b>« Test »</b> compte la demande dans les prévisions <b>« Achats prévus »</b> de la page Recettes sans
        l’accepter réellement (aucune notification, aucun transfert). Pour toute demande en attente, la colonne <b>« Transfert »</b> propose au directeur : <b>« ✓ Signature »</b>
        (documents complets — un devis « en attente de signature » est créé dans « Approbation devis & BC ») ou <b>« ✎ Révision »</b>
        (documents manquants — un devis « En gestion » est créé pour être complété par la responsable d'achats, puis envoyé pour
        signature). La demande transférée <b>disparaît de cette liste</b> (rétablie via « Afficher les transférées ») et son montant est
        suivi dans les colonnes <b>« Devis en signature / signé »</b> de la page Recettes jusqu'à la signature du BC. Le <b>fournisseur</b>,
        la <b>ligne budgétaire</b> et le <b>demandeur</b> sont des liens vers la Librerie et les fiches Personnel.
      </div>

      {visibleSorted.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-10 text-center">
          <div className="text-4xl mb-2">🛒</div>
          <p className="font-black text-slate-700">
            {isSuper ? 'Aucun achat prévu / souhaité pour le moment' : 'Aucun achat prévu / souhaité à votre nom'}
          </p>
          <p className="text-sm text-slate-400 mt-1 mb-4">
            {isSuper ? (
              hiddenDone > 0 ? (
                <>Toutes les demandes affichables ont été transférées (pour signature ou pour révision). Cochez « Afficher les transférées »
                  pour les retrouver dans la liste.</>
              ) : (
                <>Utilisez « ＋ Ajouter un achat prévu / souhaité » pour déclarer une demande de l’équipe. Chaque demande en attente peut
                  être acceptée puis transférée dans « Approbation devis & BC » : <b>pour signature</b> (documents complets) ou
                  <b>pour révision</b> (documents à compléter — devis « En gestion »). Ou « 📥 Importer » pour rejouer l’onglet
                  « Souhaités » de la feuille Google Sheets.</>
              )
            ) : (
              <>Chaque membre ne voit que ses propres demandes — ajoutez votre première demande d’achat (description, ligne budgétaire,
                fournisseur, coût estimé, frais de port) : le N° devis et le fichier du devis ne sont pas obligatoires pour soumettre.</>
            )}
          </p>
          <button
            type="button"
            onClick={() => setModal({ mode: 'new' })}
            className="bg-teal-600 hover:bg-teal-700 text-white font-bold text-sm px-5 py-2.5 rounded-xl shadow-sm transition-colors"
          >
            <span className="text-base leading-none">＋</span> Ajouter un achat prévu / souhaité
          </button>
        </div>
      ) : (
        <SmartTable
          columns={columns}
          rows={visibleSorted}
          focusRowKey={focusRow}
          onFocusDone={() => setFocusRow(null)}
          minWidth="1820px"
          searchPlaceholder="Rechercher article, demandeur, fournisseur, ligne, code produit…"
          emptyLabel="Aucun achat prévu / souhaité pour le moment"
          noMatchLabel="Aucun achat prévu / souhaité ne correspond aux filtres."
        />
      )}

      {importOpen && <AdminImportModal kind="desiderate" onClose={() => setImportOpen(false)} />}

      {modal && (
        <DesiderataModal
          rec={modal.mode === 'edit' ? modal.rec : null}
          recettes={recettes}
          demandeurNames={demandeurNames}
          fournisseurNames={fournisseurNames}
          types={types}
          urgenceOptions={urgencyOptions}
          decisionOptions={decisionOptions}
          canDecide={canDecide}
          currentUser={currentUser}
          meNames={meNames}
          mePersonId={mePersonId}
          personnel={personnel}
          lockDemandeurToMe={!isSuper}
          onApproved={notifyApproved}
          onCancel={() => setModal(null)}
          onSave={onSave}
        />
      )}
    </div>
  );
};
