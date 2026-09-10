/* =========================================================================
   src/administration/approbationPage.jsx
   Page « Approbation devis & BC » — dépôt des devis et bons de commande à
   faire signer par le superutilisateur.

   Fonctionnement :
     · les Permanents déposent un devis (et/ou un BC lié à un devis) avec le
       FICHIER correspondant. Le fichier est téléversé sur Google Drive dans
       le dossier du dataset › Budget_labo/<année>/Devis (ou /BC) — dossiers
       créés automatiquement — et un e-mail est envoyé au superutilisateur ;
     · chaque ligne arrive « En attente » dans sa table (Devis / BC) — la
       première colonne affiche la décision ;
      · plusieurs devis CANDIDATS peuvent être déposés pour un même produit :
        les lignes partagent un groupe commun (choisi au dépôt, ou détecté
        automatiquement quand l'objet saisi correspond exactement à un produit
        déjà déposé). UN SEUL devis par produit peut être approuvé : les autres
        candidats encore « En attente » passent alors automatiquement
        « Non retenu » (statut distinct de « Refusé », e-mail au déposant) ;

     · l'approbation est réservée au superutilisateur (✓ / ✗) :
         – approuver un DEVIS valide le document et le marque « Approuvé » :
           la dépense n'est PAS créée à cette étape, elle n'existera qu'à la
           signature du BC lié (page Dépenses) ;
         – approuver un BC rattaché à un devis approuvé CRÉE alors la dépense
           directement « BC signé » (ou met à jour la dépense « Devis en cours »
           d'un ancien devis approuvé avant ce changement) avec le n° BC, le lien
           numBCUrl, la date de signature du BC (dateSignature = jour de
           l'approbation), la catégorie (Fonctionnement / Investissement), la
           ligne budgétaire imputée et le N° SIFAC/D.A. saisis au dépôt du BC ;
           un N° SIFAC/D.A. encore manquant ne bloque pas l'approbation : la
           dépense « BC signé » est créée quand même et comptée sur la page
           Recettes dès que sa date de signature est renseignée ;
         – une décision envoie un e-mail au(x) gestionnaire(s) (et au
           déposant quand son e-mail figure dans sa fiche Personnel) ;
     · seul le superutilisateur peut supprimer une ligne ; un déposant peut
       modifier sa propre ligne tant qu'elle est « En attente ».

   Modèle stocké (collection `devisBc`) :
     devis : { kind:'devis', description, fournisseur, ligneBudgetaire,
               demandeur, numDevis, montant?, fichierNom, fichierUrl,


               fichierMime, notes, deposant, statut, depenseId?,
               decidedBy?, decidedAt? }
     bc    : { kind:'bc',    description, fournisseur, ligneBudgetaire,
               demandeur, numBC, montant?, fichierNom, fichierUrl,
               fichierMime, notes, deposant, statut, devisId?, depenseId?,
               decidedBy?, decidedAt? }
     + enveloppe d'audit posée par upsert() (createdAt/By, updatedAt/By).
      Statuts de décision : « En attente » / « Approuvé » / « Refusé » /
      « Non retenu » (devis candidat écarté automatiquement lors de
      l'approbation d'un autre devis du même produit). Le champ
      `groupeAchatId` (devis) désigne le produit/achat commun aux devis
      candidats d'un même achat — aucune collection séparée : le libellé du
      produit est repris du devis le plus récent du groupe.
   ========================================================================= */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAdmin } from './AdminContext';
import { SmartTable } from './smartTable';
import { toFrDate } from './congesDates';
import {
  APPROVAL_PENDING, APPROVAL_APPROVED, APPROVAL_REJECTED, APPROVAL_NOT_RETAINED,
  APPROVAL_GESTION, DEVIS_SIGNATURE_PENDING,
  SERVICE_DEMANDEUR,
  isApprovalPending, approvalStatusOf,
} from './adminSchema';
import { findRecetteByLabel } from './recetteLink';
import { devisCompleteOf } from './transferAchats';
import { uploadLocalFile, cloudBackendAvailable, renameDriveFile, driveFetch } from '../utils/driveUpload';
import {
  fileBudgetDocs,
  driveFileIdFromUrl,
  budgetDocFileName,
  hasApprovedSuffix,
  withApprovedSuffix,
} from './driveFiling';
import { stampPdfWithSignature, makeSignedPdfFromImage } from './approvalSignature';
import { downloadDriveFileBytes } from '../utils/migrateTestImages';
import {
  sendAdminMail, personEmailOf, personnelEmailsMatching, superuserEmailsOf, mergeEmails,
} from './emailNotify';

/* ── Petites aides ──────────────────────────────────────────────────────── */
const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const txt = (v) => (v === null || v === undefined ? '' : String(v).trim());
const numOf = (v) => {
  const n = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n !== 0 ? n : (v === null || v === undefined || v === '' ? null : n);
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
/** Id d'un « produit » : groupe rassemblant les devis candidats d'un même
 *  achat (déposés séparément, un seul sera retenu à l'approbation). */
const newGroupeAchatId = () =>
  `produit_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;

/* ── Convention de nommage des fichiers devis / BC déposés ──────────────────
   À chaque dépôt, le fichier est stocké dans Budget_labo/<année>/Devis|BC avec
   le nom conventionnel du laboratoire (voir ./driveFiling.js) :
     Devis_<N° devis>_<ligne budgétaire>_<fournisseur>_<demandeur>_<date>_<description>
     BC_<N° BC>_<ligne budgétaire>_<fournisseur>_<demandeur>_<date>_<description>
   Quand le devis / BC est approuvé, la marque « _approuvé » est ajoutée à la
   fin du nom (juste avant l’extension). La convention n’est appliquée que si
   le N° du document est connu ; sinon on garde le nom d’origine du fichier. */
const depositDocDriveNameOf = (r) => {
  const isBc = !!r && r.kind === 'bc';
  const code = txt(r && (isBc ? r.numBC : r.numDevis));
  if (!code) return '';
  return budgetDocFileName({
    prefix: isBc ? 'BC' : 'Devis',
    code,
    ligne: txt(r && r.ligneBudgetaire),
    fournisseur: txt(r && r.fournisseur),
    demandeur: txt(r && r.demandeur),
    date: txt(r && (r.date || r.dateDepot)),
    /* L’objet saisi (description) termine le nom après un « _ » : on reconnaît
       le contenu du document sans avoir à l’ouvrir. */
    description: txt(r && r.description),
    fileName: txt(r && r.fichierNom),
  });
};

/** Nom final attendu pour le fichier d’un devis / BC : convention du
 *  laboratoire, plus la marque « _approuvé » quand la ligne est approuvée. */
const depositDocDriveFinalName = (r) => {
  const base = depositDocDriveNameOf(r);
  if (!base) return txt(r && r.fichierNom);
  return r && r.statut === APPROVAL_APPROVED && !hasApprovedSuffix(base)
    ? withApprovedSuffix(base)
    : base;
};

/* ── Copie signée créée à l'approbation d'un devis / BC ─────────────────── */
/** Type effectif du fichier déposé : 'pdf' | 'image' | 'other'. L'extension
 *  d'origine ou le type MIME (renseigné au téléversement) sont utilisés. */
const depositFileKindOf = (rec) => {
  const name = txt(rec && (rec.fichierNom || rec.fichierUrl));
  const mime = String(rec && rec.fichierMime || '').toLowerCase();
  if (mime === 'application/pdf' || /\.pdf(?:[?#].*)?$/i.test(name)) return 'pdf';
  if (mime.startsWith('image/') || /\.(jpe?g|png)(?:[?#].*)?$/i.test(name)) return 'image';
  return 'other';
};

/** Type RÉEL d'un document d'après ses premiers octets : 'pdf' | 'image/png' |
 *  'image/jpeg' | '' (inconnu). Le contenu fait foi : un fichier mal étiqueté
 *  (ex. un vrai PDF nommé « …png » par le Drive) est reconnu correctement, ce
 *  qui garantit qu'une copie signée est toujours un PDF et jamais une image. */
const sniffBudgetDocBytes = (bytes) => {
  const a = bytes && bytes.length > 0 ? bytes[0] : -1;
  const b = bytes && bytes.length > 1 ? bytes[1] : -1;
  const c = bytes && bytes.length > 2 ? bytes[2] : -1;
  const d = bytes && bytes.length > 3 ? bytes[3] : -1;
  if (a === 0x25 && b === 0x50 && c === 0x44 && d === 0x46) return 'pdf';        // %PDF
  if (a === 0x89 && b === 0x50 && c === 0x4e && d === 0x47) return 'image/png';  // \x89PNG
  if (a === 0xff && b === 0xd8 && c === 0xff) return 'image/jpeg';               // JPEG
  return '';
};

/** Nom du fichier SIGNÉ téléversé à l'approbation : convention du laboratoire
 *  (avec la marque « _approuvé » portée par depositDocDriveFinalName) + la
 *  marque « _signé », toujours en extension PDF :
 *    Devis_<N°>_<ligne>_<fournisseur>_<demandeur>_<date>_approuvé_signé.pdf */
const signedDocDriveName = (r) => {
  const base = depositDocDriveFinalName(r) || txt(r && r.fichierNom) || 'document';
  return `${String(base).replace(/\.[^./\\]+$/, '')}_signé.pdf`;
};

/** Date ISO (AAAA-MM-JJ) → « JJ/MM/AAAA » (mention portée sur la signature). */
const frShortDateOf = (iso) => {
  const [y, m, d] = (isoOf(iso) || todayIso()).split('-');
  return y && m && d ? `${d}/${m}/${y}` : todayIso();
};

/** Octets binaires → data:URL (utile quand le devis déposé est une image). */
const bytesToDataUrl = (bytes, mime) => {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  let bin = '';
  for (let i = 0; i < arr.length; i += 1) bin += String.fromCharCode(arr[i]);
  return `data:${mime || 'application/octet-stream'};base64,${btoa(bin)}`;
};

/** Image (data:URL) réduite pour le stockage dans les réglages : la dimension
 *  la plus grande est plafonnée (la transparence PNG est conservée). */
const MAX_SIGNATURE_DIM = 1500;
const downscaleImageDataUrl = async (dataUrl) => {
  const img = new Image();
  img.src = dataUrl;
  await new Promise((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Image illisible.'));
  });
  const w = img.naturalWidth || img.width || 0;
  const h = img.naturalHeight || img.height || 0;
  const scale = Math.min(1, MAX_SIGNATURE_DIM / Math.max(1, w, h));
  if (scale >= 1 && String(dataUrl).startsWith('data:image/png')) {
    return { dataUrl, width: w, height: h };
  }
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, cw, ch);
  return { dataUrl: canvas.toDataURL('image/png'), width: cw, height: ch };
};

/** Renomme (best-effort) sur Google Drive le fichier d’un devis / BC : nom
 *  conventionnel au dépôt, « _approuvé » ajouté après approbation. Renvoie le
 *  nouveau nom, ou '' quand rien n’a pu être renommé (fichier non accessible à
 *  l’app — limite « drive.file » — ou absence de fichier / de N°). */
const renameDepositDriveFileTo = async (r) => {
  if (!r || !cloudBackendAvailable()) return '';
  const fileId = driveFileIdFromUrl(txt(r.fichierUrl));
  const target = depositDocDriveFinalName(r);
  if (!fileId || !target) return '';
  try {
    const ok = await renameDriveFile(fileId, target);
    return ok ? target : '';
  } catch (err) {
    console.warn('Renommage Drive du fichier devis/BC ignoré (fichier inaccessible à l’app ?)', err && err.message);
    return '';
  }
};
const norm = (s) => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const sameName = (a, b) => {
  const ka = norm(a);
  const kb = norm(b);
  if (!ka || !kb) return false;
  const toks = (x) => x.split(/\s+/).sort().join(' ');
  return toks(ka) === toks(kb);
};

/** Libellé court d'un statut d'approbation (menus « Devis lié », filtres…). */
const approvalStatusShort = (r) => {
  const raw = r && r.statut;
  if (raw === APPROVAL_APPROVED) return 'approuvé ✓';
  if (raw === APPROVAL_NOT_RETAINED) return 'non retenu';
  if (isApprovalPending(raw)) return 'en attente';
  return approvalStatusOf(raw) === APPROVAL_REJECTED ? 'refusé ✗' : approvalStatusOf(raw);
};
/** Devis proposés pour lier un BC : les approuvés d'abord (le BC se rattache
 *  au devis retenu du produit), puis les devis encore en attente. */
const rankedBcDevisOptions = (opts) => {
  const list = (Array.isArray(opts) ? opts : []).filter((d) => d && d.id);
  const rank = (d) => {
    if (d.statut === APPROVAL_APPROVED) return 0;
    if (isApprovalPending(d.statut)) return 1;
    return 2;
  };
  return [...list].sort((a, b) => rank(a) - rank(b) || (b.createdAt || 0) - (a.createdAt || 0));
};
/** Premier devis proposé pour un nouveau BC : le plus récent des approuvés,
 *  sinon le plus récent des devis encore en attente. */
const defaultLinkedDevisId = (opts) => {
  const ranked = rankedBcDevisOptions(opts);
  return ranked.length ? ranked[0].id : '';
};
/** Dossier Drive du fichier déposé : Budget_labo/<année>/Devis|BC. */
const budgetLaboPath = (kind) =>
  ['Budget_labo', String(new Date().getFullYear()), kind === 'bc' ? 'BC' : 'Devis'];

const TONES = {
  slate: 'bg-slate-100 border-slate-200 text-slate-600',
  amber: 'bg-amber-50 border-amber-200 text-amber-700',
  emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  red: 'bg-red-50 border-red-200 text-red-600',
};
const Badge = ({ tone = 'slate', children }) => (
  <span className={`inline-block text-[10px] font-black uppercase px-2 py-0.5 rounded-full border ${TONES[tone] || TONES.slate}`}>
    {children}
  </span>
);

/* ═════════════════════════════════════════════════════════════════════════
   Page « Approbation devis & BC »
   ═════════════════════════════════════════════════════════════════════════ */
export const ApprobationPage = () => {
  const {
    data, access, upsert, remove, currentUser, operators, settings, updateSettings,
    focus, clearFocus, updateMany,
  } = useAdmin();
  const personnel = useMemo(
    () => (Array.isArray(data.personnel) ? data.personnel : []),
    [data.personnel]
  );
  const rows = useMemo(
    () => (Array.isArray(data.devisBc) ? data.devisBc : []),
    [data.devisBc]
  );
  const depensesById = useMemo(
    () => new Map((Array.isArray(data.depenses) ? data.depenses : []).map((d) => [d.id, d])),
    [data.depenses]
  );
  const librerie = useMemo(
    () => (Array.isArray(data.librerie) ? data.librerie : []),
    [data.librerie]
  );
  /* Noms des fournisseurs du catalogue (page Librairie) : ils alimentent le
     menu déroulant « Fournisseur » du dépôt d’un devis / BC. */
  const fournisseurNames = useMemo(() => {
    const set = new Set();
    librerie.forEach((l) => {
      [l && l.fournisseur, l && l.nomFournisseur, l && l.fournisseurNom, l && l.nom, l && l.name]
        .map((v) => txt(v)).filter(Boolean).forEach((n) => set.add(n));
    });
    return [...set].sort((a, b) => a.localeCompare(b, 'fr'));
  }, [librerie]);

  /* Lignes budgétaires connues (page Recettes) : elles alimentent (en
     suggestions seulement) la saisie « Ligne budgétaire » du dépôt. */
  const budgetLineOptions = useMemo(() => {
    const set = new Set();
    (Array.isArray(data.recettes) ? data.recettes : []).forEach((r) => {
      [r && r.ligne, r && r.ligneBudgetaire].forEach((v) => {
        const s = txt(v);
        if (s) set.add(s);
      });
    });
    return [...set].sort((a, b) => a.localeCompare(b, 'fr'));
  }, [data.recettes]);

  /* Catégories proposées au dépôt : les types présents dans Recettes (lignes
     Fonctionnement / Investissement / Salaires) + les valeurs par défaut. */
  const recettesList = useMemo(
    () => (Array.isArray(data.recettes) ? data.recettes : []),
    [data.recettes]
  );
  const categorieOptions = useMemo(() => {
    const set = new Set(['Fonctionnement', 'Investissement', 'Salaire']);
    recettesList.forEach((r) => {
      const t = txt(r && r.type);
      if (t) set.add(t);
    });
    return [...set];
  }, [recettesList]);

  const isSuper = !!access.isSuperuser;
  const currentName = txt(access.profile && access.profile.person
    ? access.profile.person.nom
    : (currentUser && currentUser.name));
  /* Suggestions « Demandeur » du dépôt : membres du Personnel + noms déjà
     saisis + le demandeur collectif « Service » (visible par tout le monde). */
  const demandeurNames = useMemo(() => {
    const set = new Set();
    personnel.forEach((p) => {
      const n = txt(p && (p.nom || p.name));
      if (n) set.add(n);
    });
    (Array.isArray(rows) ? rows : []).forEach((r) => {
      [r && r.demandeur, r && r.deposant].forEach((v) => {
        const s = txt(v);
        if (s) set.add(s);
      });
    });
    if (currentName) set.add(currentName);
    set.add(SERVICE_DEMANDEUR);
    return [...set].sort((a, b) => a.localeCompare(b, 'fr'));
  }, [personnel, rows, currentName]);
  /* Fonctions chargées du suivi des achats (Gestionnaire / Responsable
     d'achats) : autorisées à compléter les devis générés par un transfert
     depuis « OM prévus / souhaités » ou « Achats prévus / souhaités ». Une
     fiche peut porter plusieurs fonctions. */
  const currentFonctions = (access.profile && access.profile.fonctions) || [];
  const isAchatsRole = currentFonctions.indexOf('Gestionnaire') !== -1
    || currentFonctions.indexOf('Achats') !== -1;
  /* Visibilité : le superutilisateur, la gestionnaire et la responsable
     d’achats voient TOUTES les lignes. Les autres membres ne voient que
     leurs propres éléments (déposés par eux, demandés à leur nom ou créés
     par leur compte) — jamais ceux des autres utilisateurs — plus les lignes
     demandées par « Service » (demandeur collectif), visibles par tous. */
  const canSeeAllRows = isSuper || isAchatsRole;
  const visibleRows = useMemo(() => {
    if (canSeeAllRows || !currentName) return rows;
    const mine = (r) => !!(r && (
      sameName(txt(r.deposant), currentName)
      || sameName(txt(r.demandeur), currentName)
      /* Les demandes portées par le demandeur collectif « Service » sont
         visibles par tout le monde (le Service travaille pour le labo). */
      || sameName(txt(r.demandeur), SERVICE_DEMANDEUR)
      || (r.createdBy && sameName(txt(r.createdBy.name), currentName))
    ));
    return (Array.isArray(rows) ? rows : []).filter(mine);
  }, [rows, canSeeAllRows, currentName]);

  const [tab, setTab] = useState('devis'); // 'devis' | 'bc'
  const [showTreated, setShowTreated] = useState(false); // afficher les lignes déjà décidées (signées / refusées)
  const [modal, setModal] = useState(null); // null | { mode:'new', kind } | { mode:'edit', kind, rec }
  const [busyId, setBusyId] = useState(null); // id de la ligne en cours de décision
  const [note, setNote] = useState(null); // { text, mailto? } — résultat du dernier e-mail
  const [filingBusy, setFilingBusy] = useState(false); // rangement « à la demande » des fichiers

  /* Lien depuis la page Recettes / OM / Achats prévus : ouvre l’onglet du
     devis / BC ciblé et garantit que la ligne est visible (un devis signé
     reste affiché tant que son BC n’est pas signé ; sinon on coche
     « Afficher les traités »). */
  useEffect(() => {
    if (!focus || focus.pageId !== 'devisBc') return undefined;
    const rid = focus.recordId;
    const found = (Array.isArray(rows) ? rows : []).find((x) => x && x.id === rid);
    if (found) {
      setTab(found.kind === 'bc' ? 'bc' : 'devis');
      const visibleByDefault = isApprovalPending(found.statut)
        || (found.kind === 'devis' && found.statut === APPROVAL_APPROVED);
      if (!visibleByDefault) setShowTreated(true);
    }
    if (typeof clearFocus === 'function') clearFocus();
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  const devisList = useMemo(() => visibleRows
    .filter((r) => r && r.kind === 'devis')
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)), [visibleRows]);
  const bcList = useMemo(() => visibleRows
    .filter((r) => r && r.kind === 'bc')
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)), [visibleRows]);
  const devisById = useMemo(() => new Map(devisList.map((d) => [d.id, d])), [devisList]);
  const devisOptions = useMemo(() => devisList, [devisList]);

  /* « Produits » : plusieurs devis candidats déposés pour un même achat
     (même groupeAchatId). Le groupe est décrit par son devis le plus récent
     (libellé = objet / n° devis) et `approvedId` repère le devis retenu
     quand le produit a déjà été décidé. */
  const productGroups = useMemo(() => {
    const byId = new Map();
    devisList.forEach((d) => {
      const g = txt(d.groupeAchatId);
      if (!g) return;
      let entry = byId.get(g);
      if (!entry) {
        entry = { id: g, devis: [], approvedId: '' };
        byId.set(g, entry);
      }
      entry.devis.push(d);
      if (d.statut === APPROVAL_APPROVED && !entry.approvedId) entry.approvedId = d.id;
    });
    return [...byId.values()].map((entry) => {
      const latest = entry.devis[0]; // devisList trié du plus récent au plus ancien
      const desc = txt(latest && (latest.description || latest.numDevis));
      return { ...entry, label: desc || entry.id, count: entry.devis.length, latest };
    });
  }, [devisList]);
  /* Rattachement automatique au dépôt : un devis dont l'objet saisi
     correspond exactement (accents / casse / espaces ignorés) à un produit
     déjà déposé rejoint ce produit. */
  const productMatchingDescription = (description) => {
    const key = norm(description);
    if (!key) return '';
    for (const p of productGroups) {
      if (norm(p.label) === key) return p.id;
    }
    return '';
  };
  /* Lignes « Devis » enrichies pour le tableau : informations produit
     (nombre de candidats, devis retenu du groupe) ajoutées à la volée, sans
     toucher au modèle stocké. */
  const devisRows = useMemo(() => {
    const counts = new Map();
    const approved = new Map();
    devisList.forEach((d) => {
      const g = txt(d.groupeAchatId);
      if (!g) return;
      counts.set(g, (counts.get(g) || 0) + 1);
      if (d.statut === APPROVAL_APPROVED && !approved.has(g)) approved.set(g, d.id);
    });
    return devisList.map((d) => {
      const g = txt(d.groupeAchatId);
      return {
        ...d,
        _produitCount: g ? counts.get(g) || 0 : 0,
        _produitApprovedId: g ? approved.get(g) || '' : '',
      };
    });
  }, [devisList]);

  /* « Ranger les fichiers » — copie dans Budget_labo/<année>/Devis|BC les
     documents (dont ceux collés comme liens Google Drive) des devis / BC déjà
     déposés avant l’arrivée du classement automatique (COPIE uniquement :
     l’original n’est jamais déplacé). */
  const runApprovalFiling = async () => {
    if (filingBusy) return;
    if (!cloudBackendAvailable()) {
      setNote({ text: 'Google Drive n’est pas connecté : connectez-le, puis relancez le rangement des fichiers.' });
      return;
    }
    const recs = (Array.isArray(visibleRows) ? visibleRows : []).filter((r) => r && r.id);
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
          const label = txt(rec.numBC) || txt(rec.numDevis) || txt(rec.description) || rec.id;
          reasons.push(`${rec.kind === 'bc' ? 'BC' : 'Devis'} « ${label} » : ${f.reason}`);
        });
      }
    } catch (err) {
      console.error(err);
      setNote({ text: `Erreur pendant le rangement : ${(err && err.message) || err}` });
      setFilingBusy(false);
      return;
    }
    setFilingBusy(false);
    if (copied === 0 && renamed === 0 && already === 0 && failed === 0) {
      setNote({ text: 'Aucun fichier lié à ranger : déposez un devis / BC avec un fichier (choix PC ou lien Drive).' });
      return;
    }
    const year = new Date().getFullYear();
    const detail = failed
      ? ` — ${reasons.slice(0, 10).join(' · ')}${reasons.length > 10 ? ` · … et ${reasons.length - 10} autre(s)` : ''}`
      : '';
    setNote({
      text: `Rangement des fichiers : ${copied} copie${copied > 1 ? 's' : ''} créée${copied > 1 ? 's' : ''} dans Budget_labo/${year}/Devis|BC (l’original reste en place) · `
        + `${renamed} fichier${renamed > 1 ? 's' : ''} renommé${renamed > 1 ? 's' : ''} selon la convention · `
        + `${already} déjà en place · ${failed} échec${failed > 1 ? 's' : ''}.${detail}`,
    });
  };

  /* ── Destinataires des e-mails (e-mail renseigné dans la fiche Personnel) ── */
  const superuserEmails = useMemo(
    () => superuserEmailsOf(operators, personnel),
    [operators, personnel]
  );
  const gestionnaireEmails = useMemo(
    () => personnelEmailsMatching(personnel, { fonction: 'Gestionnaire' }),
    [personnel]
  );
  /* Responsable(s) d'achats (fonction « Achats ») : notifiés dès qu'un devis
     est créé/déposé — ils travaillent sur le devis, le gestionnaire n'intervient
     qu'à partir du bon de commande (BC). */
  const achatsEmails = useMemo(
    () => personnelEmailsMatching(personnel, { fonction: 'Achats' }),
    [personnel]
  );

  const summarizeMail = async (res, label) => {
    if (res && res.ok) return { text: `${label} : e-mail envoyé ✓` };
    if (res && res.mode === 'mailto' && res.mailto) {
      return {
        text: `${label} : e-mail NON envoyé — ${res.reason || 'serveur e-mail indisponible'}. Cliquez pour l'envoyer depuis votre messagerie.`,
        mailto: res.mailto,
        ...(res.consoleUrl ? { consoleUrl: res.consoleUrl } : {}),
      };
    }
    return { text: `${label} : ${(res && res.reason) || 'e-mail non envoyé'}` };
  };

  const mailBody = (lines) =>
    `Bonjour,\n\n${lines.join('\n')}\n\nMessage envoyé automatiquement par Lab Workspace (module Administration).`;

  const notifyDeposit = async (rec) => {
    const isBc = rec && rec.kind === 'bc';
    const ref = txt(rec && (rec.numBC || rec.numDevis));
    /* Objet demandé : « nouveau devis à approuver » / « nouveau BC à approuver ». */
    const subject = `[Lab Workspace] Nouveau ${isBc ? 'BC' : 'devis'} à approuver${ref ? ` — ${ref}` : ''}`;
    const deposantName = txt(rec && rec.deposant) || currentName;
    const deposantPerson = personnel.find((p) => sameName(p.nom, deposantName));
    const deposantEmail = personEmailOf(deposantPerson);
    const text = mailBody([
      `Nouveau ${isBc ? 'BC' : 'devis'} à approuver : ${txt(rec.description) || (isBc ? 'Bon de commande' : 'Devis')}${ref ? ` (${ref})` : ''}`,
      `Fournisseur : ${txt(rec.fournisseur) || '—'}`,
      `Déposé par : ${deposantName}`,
      txt(rec.fichierUrl) ? `Fichier : ${rec.fichierUrl}` : '',
      'Ouvrez l’application › Administration › Approbation devis & BC pour approuver ou refuser.',
    ].filter(Boolean));
    /* À la création d'un DEVIS : le superutilisateur (pour approuver) ET le(s)
       responsable(s) d'achats (qui travaillent sur le devis) sont notifiés.
       Pour un BC, le superutilisateur reste seul destinataire. */
    const to = isBc ? superuserEmails : mergeEmails(superuserEmails, achatsEmails);
    const res = await sendAdminMail({
      to,
      subject,
      text,
      /* L'e-mail est envoyé depuis le compte Google connecté ; si l'adresse de
         la fiche Personnel du déposant diffère, elle sert de Reply-To. */
      fromName: deposantName,
      replyTo: deposantEmail,
    });
    setNote(await summarizeMail(res, 'Superutilisateur notifié'));
  };

  const notifyDecision = async (rec, decision) => {
    const isBc = rec && rec.kind === 'bc';
    const ref = txt(rec && (rec.numBC || rec.numDevis));
    /* Objet demandé : « Devis approuvé » / « BC approuvé » (ou « refusé »). */
    const subject = `[Lab Workspace] ${isBc ? 'BC' : 'Devis'} ${decision.toLowerCase()}${ref ? ` — ${ref}` : ''}`;
    const text = mailBody([
      `Le ${isBc ? 'BC' : 'devis'} suivant a été ${decision.toLowerCase()} :`,
      `  ${txt(rec.description) || (isBc ? 'Bon de commande' : 'Devis')}${ref ? ` (${ref})` : ''}`,
      `  Fournisseur : ${txt(rec.fournisseur) || '—'}`,
      `  Déposé par : ${txt(rec.deposant) || '—'}`,
      decision === APPROVAL_APPROVED
        ? (rec.kind === 'devis'
          ? 'Le devis est validé. La dépense ne sera créée qu\'à la signature du BC lié (elle passera directement « BC signé » dans la page Dépenses).'
          : 'La dépense « BC signé » correspondante a été créée (ou mise à jour) — date de signature du BC : aujourd\'hui.')
        : 'Aucune dépense n’a été créée pour cette ligne.',
      txt(rec.fichierUrl) ? `Fichier : ${rec.fichierUrl}` : '',
    ].filter(Boolean));
    const to = [...gestionnaireEmails];
    const deposantEmail = personEmailOf(personnel.find((p) => sameName(p.nom, txt(rec.deposant))));
    if (deposantEmail && to.indexOf(deposantEmail) === -1) to.push(deposantEmail);
    /* Expéditeur = compte Google connecté (celui qui prend la décision) ; son
       adresse de la fiche Personnel sert de Reply-To quand elle diffère. */
    const actorPerson = personnel.find((p) => sameName(p.nom, currentName));
    const res = await sendAdminMail({
      to,
      subject,
      text,
      fromName: currentName || 'Lab Workspace',
      replyTo: personEmailOf(actorPerson) || deposantEmail,
    });
    setNote(await summarizeMail(res, 'Gestionnaire notifié'));
  };

  /* E-mail « Devis non retenu » : prévient le déposant (et les gestionnaires)
     quand un devis candidat n'a pas été retenu lors de l'approbation d'un
     autre devis du même produit. */
  const notifyNotRetained = async (nrRec, retainedRec) => {
    const ref = txt(nrRec && nrRec.numDevis);
    const subject = `[Lab Workspace] Devis non retenu${ref ? ` — ${ref}` : ''}`;
    const retained = txt(retainedRec && retainedRec.numDevis)
      || txt(retainedRec && retainedRec.description)
      || 'un autre devis du même achat';
    const text = mailBody([
      `Le devis suivant n'a pas été retenu pour cet achat :`,
      `  ${txt(nrRec && nrRec.description) || 'Devis'}${ref ? ` (${ref})` : ''}`,
      `  Fournisseur : ${txt(nrRec && nrRec.fournisseur) || '—'}`,
      `  Déposé par : ${txt(nrRec && nrRec.deposant) || '—'}`,
      `Devis retenu : ${retained} — la dépense sera créée « BC signé » à la signature de son bon de commande.`,
    ].filter(Boolean));
    const to = [...gestionnaireEmails];
    const deposantEmail = personEmailOf(personnel.find((p) => sameName(p.nom, txt(nrRec && nrRec.deposant))));
    if (deposantEmail && to.indexOf(deposantEmail) === -1) to.push(deposantEmail);
    const actorPerson = personnel.find((p) => sameName(p.nom, currentName));
    const res = await sendAdminMail({
      to,
      subject,
      text,
      fromName: currentName || 'Lab Workspace',
      replyTo: personEmailOf(actorPerson) || deposantEmail,
    });
    setNote(await summarizeMail(res, 'Déposant notifié'));
  };

  /* ── Signature automatique des devis / BC approuvés (PDF) ──────────────────
     Quand le superutilisateur approuve un devis ou un BC, si une image de
     signature est enregistrée dans les réglages ET que le fichier déposé est
     un PDF (ou une image) accessible sur Google Drive, une COPIE SIGNÉE est
     créée (l'original reste intact) :
       Budget_labo/<année>/Devis|BC › <nom conventionnel>_approuvé_signé.pdf
     Cette copie devient le fichier officiel de la ligne devis/BC et de la
     dépense créée/mise à jour par l'approbation. Tout est best-effort : en cas
     d'échec, la décision reste enregistrée et un message l'explique. */
  const signDepositDocument = async (rec, depId) => {
    const signature = settings && settings.approvalSignature;
    const frags = [];
    const warn = (msg) => frags.push(`✍️ Signature : ${msg}`);
    if (!rec || !rec.id) return frags;
    if (!signature || !txt(signature.dataUrl)) return frags; // aucune image : rien à faire
    try {
      if (!cloudBackendAvailable()) {
        warn('Google Drive non connecté — le PDF signé n’a pas été créé.');
        return frags;
      }
      const fileId = driveFileIdFromUrl(txt(rec.fichierUrl));
      if (!fileId) {
        warn('fichier non stocké sur Google Drive — le PDF signé n’a pas été créé.');
        return frags;
      }
      let docKind = depositFileKindOf(rec);
      let mime = String(rec.fichierMime || '').toLowerCase();
      /* Le fichier collé en lien (sans type MIME local) : on interroge Drive. */
      try {
        const metaRes = await driveFetch(`/drive/v3/files/${fileId}?fields=name,mimeType`);
        const meta = metaRes ? await metaRes.json() : null;
        const metaName = String(meta && meta.name || '');
        mime = String(meta && meta.mimeType || mime).toLowerCase();
        if (mime === 'application/pdf' || /\.pdf$/i.test(metaName)) docKind = 'pdf';
        else if (mime.startsWith('image/') || /\.(jpe?g|png)$/i.test(metaName)) docKind = 'image';
      } catch { /* on garde le type deviné depuis l'enregistrement */ }

      /* Octets du document : téléchargés via l'API d'abord. Quand le fichier
         est INVISIBLE à l'API (déposé à la main dans un Drive personnel non
         partagé — autorisation limitée « drive.file »), on retente par son
         adresse PUBLIQUE — exactement comme le ré-import des documents
         (./driveReimport.js). Sans ce repli, la copie signée n'était jamais
         créée pour ces fichiers et la signature « disparaissait ». */
      let bytes = null;
      try {
        const contentRes = await driveFetch(`/drive/v3/files/${fileId}?alt=media`, {
          headers: { Accept: docKind === 'pdf' ? 'application/pdf' : (mime || 'image/png') },
        });
        if (contentRes && contentRes.ok) bytes = new Uint8Array(await contentRes.arrayBuffer());
      } catch { /* → tentative par adresse publique ci-dessous */ }
      if (!bytes || !bytes.length) {
        try {
          const dl = await downloadDriveFileBytes(fileId);
          if (dl && dl.bytes && dl.bytes.byteLength) {
            bytes = new Uint8Array(dl.bytes);
            const dlMime = String(dl.mimeType || '').toLowerCase();
            if (dlMime) mime = dlMime;
            const dlName = String(dl.name || '');
            if (/\.pdf$/i.test(dlName)) docKind = 'pdf';
            else if (/\.(jpe?g|png)$/i.test(dlName)) docKind = 'image';
          }
        } catch { bytes = null; }
        if (!bytes || !bytes.length) {
          warn('impossible de télécharger le fichier (permissions Google Drive ?). Partagez-le avec le compte de l’app, ou téléversez-le depuis ce PC avec « ⬆ PC », puis approuvez à nouveau.');
          return frags;
        }
      }

      /* Le CONTENU fait foi : certains documents sont mal étiquetés (vrai PDF
         vu comme PNG, ou l'inverse). La détection par les premiers octets évite
         de produire une « copie signée » qui serait en réalité une image — la
         copie signée téléversée est toujours un vrai PDF. */
      const sniffed = sniffBudgetDocBytes(bytes);
      if (sniffed === 'pdf') { docKind = 'pdf'; mime = 'application/pdf'; }
      else if (sniffed === 'image/png' || sniffed === 'image/jpeg') { docKind = 'image'; mime = sniffed; }
      if (docKind === 'other') {
        warn('document non PDF (Word, Excel…) — la signature ne peut pas y être apposée.');
        return frags;
      }
      if (!bytes || !bytes.length) {
        warn('fichier vide — la copie signée n’a pas été créée.');
        return frags;
      }
      const kindLabel = rec.kind === 'bc' ? 'BC' : 'Devis';
      const ref = txt(rec.kind === 'bc' ? rec.numBC : rec.numDevis);
      const captionLines = [
        'Bon pour accord',
        `${kindLabel}${ref ? ` N° ${ref}` : ''} — approuvé le ${frShortDateOf()} par ${currentName}`,
      ];
      const signedBytes = docKind === 'pdf'
        ? await stampPdfWithSignature({ pdfBytes: bytes, signatureDataUrl: signature.dataUrl, captionLines })
        : await makeSignedPdfFromImage({
          imageDataUrl: bytesToDataUrl(bytes, mime || 'image/png'),
          signatureDataUrl: signature.dataUrl,
          captionLines,
        });
      const signedName = signedDocDriveName(rec);
      const drive = await uploadLocalFile({
        name: signedName,
        mimeType: 'application/pdf',
        file: new Blob([signedBytes], { type: 'application/pdf' }),
        path: budgetLaboPath(rec.kind),
      });
      if (!drive || !drive.driveUrl) {
        warn('téléversement de la copie signée impossible (Drive non connecté ?).');
        return frags;
      }
      const driveName = String(drive.name || signedName);
      upsert('devisBc', {
        fichierNom: driveName,
        fichierUrl: drive.driveUrl,
        fichierMime: 'application/pdf',
        signedAt: Date.now(),
        signedBy: currentName,
      }, rec.id);
      if (depId) {
        const linkField = rec.kind === 'bc' ? 'numBCUrl' : 'numDevisUrl';
        upsert('depenses', { [linkField]: drive.driveUrl }, depId);
      }
      frags.push(`✍️ Copie signée « ${driveName} » créée — c'est maintenant le fichier officiel.`);
      return frags;
    } catch (err) {
      console.warn('Signature automatique du document ignorée :', err && err.message);
      warn((err && err.message) || 'erreur inattendue.');
      return frags;
    }
  };

  /** Ajoute un fragment d'information au bandeau de note SANS écraser ce qui
   *  s'y trouve déjà (l'e-mail, le rangement des fichiers, la signature…). */
  const appendNoteFrag = (frags) => {
    if (!Array.isArray(frags) || !frags.length) return;
    setNote((prev) => {
      const base = prev || {};
      return { ...base, text: [prev && prev.text, frags.join(' · ')].filter(Boolean).join(' ') };
    });
  };

  const setApprovalSignature = (sig) => updateSettings({ approvalSignature: sig });
  const clearApprovalSignature = () => updateSettings({ approvalSignature: null });

    /* ── Décisions (réservées au superutilisateur) ────────────────────────── */
  const decideRow = async (rec, decision) => {
    if (!rec || !rec.id) return;
    if (!isSuper || !isApprovalPending(rec.statut)) return;
    setBusyId(rec.id);
    try {
      if (decision === APPROVAL_REJECTED) {
        upsert('devisBc', { statut: APPROVAL_REJECTED, decidedBy: currentName, decidedAt: Date.now() }, rec.id);
        await notifyDecision({ ...rec, statut: APPROVAL_REJECTED }, APPROVAL_REJECTED);
      } else if (rec.kind === 'devis') {
        /* Un devis « En gestion » (documents incomplets) n'est pas signable :
           il doit d'abord être complété puis envoyé pour signature. */
        if (rec.statut === APPROVAL_GESTION || !devisCompleteOf(rec)) {
          alert('Ce devis est incomplet (N° devis et/ou fichier manquants). Complétez-le d’abord — il est « En gestion » — puis envoyez-le pour signature (✉️).');
          return;
        }
        /* Approbation du devis → le document est validé (« Approuvé »), mais la
           dépense n'est PAS créée ici : elle n'existera qu'à la signature du BC
           lié (la dépense est alors créée directement « BC signé » dans la page
           Dépenses et comptée sur la page Recettes).

           Devis candidats : quand plusieurs devis d'un même produit ont été
           déposés (même groupeAchatId), UN SEUL peut être approuvé — sinon
           l'achat serait engagé deux fois. */
        const groupeAchatId = txt(rec.groupeAchatId);
        const candidats = groupeAchatId
          ? devisList.filter((d) => d.kind === 'devis' && txt(d.groupeAchatId) === groupeAchatId && d.id !== rec.id)
          : [];
        const dejaRetenu = candidats.find((d) => d.statut === APPROVAL_APPROVED);
        if (dejaRetenu) {
          const label = txt(dejaRetenu.numDevis) || txt(dejaRetenu.fournisseur) || txt(dejaRetenu.description) || 'devis déjà approuvé';
          const decidedOn = dejaRetenu.decidedAt
            ? ` le ${toFrDate(isoOf(new Date(dejaRetenu.decidedAt).toISOString()))}`
            : '';
          alert(
            `Ce produit a déjà un devis approuvé — un seul devis peut être retenu par achat.\n\n`
            + `Devis déjà retenu : ${label} (décision de ${txt(dejaRetenu.decidedBy) || '—'}${decidedOn}).\n\n`
            + `La dépense ne sera créée qu'à la signature du BC de ce devis. Pour retenir un autre `
            + `devis, repassez d'abord celui-ci « En attente » (modification), puis approuvez le nouveau devis.`
          );
          return;
        }
        const approvedDevis = upsert('devisBc', {
          statut: APPROVAL_APPROVED,
          decidedBy: currentName,
          decidedAt: Date.now(),
        }, rec.id);
        /* Devis approuvé → le fichier Drive reçoit la marque « _approuvé ». */
        const approvedDevisName = await renameDepositDriveFileTo(approvedDevis);
        if (approvedDevisName) upsert('devisBc', { fichierNom: approvedDevisName }, approvedDevis.id);
        await notifyDecision({ ...rec, statut: APPROVAL_APPROVED }, APPROVAL_APPROVED);
        /* Les autres candidats du même produit encore « En attente » ne sont pas
           retenus : décision enregistrée (traçabilité) + e-mail au déposant. */
        for (const sib of candidats) {
          if (!isApprovalPending(sib.statut)) continue;
          const nonRetenu = upsert('devisBc', { statut: APPROVAL_NOT_RETAINED, decidedBy: currentName, decidedAt: Date.now() }, sib.id);
          await notifyNotRetained(nonRetenu, rec);
        }
        /* ✍️ Devis approuvé → copie signée du PDF (best-effort, l'original reste
           intact) : la copie « …_approuvé_signé.pdf » devient le fichier
           officiel du devis (aucune dépense liée à cette étape). */
        appendNoteFrag(await signDepositDocument(approvedDevis, ''));
      } else {
        /* Approbation du BC → la dépense réelle est CRÉÉE (ou, pour un ancien
           devis déjà approuvé qui avait créé une dépense « Devis en cours »,
           mise à jour) directement « BC signé ». La date de signature du BC
           (dateSignature) est renseignée automatiquement. La dépense porte la
           catégorie, la ligne budgétaire imputée, la recette liée et le N°
           SIFAC/D.A. — indispensables pour qu'elle soit comptée sur la bonne
           ligne de la page Recettes. Un N° SIFAC/D.A. encore manquant ne
           bloque pas : la dépense est créée quand même et comptabilisée dès
           que sa date de signature est renseignée. */
        const devisRec = rec.devisId ? devisById.get(rec.devisId) : null;
        if (!devisRec) {
          alert('Impossible d’approuver ce BC : aucun devis lié. Modifiez la ligne pour choisir le devis correspondant.');
          return;
        }
        const depId = txt(rec.depenseId) || (devisRec && txt(devisRec.depenseId));
        const existingDep = depId ? depensesById.get(depId) : null;
        if (!existingDep && approvalStatusOf(devisRec.statut) !== APPROVAL_APPROVED) {
          alert('Impossible d’approuver ce BC : le devis lié doit d’abord être approuvé.');
          return;
        }
        /* Les valeurs du BC l'emportent, puis celles du devis, puis celles de
           l'éventuelle dépense « Devis en cours » créée avant ce changement. */
        const srcDep = existingDep || null;
        const categorie = txt(rec.categorie) || txt(devisRec.categorie) || txt(srcDep && srcDep.categorie);
        const ligneBudgetaire = txt(rec.ligneBudgetaire)
          || txt(devisRec.ligneBudgetaire)
          || txt(srcDep && srcDep.ligneBudgetaire);
        const numSIFAC = txt(rec.numSIFAC) || txt(devisRec.numSIFAC) || txt(srcDep && srcDep.numSIFAC);
        /* Fiche Recettes imputée : idéalement choisie au dépôt (recetteId) ;
           sinon on la retrouve par l'intitulé + la catégorie, puis par
           l'intitulé seul — jamais on ne relie à une fiche de l'autre type
           quand la catégorie est connue. */
        const recettesList = Array.isArray(data.recettes) ? data.recettes : [];
        let recetteId = txt(rec.recetteId) || txt(devisRec.recetteId) || txt(srcDep && srcDep.recetteId);
        if (!recetteId && ligneBudgetaire) {
          const found = findRecetteByLabel(recettesList, ligneBudgetaire, categorie)
            || findRecetteByLabel(recettesList, ligneBudgetaire, '');
          if (found) recetteId = found.id;
        }
        const devisSignatureDate = (devisRec && devisRec.decidedAt)
          ? isoOf(new Date(devisRec.decidedAt).toISOString())
          : (srcDep ? isoOf(srcDep.dateSignatureDevis) : todayIso()) || todayIso();
        const depPatch = {
          description: txt(rec.description) || txt(devisRec.description) || txt(srcDep && srcDep.description),
          fournisseur: txt(rec.fournisseur) || txt(devisRec.fournisseur) || txt(srcDep && srcDep.fournisseur),
          numDevis: txt(devisRec.numDevis) || txt(srcDep && srcDep.numDevis),
          numDevisUrl: txt(devisRec.fichierUrl) || txt(srcDep && srcDep.numDevisUrl),
          numBC: txt(rec.numBC),
          numBCUrl: txt(rec.fichierUrl),
          dateBC: isoOf(rec.dateDepot) || todayIso(),
          dateSignature: todayIso(),
          statut: 'BC signé',
          suivi: 'BC signé',
          demandeur: txt(rec.demandeur) || txt(devisRec.demandeur) || txt(srcDep && srcDep.demandeur) || currentName,
          montant: numOf(rec.montant) === null
            ? (numOf(devisRec.montant) === null ? numOf(srcDep && srcDep.montant) : numOf(devisRec.montant))
            : numOf(rec.montant),
          commentaires: txt(rec.notes) || txt(devisRec.notes) || txt(srcDep && srcDep.commentaires),
        };
        if (numOf(rec.fraisPort) !== null) depPatch.fraisPort = numOf(rec.fraisPort);
        else if (numOf(devisRec.fraisPort) !== null) depPatch.fraisPort = numOf(devisRec.fraisPort);
        else if (srcDep && numOf(srcDep.fraisPort) !== null) depPatch.fraisPort = numOf(srcDep.fraisPort);
        if (categorie) depPatch.categorie = categorie;
        if (ligneBudgetaire) depPatch.ligneBudgetaire = ligneBudgetaire;
        if (recetteId) depPatch.recetteId = recetteId;
        if (numSIFAC) depPatch.numSIFAC = numSIFAC;
        if (!srcDep) {
          /* Dépense créée ici : on reprend la date de demande du devis et la
             date de signature du devis (jour de son approbation). */
          depPatch.dateDemande = isoOf(devisRec.dateDepot) || isoOf(rec.dateDepot) || todayIso();
          depPatch.dateSignatureDevis = devisSignatureDate;
        }
        const dep = upsert('depenses', depPatch, depId || null);
        const approvedBc = upsert('devisBc', { statut: APPROVAL_APPROVED, depenseId: dep.id, decidedBy: currentName, decidedAt: Date.now() }, rec.id);
        /* On relie aussi le devis à la dépense (suivi « devis visible tant que
           son BC n'est pas signé » et transferts OM / achats prévus). */
        if (!txt(devisRec.depenseId) || txt(devisRec.depenseId) !== dep.id) {
          upsert('devisBc', { depenseId: dep.id }, devisRec.id);
        }
        /* BC approuvé → le fichier Drive reçoit la marque « _approuvé ». */
        const approvedBcName = await renameDepositDriveFileTo(approvedBc);
        if (approvedBcName) upsert('devisBc', { fichierNom: approvedBcName }, approvedBc.id);
        await notifyDecision({ ...rec, statut: APPROVAL_APPROVED, depenseId: dep.id }, APPROVAL_APPROVED);
        /* ✍️ BC approuvé → copie signée du PDF (best-effort, l'original reste
           intact) : la copie « …_approuvé_signé.pdf » devient le fichier
           officiel du BC et le lien « BC » de la dépense passe à « BC signé ». */
        appendNoteFrag(await signDepositDocument(approvedBc, dep.id));
      }
    } catch (err) {
      console.error(err);
      alert(`La décision n'a pas pu être enregistrée : ${(err && err.message) || err}`);
    } finally {
      setBusyId(null);
    }
  };

  /* ── Envoi pour signature d'un devis « En gestion » ─────────────────────
     Une fois les documents complétés (N° devis + fichier) par la responsable
     d'achats (ou le superutilisateur), le devis passe « En attente » — il
     s'affiche « en attente de signature » au directeur, qui est prévenu par
     e-mail. */
  const sendForSignatureMail = async (rec) => {
    if (!rec || !rec.id) return;
    const ref = txt(rec.numDevis) || txt(rec.description) || rec.id;
    const res = await sendAdminMail({
      to: superuserEmails,
      subject: `[Lab Workspace] Devis envoyé pour signature — ${ref}`,
      text: mailBody([
        `Le devis suivant a été complété et envoyé pour signature :`,
        `  ${txt(rec.description) || ref}`,
        `N° devis : ${txt(rec.numDevis) || '—'}`,
        txt(rec.fournisseur) ? `Fournisseur : ${txt(rec.fournisseur)}` : '',
        `Demandeur : ${txt(rec.demandeur) || txt(rec.deposant) || '—'}`,
        txt(rec.ligneBudgetaire) ? `Ligne budgétaire : ${txt(rec.ligneBudgetaire)}` : '',
        `Envoyé par : ${currentName || '—'}.`,
      ].filter(Boolean)),
    });
    const summary = summarizeMail(res, 'Superutilisateur notifié');
    setNote((prev) => ({
      ...(prev || {}),
      text: ['✓ Devis envoyé pour signature : il est désormais « en attente de signature ».', summary.text].filter(Boolean).join(' '),
      ...(summary.mailto ? { mailto: summary.mailto } : {}),
      ...(summary.consoleUrl ? { consoleUrl: summary.consoleUrl } : {}),
    }));
  };

  const sendForSignature = async (rec) => {
    if (!rec || !rec.id || rec.kind !== 'devis') return;
    if (rec.statut !== APPROVAL_GESTION) return;
    if (!devisCompleteOf(rec)) {
      alert('Le devis n’est pas encore complet : renseignez le N° devis ET le fichier (téléversé ou lien Google Drive) avant de l’envoyer pour signature.');
      return;
    }
    upsert('devisBc', {
      statut: APPROVAL_PENDING,
      notes: [txt(rec.notes), `✉️ Envoyé pour signature le ${todayIso()} par ${currentName}.`].filter(Boolean).join(' · '),
    }, rec.id);
    await sendForSignatureMail({ ...rec, statut: APPROVAL_PENDING });
  };

  /* ── Renvoi à la responsable d'achats (superutilisateur) ──────────────────
     Le devis est « En attente de signature », mais le superutilisateur juge
     qu’il ne convient pas encore : il le renvoie « En gestion » à la
     responsable d'achats (motif demandé, e-mail envoyé), qui pourra corriger
     puis le renvoyer pour signature. */
  const returnToAchats = async (rec) => {
    if (!rec || !rec.id || rec.kind !== 'devis' || !isSuper) return;
    if (approvalStatusOf(rec.statut) !== APPROVAL_PENDING || rec.statut === APPROVAL_GESTION) return;
    const ref = txt(rec.numDevis) || txt(rec.description) || rec.id;
    const motif = window.prompt(
      `Renvoyer le devis « ${ref} » à la responsable d'achats ?\nIndiquez le motif : il lui sera transmis par e-mail.`,
      ''
    );
    if (motif === null) return;
    upsert('devisBc', {
      statut: APPROVAL_GESTION,
      notes: [txt(rec.notes), `↩️ Renvoyé à la responsable d'achats le ${todayIso()} par ${currentName}${txt(motif) ? ` — motif : ${txt(motif)}` : ''} : à corriger, puis ré-envoyer pour signature.`].filter(Boolean).join(' · '),
    }, rec.id);
    const deposantPerson = personnel.find((p) => sameName(txt(p && p.nom), txt(rec.deposant))) || null;
    const deposantEmail = deposantPerson ? personEmailOf(deposantPerson) : '';
    const res = await sendAdminMail({
      to: mergeEmails(achatsEmails, deposantEmail ? [deposantEmail] : []),
      subject: `[Lab Workspace] Devis « ${ref} » renvoyé pour révision`,
      text: mailBody([
        `Le devis « ${ref} » vous a été renvoyé : il ne convient pas encore.`,
        `  ${txt(rec.description) || ''}`,
        txt(motif) ? `Motif : ${txt(motif)}` : 'Motif : à compléter / corriger.',
        `Demandeur : ${txt(rec.demandeur) || txt(rec.deposant) || '—'}`,
        `Renvoi décidé par : ${currentName || 'superutilisateur'}.`,
        `Le devis repart « En gestion » dans « Approbation devis & BC » : corrigez-le puis renvoyez-le pour signature (✉️).`,
      ].filter(Boolean)),
    });
    const summary = summarizeMail(res, 'Responsable d’achats notifiée');
    setNote({
      text: `✓ Devis « ${ref} » renvoyé à la responsable d'achats (il repart « En gestion »). ${summary.text}`,
      ...(summary.mailto ? { mailto: summary.mailto } : {}),
      ...(summary.consoleUrl ? { consoleUrl: summary.consoleUrl } : {}),
    });
  };

  /* ── Suppression (superutilisateur uniquement) ────────────────────────── */
  const removeRow = (rec) => {
    if (!rec || !rec.id || !isSuper) return;
    const ref = txt(rec.numBC) || txt(rec.numDevis) || txt(rec.description) || rec.id;
    if (!window.confirm(`Supprimer définitivement cette ligne « ${ref} » ?`)) return;
    /* Un devis supprimé ne doit pas laisser un BC orphelin : les bons de
       commande rattachés via `devisId` perdent ce lien (la colonne « Devis
       lié » affiche « — » au lieu d'un devis disparu). */
    if (rec.kind === 'devis') {
      const changes = (Array.isArray(data.devisBc) ? data.devisBc : [])
        .filter((d) => d && d.id && d.kind === 'bc' && txt(d.devisId) === rec.id)
        .map((d) => ({ id: d.id, patch: { devisId: '' } }));
      if (changes.length) updateMany('devisBc', changes);
    }
    remove('devisBc', rec.id);
  };

    const activeKind = tab;
  /* Un devis approuvé (« Signé ») reste listé tant que le BC qui s’y rattache
     n’est pas lui-même signé : il ne disparaît qu’à la signature du BC (le
     suivi reprend alors dans la page Dépenses / la colonne « Achats (BC
     signé) » de la page Recettes). « Refusé », « Non retenu » et les BC signés
     ne s’affichent que via « Afficher les traités ». */
  const depHasSignedBc = (d) => !!(d && (txt(d.dateSignature) || txt(d.dateSignatureBC)
    || /bc s/i.test(txt(d.statut || d.suivi))));
  const approvedDevisStillOpen = (r) => !!r && r.kind === 'devis'
    && r.statut === APPROVAL_APPROVED
    && !(txt(r.depenseId) && depHasSignedBc(depensesById.get(txt(r.depenseId))));
  const activeRows = (tab === 'bc' ? bcList : devisRows)
    .filter((r) => showTreated || isApprovalPending(r.statut) || approvedDevisStillOpen(r));
  const columns = useMemo(
    () => buildColumns({
      kind: activeKind,
      isSuper,
      busyId,
      devisById,
      canEdit: (r) => {
        if (isSuper) return true;
        if (!isApprovalPending(r && r.statut)) return false;
        /* Devis / BC générés automatiquement par un transfert (« OM / achat
           prévu ») : la gestionnaire et le responsable d'achats peuvent les
           compléter (fournisseur, N° devis, fichier…) tant qu'ils sont « En
           attente » / « En gestion », même sans être le déposant nominal. */
        const generated = !!(r && (r.transfert || r.sourceKind || r.sourceId));
        if (generated && currentName && isAchatsRole) return true;
        return !!(txt(r.deposant) && currentName && sameName(r.deposant, currentName));
      },
      onDecide: decideRow,
      onEdit: (r) => setModal({ mode: 'edit', kind: activeKind, rec: r }),
      onRemove: removeRow,
      onSendForSignature: sendForSignature,
      onSendBack: returnToAchats,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeKind, isSuper, busyId, devisById, activeRows, currentName, isAchatsRole, showTreated, sendForSignature, returnToAchats]
  );

  const pendingCount = (kind) => visibleRows.filter((r) => r.kind === kind && isApprovalPending(r.statut)).length;
  const decidedCount = (kind) => visibleRows.filter((r) => r.kind === kind && !isApprovalPending(r.statut)).length;
  const gestionCount = (kind) => visibleRows.filter((r) => r.kind === kind && r.statut === APPROVAL_GESTION).length;

  /* ── Enregistrement d'un dépôt (nouveau ou modification) ─────────────── */
  const onSaveDeposit = async (draft, existingId) => {
    const kind = draft && draft.kind;
    const isNew = !existingId;
    const description = txt(draft.description);
    const numDevis = txt(draft.numDevis);
    const numBC = txt(draft.numBC);
    if (!description && !numDevis && !numBC) {
      alert('Merci de renseigner au moins une description ou une référence (N° devis / N° BC).');
      return false;
    }
    /* Nouveaux dépôts : l’information complète est exigée (N° devis/BC,
       fournisseur et montant) pour pouvoir créer la dépense à l’approbation. */
    if (isNew) {
      if (kind === 'devis' && !numDevis) {
        alert('Le N° devis est obligatoire pour un nouveau dépôt.');
        return false;
      }
      if (kind === 'bc' && !numBC) {
        alert('Le N° BC est obligatoire pour un nouveau dépôt.');
        return false;
      }
      if (!txt(draft.fournisseur)) {
        alert('Le fournisseur est obligatoire : choisissez-le dans le menu de la Librairie.');
        return false;
      }
      if (numOf(draft.montant) === null) {
        alert('Le montant HT est obligatoire pour un nouveau dépôt.');
        return false;
      }
      /* Le BC porte la catégorie et le N° SIFAC/D.A. de la commande : ce sont
         eux qui permettront de créer la dépense « BC signé » complète à
         l'approbation (et donc de la compter sur la bonne ligne des Recettes). */
      if (kind === 'bc' && !txt(draft.categorie)) {
        alert('La catégorie (Fonctionnement / Investissement) est obligatoire pour un nouveau BC : c’est elle qui relie la dépense à la bonne ligne budgétaire.');
        return false;
      }
      if (kind === 'bc' && !txt(draft.numSIFAC)) {
        alert('Le N° SIFAC/D.A. est obligatoire pour un nouveau BC.');
        return false;
      }
    }
    if (!txt(draft.fichierUrl)) {
      alert('Le fichier (devis ou BC) est obligatoire : téléversez-le ou collez son lien Google Drive.');
      return false;
    }
    if (kind === 'bc' && !txt(draft.devisId)) {
      alert('Choisissez le devis auquel ce bon de commande se rattache (déposez d’abord le devis).');
      return false;
    }
    /* Rattachement « produit » (devis uniquement) : groupe choisi dans le
       formulaire, sinon rattachement automatique quand l'objet saisi
       correspond exactement à un produit déjà déposé, sinon nouveau produit
       (un id est généré ici — un second devis du même achat rejoindra ce
       groupe en le choisissant ou en ressaisissant le même objet). */
    const groupeAchatId = kind === 'devis'
      ? (txt(draft.groupeAchatId) || productMatchingDescription(description) || newGroupeAchatId())
      : '';
    /* Devis généré par un transfert de demande, encore « En gestion » : dès
       que la responsable d'achats renseigne le N° devis ET le fichier, le devis
       passe automatiquement « En attente » (= envoyé pour signature). */
    const existingRec = existingId ? visibleRows.find((x) => x.id === existingId) : null;
    const generatedEdit = !!existingRec && !!(existingRec.transfert || existingRec.sourceKind || existingRec.sourceId);
    const wasGestion = !!existingRec && existingRec.statut === APPROVAL_GESTION;
    const documentsComplete = !!(numDevis && txt(draft.fichierUrl));
    let statut;
    if (generatedEdit && wasGestion) {
      statut = documentsComplete ? APPROVAL_PENDING : APPROVAL_GESTION;
    } else {
      statut = isApprovalPending(draft.statut) ? APPROVAL_PENDING : approvalStatusOf(draft.statut);
    }
    const patch = {
      kind,
      description,
      fournisseur: txt(draft.fournisseur),
      ligneBudgetaire: txt(draft.ligneBudgetaire),
      categorie: txt(draft.categorie),
      numSIFAC: txt(draft.numSIFAC),
      recetteId: txt(draft.recetteId),
      demandeur: txt(draft.demandeur),
      numDevis: kind === 'devis' ? numDevis : txt(draft.numDevis),
      numBC: kind === 'bc' ? numBC : '',
      devisId: kind === 'bc' ? txt(draft.devisId) : '',
      ...(kind === 'devis' ? { groupeAchatId } : {}),
      montant: numOf(draft.montant),
      fraisPort: numOf(draft.fraisPort),
      fichierNom: txt(draft.fichierNom),
      fichierUrl: txt(draft.fichierUrl),
      fichierMime: txt(draft.fichierMime),
      notes: txt(draft.notes),
      deposant: txt(draft.deposant) || currentName,
      statut,
      dateDepot: txt(draft.dateDepot) || todayIso(),
    };
    /* Un devis « En gestion » complété et envoyé pour signature : on le signale
       dans ses notes pour la traçabilité. */
    if (generatedEdit && wasGestion && documentsComplete) {
      patch.notes = [patch.notes, `✉️ Devis complété et envoyé pour signature le ${todayIso()} par ${currentName}.`].filter(Boolean).join(' · ');
    }
    const saved = upsert('devisBc', patch, existingId || null);
    /* Devis « En gestion » complété via le formulaire (= envoyé pour
       signature) → e-mail au superutilisateur pour qu’il le signe. */
    if (generatedEdit && wasGestion && documentsComplete && saved && saved.id) {
      await sendForSignatureMail(saved);
    }
    /* Renommage du fichier déposé sur Google Drive selon la convention du
       laboratoire (nom reconstruit à chaque enregistrement ; « _approuvé »
       quand la ligne est approuvée). Best-effort : un fichier collé en lien
       depuis ailleurs et inaccessible à l’app garde son nom d’origine. */
    try {
      const renamedTo = await renameDepositDriveFileTo(saved);
      if (renamedTo && renamedTo !== txt(saved.fichierNom)) {
        upsert('devisBc', { fichierNom: renamedTo }, saved.id);
      }
    } catch { /* le dépôt reste enregistré même si le renommage échoue */ }
    if (isNew) {
      await notifyDeposit(saved);
    }
    /* Copie du fichier dans Budget_labo/<année>/Devis|BC (best-effort) —
       surtout utile quand le fichier a été collé comme lien Google Drive :
       une copie (jamais un déplacement) est déposée au bon endroit ; un
       fichier d’un autre compte / non partagé n’est pas copiable et le message
       l’explique. Inutile quand Drive n’est pas connecté (aucun fichier
       n’aurait pu y être téléversé depuis ce PC). */
    if (cloudBackendAvailable()) {
      try {
        const filing = await fileBudgetDocs(saved, { year: new Date().getFullYear() });
        if (filing && filing.failed && filing.failed.length) {
          const first = filing.failed[0];
          setNote((prev) => ({
            ...(prev || {}),
            text: `${prev && prev.text ? `${prev.text} ` : ''}⚠️ Fichier non copié dans Budget_labo/…/${first.folder} : ${first.reason}`,
          }));
        }
      } catch { /* le dépôt reste enregistré même si le rangement échoue */ }
    }
    return true;
  };

  return (
    <div className="w-full min-w-0 mx-auto flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs font-bold text-slate-400">
          Dépôt des devis & bons de commande à faire signer — fichiers classés dans
          Budget_labo/{new Date().getFullYear()}/<b>Devis</b> et <b>BC</b> · décision
          réservée au superutilisateur · l’approbation d’un PDF crée une copie
          signée « …_approuvé_signé.pdf » (l’original reste intact).
        </p>
        {!canSeeAllRows && currentName && (
          <p className="text-[11px] leading-snug text-slate-500 bg-white border border-slate-200 rounded-xl px-3 py-2">
            👁 Affichage limité à <b>vos</b> devis &amp; bons de commande (déposés par vous ou demandés à votre nom) —
            les éléments des autres membres ne sont pas listés ici. La gestionnaire et la responsable d’achats voient l’ensemble des lignes.
          </p>
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setModal({ mode: 'new', kind: 'devis' })}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm px-4 py-2 rounded-xl shadow-sm transition-colors flex items-center gap-1.5"
          >
            <span className="text-base leading-none">+</span> Déposer un devis
          </button>
          <button
            type="button"
            onClick={() => setModal({ mode: 'new', kind: 'bc' })}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm px-4 py-2 rounded-xl shadow-sm transition-colors flex items-center gap-1.5"
          >
            <span className="text-base leading-none">+</span> Déposer un BC
          </button>
          <button
            type="button"
            onClick={runApprovalFiling}
            disabled={filingBusy}
            className="bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 font-bold text-sm px-4 py-2 rounded-xl shadow-sm transition-colors flex items-center gap-1.5 disabled:opacity-50"
            title="Copier dans Budget_labo/<année>/Devis|BC les fichiers liés aux devis / BC déjà déposés — l’original n’est jamais déplacé ; possible quand le fichier est accessible à l’application"
          >
            <span className="text-base leading-none">{filingBusy ? '⏳' : '📎'}</span>{filingBusy ? 'Rangement…' : 'Ranger les fichiers'}
          </button>
        </div>
      </div>

      {note && (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50/70 px-4 py-2.5 text-[11px] text-slate-600 leading-relaxed">
          <span>{note.text}</span>
          <span className="flex items-center gap-2 shrink-0">
            {note.mailto ? (
              <a href={note.mailto} className="font-black text-blue-700 underline">✉ Ouvrir ma messagerie</a>
            ) : null}
            {note.consoleUrl ? (
              <a
                href={note.consoleUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-black text-blue-700 underline whitespace-nowrap"
                title="Console Google Cloud — à faire une seule fois par le propriétaire du projet"
              >
                ⚙ Activer l’API Gmail
              </a>
            ) : null}
            <button type="button" onClick={() => setNote(null)} className="text-slate-400 hover:text-slate-600 font-black">✕</button>
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setTab('devis')}
          className={`rounded-2xl border px-4 py-3 text-left shadow-sm transition-colors ${tab === 'devis' ? 'border-blue-300 bg-blue-50' : 'bg-white hover:bg-slate-50 border-slate-200'}`}
        >
          <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Devis à approuver</div>
          <div className="text-xl font-black text-slate-800">{pendingCount('devis')}<span className="text-slate-400 text-xs font-bold"> en attente</span></div>
          <div className="text-[10px] text-slate-400 font-semibold">{devisList.length} déposé{devisList.length > 1 ? 's' : ''} · {decidedCount('devis')} traité{decidedCount('devis') > 1 ? 's' : ''}{gestionCount('devis') ? ` · ${gestionCount('devis')} en gestion` : ''}</div>
        </button>
        <button
          type="button"
          onClick={() => setTab('bc')}
          className={`rounded-2xl border px-4 py-3 text-left shadow-sm transition-colors ${tab === 'bc' ? 'border-indigo-300 bg-indigo-50' : 'bg-white hover:bg-slate-50 border-slate-200'}`}
        >
          <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Bons de commande à approuver</div>
          <div className="text-xl font-black text-slate-800">{pendingCount('bc')}<span className="text-slate-400 text-xs font-bold"> en attente</span></div>
          <div className="text-[10px] text-slate-400 font-semibold">{bcList.length} déposé{bcList.length > 1 ? 's' : ''} · {decidedCount('bc')} traité{decidedCount('bc') > 1 ? 's' : ''}</div>
        </button>
      </div>

      <label
        className="self-start flex items-center gap-1.5 text-[10px] font-black text-slate-500 cursor-pointer select-none bg-white border border-slate-200 rounded-xl px-3 py-2 hover:border-slate-300 whitespace-nowrap"
        title="Par défaut : devis « en attente » / « en gestion », et devis signés dont le BC n’est pas encore signé — un devis ne disparaît qu’à la signature de son BC (suivi alors dans la page Dépenses). Cochez pour réafficher aussi les refusés, non retenus et BC signés."
      >
        <input type="checkbox" className="accent-blue-600" checked={showTreated} onChange={(e) => setShowTreated(e.target.checked)} />
        Afficher les traités
      </label>

      {isSuper ? (
        <SignatureBar
          signature={settings && settings.approvalSignature ? settings.approvalSignature : null}
          onUpdate={setApprovalSignature}
          onRemove={clearApprovalSignature}
        />
      ) : null}

      <SmartTable
        columns={columns}
        rows={activeRows}
        minWidth="1350px"
        quickFilters={['description', 'fournisseur']}
        searchPlaceholder={`Rechercher un ${activeKind === 'bc' ? 'BC' : 'devis'}, un fournisseur, une description…`}
        emptyLabel={activeKind === 'bc' ? 'Aucun bon de commande déposé' : 'Aucun devis déposé'}
        noMatchLabel={`Aucun ${activeKind === 'bc' ? 'BC' : 'devis'} ne correspond aux filtres.`}
      />

      {modal && (
        <DepositModal
          mode={modal.mode}
          kind={modal.kind}
          rec={modal.mode === 'edit' ? modal.rec : null}
          devisOptions={devisOptions}
          productGroups={productGroups}
          fournisseurNames={fournisseurNames}
          budgetLineOptions={budgetLineOptions}
          categorieOptions={categorieOptions}
          recettesList={recettesList}
          demandeurNames={demandeurNames}
          defaultDeposant={currentName}
          onCancel={() => setModal(null)}
          onSave={onSaveDeposit}
        />
      )}
    </div>
  );
};

/* ── Colonnes de la table active (devis ou BC) ──────────────────────────── */
const buildColumns = ({
  kind, isSuper, busyId, devisById,
  canEdit, onDecide, onEdit, onRemove, onSendForSignature, onSendBack,
}) => {
  const statutTone = (r) => {
    if (r && r.statut === APPROVAL_NOT_RETAINED) return 'violet';
    if (r && r.statut === APPROVAL_GESTION) return 'orange';
    const s = approvalStatusOf(r && r.statut);
    if (s === APPROVAL_APPROVED) return 'emerald';
    if (s === APPROVAL_REJECTED) return 'red';
    return 'amber';
  };
  const pendingLabelOf = (r) => {
    if (r && r.statut === APPROVAL_GESTION) return APPROVAL_GESTION;
    /* Un devis généré par un transfert de demande (source connue) et « En
       attente » attend la signature du directeur. */
    if (r && (r.transfert || r.sourceKind || r.sourceId)) return DEVIS_SIGNATURE_PENDING;
    return 'En attente';
  };
  const decisionLabel = (r) => {
    if (r && r.statut === APPROVAL_NOT_RETAINED) return APPROVAL_NOT_RETAINED;
    const s = approvalStatusOf(r && r.statut);
    if (s === APPROVAL_APPROVED) return r && r.kind === 'bc' ? 'BC signé' : 'Signé';
    if (s === APPROVAL_REJECTED) return 'Refusé';
    return pendingLabelOf(r);
  };
  const numLabel = kind === 'bc' ? 'N° BC' : 'N° devis';
  const cols = [
    {
      key: 'decision', label: 'Décision', filter: 'facet', nowrap: true,
      value: (r) => decisionLabel(r),
      display: (r) => {
        const pending = isApprovalPending(r.statut);
        const busy = busyId === r.id;
        const gestion = !!(r && r.statut === APPROVAL_GESTION);
        const complete = devisCompleteOf(r);
        return (
          <div className="flex items-center gap-1.5">
            <Badge tone={statutTone(r)}>{decisionLabel(r)}</Badge>
            {isSuper && pending && !gestion && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onDecide(r, APPROVAL_APPROVED)}
                  title={kind === 'devis'
                    ? 'Signer le devis (la dépense ne sera créée qu’à la signature du BC lié)'
                    : 'Signer le bon de commande (crée la dépense « BC signé »)'}
                  className="w-7 h-7 rounded-lg border border-emerald-200 text-emerald-600 hover:bg-emerald-50 text-xs font-black disabled:opacity-40"
                >{busy ? '…' : '✓'}</button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onDecide(r, APPROVAL_REJECTED)}
                  title="Refuser"
                  className="w-7 h-7 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 text-xs font-black disabled:opacity-40"
                >✗</button>
                {kind === 'devis' ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onSendBack(r)}
                    title="Renvoyer à la responsable d'achats si le devis ne convient pas encore (il repart « En gestion » — elle en est prévenue par e-mail)"
                    className="w-7 h-7 rounded-lg border border-amber-200 text-amber-600 hover:bg-amber-50 text-xs font-black disabled:opacity-40"
                  >↩</button>
                ) : null}
              </>
            )}
            {gestion && kind === 'devis' && (canEdit(r) || isSuper) && complete ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => onSendForSignature(r)}
                title="Devis complété (N° devis + fichier présents) — l'envoyer pour signature : il passera « En attente de signature »"
                className="w-8 h-7 rounded-lg border border-cyan-200 bg-cyan-50 text-cyan-700 hover:bg-cyan-100 text-[11px] font-black disabled:opacity-40 whitespace-nowrap px-1"
              >✉️ Envoyer pour signature</button>
            ) : gestion && kind === 'devis' ? (
              <span className="text-[10px] text-orange-500 font-bold whitespace-nowrap" title="À compléter : fournisseur, N° devis et fichier avant l'envoi pour signature">🔧 à compléter</span>
            ) : null}
          </div>
        );
      },
    },
    {
      key: 'num', label: numLabel, filter: 'text',
      value: (r) => (kind === 'bc' ? txt(r.numBC) : txt(r.numDevis)),
      display: (r) => {
        const v = kind === 'bc' ? txt(r.numBC) : txt(r.numDevis);
        return v ? <span className="font-mono text-[11px] font-bold text-slate-700">{v}</span> : <span className="text-slate-300">—</span>;
      },
    },
    {
      key: 'description', label: 'Dépense / objet', filter: 'text',
      value: (r) => txt(r.description),
      display: (r) => (
        <div className="min-w-[200px] max-w-[320px]">
          <div className="font-bold text-slate-800 leading-snug line-clamp-2" title={txt(r.description) || 'Sans description'}>{txt(r.description) || <span className="text-slate-300">—</span>}</div>
          {txt(r.notes) && <div className="text-[10px] text-slate-400 mt-0.5 truncate max-w-[280px]" title={r.notes}>{r.notes}</div>}
          {kind === 'devis' && r._produitCount > 1 && (
            <div className="text-[9px] font-bold text-violet-500 mt-0.5">
              {r._produitCount} devis pour ce produit
              {r._produitApprovedId
                ? (r._produitApprovedId === r.id ? ' · retenu ✓' : ' · un autre devis a été retenu')
                : ' · aucun devis retenu'}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'fournisseur', label: 'Fournisseur', filter: 'facet',
      value: (r) => txt(r.fournisseur),
      display: (r) => (txt(r.fournisseur) ? <span className="whitespace-nowrap text-xs font-semibold text-slate-600">{r.fournisseur}</span> : <span className="text-slate-300">—</span>),
    },
    {
      key: 'montant', label: 'Montant HT + port', numeric: true, align: 'right', nowrap: true,
      value: (r) => {
        const total = numOf(r.montant) === null
          ? numOf(r.fraisPort)
          : numOf(r.montant) + (numOf(r.fraisPort) || 0);
        return total === null ? '' : total;
      },
      display: (r) => {
        const n = numOf(r.montant);
        const fp = numOf(r.fraisPort);
        if (n === null && fp === null) return <span className="text-slate-300">—</span>;
        return (
          <div className="whitespace-nowrap">
            {n !== null && <div className="text-xs font-black text-slate-700 tabular-nums">{euro.format(n)}</div>}
            {fp !== null && (
              <div className="text-[9px] font-semibold text-slate-400 tabular-nums">
                {euro.format(fp)} de port
              </div>
            )}
          </div>
        );
      },
    },
  ];

  if (kind === 'bc') {
    cols.push({
      key: 'devisLie', label: 'Devis lié', filter: 'text',
      value: (r) => {
        const d = r && r.devisId ? devisById.get(r.devisId) : null;
        return txt(d && (d.numDevis || d.description));
      },
      display: (r) => {
        const d = r && r.devisId ? devisById.get(r.devisId) : null;
        if (!d) return <span className="text-slate-300">—</span>;
        const label = txt(d.numDevis) || txt(d.description) || 'devis';
        return (
          <span className="text-[11px] font-semibold text-indigo-700">
            {label}
            {d.statut === APPROVAL_APPROVED
              ? <span className="text-emerald-600 ml-1" title="Devis approuvé">✓</span>
              : d.statut === APPROVAL_NOT_RETAINED
                ? <span className="text-violet-500 ml-1" title="Devis non retenu">∅</span>
                : approvalStatusOf(d.statut) === APPROVAL_REJECTED
                  ? <span className="text-red-500 ml-1" title="Devis refusé">✗</span>
                  : <span className="text-amber-600 ml-1" title="Devis pas encore approuvé">⏳</span>}
          </span>
        );
      },
    });
  }

    cols.push(
    {
      key: 'fichier', label: 'Fichier (Budget_labo)', filter: 'text',
      value: (r) => `${txt(r.fichierNom)} ${txt(r.fichierUrl)}`,
      display: (r) => {
        const u = txt(r.fichierUrl);
        if (!u) return <span className="text-slate-300">—</span>;
        return (
          <a
            href={u} target="_blank" rel="noreferrer" title={u}
            className="inline-flex items-center gap-1 max-w-[220px] text-[11px] font-semibold text-blue-700 hover:text-blue-900 underline decoration-blue-300 underline-offset-2 truncate"
          >
            <span className="truncate">{txt(r.fichierNom) || 'document'}</span>
            <span className="shrink-0">↗</span>
          </a>
        );
      },
    },
    {
      key: 'deposant', label: 'Déposé par', filter: 'facet',
      value: (r) => txt(r.deposant),
      display: (r) => (
        <div className="whitespace-nowrap text-xs text-slate-600">
          <div className="font-semibold">{txt(r.deposant) || '—'}</div>
          {r.createdAt ? <div className="text-[9px] text-slate-400 font-semibold">le {toFrDate(isoOf(new Date(r.createdAt).toISOString()))}</div> : null}
        </div>
      ),
    },
    {
      key: 'decide', label: 'Traitée par', filter: 'none',
      value: (r) => (txt(r.decidedBy) ? `${r.decidedBy} ${r.decidedAt || ''}` : ''),
      display: (r) => {
        if (!txt(r.decidedBy)) return <span className="text-slate-300">—</span>;
        return (
          <span className="whitespace-nowrap text-[10px] font-semibold text-slate-500">
            {r.decidedBy}
            {r.decidedAt ? <span className="text-slate-400"> · {toFrDate(isoOf(new Date(r.decidedAt).toISOString()))}</span> : null}
          </span>
        );
      },
    },
    {
      key: 'actions', label: '', sortable: false, filterable: false, align: 'right', nowrap: true,
      value: () => '',
      display: (r) => {
        const editable = canEdit(r);
        const deletable = isSuper;
        if (!editable && !deletable) return <span className="text-slate-300 text-xs">—</span>;
        return (
          <div className="flex items-center gap-1 justify-end">
            {editable && (
              <button
                type="button"
                onClick={() => onEdit(r)} title={isSuper ? 'Modifier' : 'Modifier ma ligne (tant qu’elle est en attente)'}
                className="w-7 h-7 rounded-lg border border-slate-200 text-slate-400 hover:bg-blue-50 hover:text-blue-600 text-xs"
              >✎</button>
            )}
            {deletable && (
              <button
                type="button"
                onClick={() => onRemove(r)} title="Supprimer (réservé au superutilisateur)"
                className="w-7 h-7 rounded-lg border border-slate-200 text-slate-400 hover:bg-red-50 hover:text-red-600 text-xs"
              >🗑</button>
            )}
          </div>
        );
      },
    }
  );
  return cols;
};

/* ═════════════════════════════════════════════════════════════════════════
   Bandeau « Signature d'approbation » (superutilisateur) — dépôt, remplacement
   ou retrait de l'image apposée automatiquement en bas des PDF approuvés.
   ═════════════════════════════════════════════════════════════════════════ */
const SignatureBar = ({ signature, onUpdate, onRemove }) => {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const readAsDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Fichier illisible.'));
    reader.readAsDataURL(file);
  });
  const pick = async (file) => {
    if (!file) return;
    setMsg('');
    const mimeOk = /^image\/(png|jpe?g)$/i.test(String(file.type || ''));
    const extOk = /\.(png|jpe?g)$/i.test(String(file.name || ''));
    if (!mimeOk && !extOk) {
      setMsg('⚠️ Choisissez un fichier image PNG ou JPEG (fond transparent recommandé).');
      return;
    }
    setBusy(true);
    try {
      const raw = await readAsDataUrl(file);
      const sized = await downscaleImageDataUrl(raw);
      onUpdate({
        name: String(file.name || 'signature').slice(0, 120),
        dataUrl: sized.dataUrl,
        mime: 'image/png',
        width: sized.width || 0,
        height: sized.height || 0,
        updatedAt: Date.now(),
      });
      setMsg(`✓ Signature enregistrée${sized.width && sized.height ? ` (${sized.width} × ${sized.height} px)` : ''} — elle sera apposée automatiquement en bas des PDF approuvés.`);
    } catch (err) {
      setMsg(`⚠️ ${(err && err.message) || 'erreur'}`);
    } finally {
      setBusy(false);
    }
  };
  const remove = () => {
    if (window.confirm('Retirer l’image de signature ? Les prochains devis / BC approuvés ne seront plus signés.')) {
      onRemove();
      setMsg('');
    }
  };
  const hasSig = !!(signature && txt(signature.dataUrl));
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span className="text-[11px] font-black uppercase tracking-wide text-slate-400">
        ✍️ Signature d’approbation
      </span>
      {hasSig ? (
        <>
          <img
            src={signature.dataUrl}
            alt="Aperçu de la signature"
            title={txt(signature.name) || 'Signature'}
            className="h-9 w-auto max-w-[150px] object-contain bg-slate-50 border border-slate-200 rounded-md p-1"
          />
          <span className="text-[10px] text-slate-400 max-w-[180px] truncate">
            {txt(signature.name) || 'signature'}
          </span>
        </>
      ) : (
        <span className="text-[11px] font-bold text-amber-600">Aucune signature — les PDF ne seront pas signés.</span>
      )}
      <input
        ref={fileRef}
        type="file"
        className="hidden"
        accept=".png,.jpg,.jpeg,image/png,image/jpeg"
        onChange={(ev) => {
          const f = ev.target.files && ev.target.files[0];
          if (ev.target) ev.target.value = '';
          if (f) pick(f);
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => { if (fileRef.current) fileRef.current.click(); }}
        className="text-[11px] font-black px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200 disabled:opacity-50"
      >
        {busy ? '⏳ Traitement…' : (hasSig ? '⬆ Changer' : '⬆ Choisir l’image')}
      </button>
      {hasSig ? (
        <button type="button" onClick={remove} className="text-[11px] font-black px-2 py-1.5 rounded-lg text-red-500 hover:bg-red-50">
          🗑 Retirer
        </button>
      ) : null}
      <span className="text-[10px] text-slate-400 leading-snug flex-1 min-w-[220px]">
        Image apposée en bas de la <b>dernière page</b> des PDF des devis & BC approuvés : une copie
        « …_approuvé_signé.pdf » est créée dans Budget_labo/{new Date().getFullYear()}/Devis|BC (l’original reste intact).
      </span>
      {msg ? <span className="text-[11px] font-semibold text-slate-500 basis-full">{msg}</span> : null}
    </div>
  );
};

/* ═════════════════════════════════════════════════════════════════════════
   Fenêtre de dépôt / édition d'un devis ou d'un BC
   ═════════════════════════════════════════════════════════════════════════ */
const MODAL_INPUT = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500';
const MODAL_LABEL = 'block text-[10px] font-black uppercase text-slate-400 tracking-wide mb-1';

const DepositModal = ({
  mode, kind, rec, devisOptions, productGroups = [], fournisseurNames = [], budgetLineOptions = [],
  categorieOptions = [], recettesList = [],
  demandeurNames = [], defaultDeposant, onCancel, onSave,
}) => {
  const editing = mode === 'edit' && !!rec;
  const isDevis = kind === 'devis';
  const year = new Date().getFullYear();
  /* Informations reprises du devis lié quand le BC (ou l’édition d’un dépôt
     historique) n’a pas encore ses propres valeurs : objet, fournisseur,
     montant HT, frais de port, catégorie, N° SIFAC/D.A., ligne budgétaire et
     demandeur — le BC se rattachant au même devis reprend ses informations
     (modifiables ensuite dans le formulaire). */
  const linkedDevisOf = (devisId) => {
    const id = txt(devisId);
    if (!id) return null;
    return (Array.isArray(devisOptions) ? devisOptions : []).find((d) => d.id === id) || null;
  };
  const moneyInputOf = (v) => (v === null || v === undefined || v === '' ? '' : String(v).replace('.', ','));
  const devisDefaultsOf = (devisId) => {
    const dev = linkedDevisOf(devisId);
    return {
      description: dev ? txt(dev.description) : '',
      fournisseur: dev ? txt(dev.fournisseur) : '',
      ligneBudgetaire: dev ? txt(dev.ligneBudgetaire) : '',
      categorie: dev ? txt(dev.categorie) : '',
      numSIFAC: dev ? txt(dev.numSIFAC) : '',
      recetteId: dev ? txt(dev.recetteId) : '',
      demandeur: dev ? txt(dev.demandeur) : '',
      montant: dev ? moneyInputOf(dev.montant) : '',
      fraisPort: dev ? moneyInputOf(dev.fraisPort) : '',
    };
  };
  const [draft, setDraft] = useState(() => {
    const linkedDefaults = rec && rec.kind === 'bc'
      ? devisDefaultsOf(rec.devisId)
      : {};
    const firstDevisDefaults = isDevis
      ? null
      : devisDefaultsOf(defaultLinkedDevisId(devisOptions));
    if (rec) {
      return {
        kind: rec.kind || kind,
        description: txt(rec.description)
          || (rec.kind === 'bc' ? linkedDefaults.description : ''),
        fournisseur: txt(rec.fournisseur)
          || (rec.kind === 'bc' ? linkedDefaults.fournisseur : ''),
        ligneBudgetaire: txt(rec.ligneBudgetaire)
          || (rec.kind === 'bc' ? linkedDefaults.ligneBudgetaire : ''),
        categorie: txt(rec.categorie)
          || (rec.kind === 'bc' ? linkedDefaults.categorie : ''),
        numSIFAC: txt(rec.numSIFAC)
          || (rec.kind === 'bc' ? linkedDefaults.numSIFAC : ''),
        recetteId: txt(rec.recetteId)
          || (rec.kind === 'bc' ? linkedDefaults.recetteId : ''),
        demandeur: txt(rec.demandeur)
          || (rec.kind === 'bc' ? linkedDefaults.demandeur : '')
          || txt(rec.deposant)
          || txt(defaultDeposant),
        numDevis: txt(rec.numDevis),
        numBC: txt(rec.numBC),
        devisId: txt(rec.devisId),
        groupeAchatId: txt(rec.groupeAchatId),
        montant: rec.montant === null || rec.montant === undefined || rec.montant === ''
          ? (rec.kind === 'bc' ? linkedDefaults.montant : '')
          : moneyInputOf(rec.montant),
        fraisPort: rec.fraisPort === null || rec.fraisPort === undefined || rec.fraisPort === ''
          ? (rec.kind === 'bc' ? linkedDefaults.fraisPort : '')
          : moneyInputOf(rec.fraisPort),
        fichierNom: txt(rec.fichierNom),
        fichierUrl: txt(rec.fichierUrl),
        fichierMime: txt(rec.fichierMime),
        notes: txt(rec.notes),
        deposant: txt(rec.deposant),
        statut: txt(rec.statut),
        dateDepot: txt(rec.dateDepot),
      };
    }
    return {
      kind,
      description: isDevis ? '' : (firstDevisDefaults ? firstDevisDefaults.description : ''),
      fournisseur: isDevis ? '' : (firstDevisDefaults ? firstDevisDefaults.fournisseur : ''),
      ligneBudgetaire: isDevis ? '' : (firstDevisDefaults ? firstDevisDefaults.ligneBudgetaire : ''),
      categorie: isDevis ? '' : (firstDevisDefaults ? firstDevisDefaults.categorie : ''),
      numSIFAC: isDevis ? '' : (firstDevisDefaults ? firstDevisDefaults.numSIFAC : ''),
      recetteId: isDevis ? '' : (firstDevisDefaults ? firstDevisDefaults.recetteId : ''),
      demandeur: (isDevis ? '' : (firstDevisDefaults ? firstDevisDefaults.demandeur : ''))
        || txt(defaultDeposant),
      numDevis: isDevis ? '' : '',
      numBC: isDevis ? '' : '',
      devisId: isDevis ? '' : defaultLinkedDevisId(devisOptions),
      groupeAchatId: '',
      montant: isDevis ? '' : (firstDevisDefaults ? firstDevisDefaults.montant : ''),
      fraisPort: isDevis ? '' : (firstDevisDefaults ? firstDevisDefaults.fraisPort : ''),
      fichierNom: '',
      fichierUrl: '',
      fichierMime: '',
      notes: '',
      deposant: txt(defaultDeposant),
      statut: APPROVAL_PENDING,
      dateDepot: todayIso(),
    };
  });

  /* Menu Fournisseur : la liste de la Librairie (+ la valeur déjà enregistrée
     si elle n’y figure plus, pour pouvoir modifier une ligne historique). */
  const supplierOptions = useMemo(() => {
    const opts = (Array.isArray(fournisseurNames) ? fournisseurNames : [])
      .map((n) => txt(n)).filter(Boolean);
    const current = txt(draft.fournisseur);
    if (current && !opts.includes(current)) opts.push(current);
    return opts;
  }, [fournisseurNames, draft.fournisseur]);

  const set = (k) => (ev) => setDraft((d) => ({ ...d, [k]: ev.target.value }));
  /* Changement du devis lié (BC) : on reprend de ce devis l'objet, le
     fournisseur, le montant HT, les frais de port, la catégorie, le N°
     SIFAC/D.A., la ligne budgétaire et le demandeur (modifiables ensuite). */
  const pickDevis = (ev) => {
    const id = ev.target.value;
    setDraft((d) => {
      if (!id) return { ...d, devisId: '' };
      const def = devisDefaultsOf(id);
      return {
        ...d,
        devisId: id,
        description: def.description,
        fournisseur: def.fournisseur,
        ligneBudgetaire: def.ligneBudgetaire || d.ligneBudgetaire,
        categorie: def.categorie || d.categorie,
        numSIFAC: def.numSIFAC || d.numSIFAC,
        recetteId: def.recetteId || d.recetteId,
        demandeur: def.demandeur || d.demandeur,
        montant: def.montant,
        fraisPort: def.fraisPort,
      };
    });
  };
  /* Catégorie choisie : la ligne déjà saisie est conservée si une fiche
     Recettes homonyme du bon type existe (recetteId basculé sur celle-ci),
     pour ne jamais relier à une fiche de l'autre type. */
  const setCategorie = (ev) => {
    const cat = ev.target.value;
    setDraft((d) => {
      let recetteId = d.recetteId;
      const label = txt(d.ligneBudgetaire);
      if (cat && label) {
        const found = findRecetteByLabel(recettesList, label, cat)
          || findRecetteByLabel(recettesList, label, '');
        recetteId = found ? found.id : '';
      }
      return { ...d, categorie: cat, recetteId };
    });
  };
  /* Saisie de la ligne budgétaire : dès qu'un intitulé correspond à une fiche
     Recettes du type choisi, la liaison (recetteId) est posée. */
  const setBudgetLine = (ev) => {
    const label = ev.target.value;
    setDraft((d) => {
      const want = txt(d.categorie);
      const found = findRecetteByLabel(recettesList, label, want)
        || (want ? null : findRecetteByLabel(recettesList, label, ''));
      return {
        ...d,
        ligneBudgetaire: label,
        recetteId: found ? found.id : txt(d.recetteId),
        categorie: txt(d.categorie) || (found ? txt(found.type) : txt(d.categorie)),
      };
    });
  };
  /* Changement du produit (devis candidats d'un même achat) : en rejoignant
     un produit déjà déposé, on reprend l'objet, le demandeur et la ligne
     budgétaire du devis le plus récent du groupe (modifiables ensuite). */
  const pickProduct = (ev) => {
    const id = ev.target.value;
    setDraft((d) => {
      const p = (Array.isArray(productGroups) ? productGroups : []).find((x) => x.id === id);
      const src = p && p.latest;
      return {
        ...d,
        groupeAchatId: id,
        description: id
          ? txt(src && (src.description || src.numDevis)) || d.description
          : d.description,
        ligneBudgetaire: src ? txt(src.ligneBudgetaire) || d.ligneBudgetaire : d.ligneBudgetaire,
        categorie: src ? txt(src.categorie) || d.categorie : d.categorie,
        numSIFAC: src ? txt(src.numSIFAC) || d.numSIFAC : d.numSIFAC,
        recetteId: src ? txt(src.recetteId) || d.recetteId : d.recetteId,
        demandeur: src ? txt(src.demandeur) || d.demandeur : d.demandeur,
      };
    });
  };
  const fileInputRef = useRef(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');
  const [savingBusy, setSavingBusy] = useState(false);

  const pickFile = async (file) => {
    if (!file) return;
    setUploadMsg('');
    if (!cloudBackendAvailable()) {
      setUploadMsg('⚠️ Google Drive n’est pas connecté — collez le lien du fichier dans le champ « Lien » ci-dessous.');
      return;
    }
    setUploadBusy(true);
    try {
      /* Nom Drive : convention du laboratoire (date = date de dépôt). Quand on
         dépose sur une ligne déjà approuvée, la marque « _approuvé » est
         ajoutée immédiatement au nom. */
      const convBase = depositDocDriveNameOf({
        kind,
        numDevis: txt(draft.numDevis),
        numBC: txt(draft.numBC),
        ligneBudgetaire: txt(draft.ligneBudgetaire),
        fournisseur: txt(draft.fournisseur),
        demandeur: txt(draft.demandeur),
        description: txt(draft.description),
        date: txt(draft.dateDepot) || todayIso(),
        fichierNom: file.name,
      });
      const originalName = (String(file.name || '').trim() || 'document').slice(0, 180);
      const targetName = convBase || originalName;
      const driveName = draft.statut === APPROVAL_APPROVED && !hasApprovedSuffix(targetName)
        ? withApprovedSuffix(targetName)
        : targetName;
      const drive = await uploadLocalFile({
        name: driveName,
        mimeType: file.type || 'application/octet-stream',
        file,
        path: budgetLaboPath(kind),
      });
      if (drive && drive.driveUrl) {
        setDraft((d) => ({
          ...d,
          fichierNom: String(drive.name || file.name || driveName),
          fichierUrl: drive.driveUrl,
          fichierMime: file.type || '',
        }));
        setUploadMsg(`✓ Téléversé dans Budget_labo/${year}/${isDevis ? 'Devis' : 'BC'} — dossier créé si besoin.`);
      } else {
        setUploadMsg('⚠️ Téléversement impossible (Drive non connecté ?). Collez le lien du fichier ci-dessous.');
      }
    } catch (err) {
      console.error(err);
      setUploadMsg(`⚠️ Téléversement impossible : ${(err && err.message) || err}`);
    } finally {
      setUploadBusy(false);
    }
  };

  const handleSave = async () => {
    if (savingBusy) return;
    setSavingBusy(true);
    try {
      const ok = await onSave(draft, rec ? rec.id : null);
      if (ok) onCancel();          // enregistrement réussi → ferme la fenêtre
      else setSavingBusy(false);   // validation refusée → le formulaire reste ouvert
    } catch (err) {
      console.error(err);
      setSavingBusy(false);
    }
  };

    return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(3px)' }}>
      <div className="bg-slate-50 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden max-h-[96vh] flex flex-col">
        <div className="px-5 py-3.5 bg-gradient-to-br from-blue-600 to-indigo-700 text-white shrink-0">
          <h2 className="text-lg font-black">
            {editing ? `Modifier le ${isDevis ? 'devis' : 'bon de commande (BC)'}` : `Déposer un ${isDevis ? 'devis' : 'bon de commande (BC)'}`}
          </h2>
          <p className="text-blue-100 text-[11px]">
            Fichier téléversé dans Budget_labo/{year}/{isDevis ? 'Devis' : 'BC'} ·{' '}
            {isDevis ? 'l’approbation valide le devis — la dépense n’est créée qu’à la signature du BC lié' : 'l’approbation crée la dépense « BC signé » (catégorie, ligne budgétaire et N° SIFAC/D.A. repris du formulaire)'}.
          </p>
        </div>

        <div className="p-4 overflow-y-auto custom-scrollbar flex flex-col gap-3">
          {!isDevis && (
            <div>
              <label className={MODAL_LABEL}>Devis lié (obligatoire — déposez d’abord le devis)</label>
              <select
                className={MODAL_INPUT}
                value={draft.devisId || ''}
                onChange={pickDevis}
                disabled={!devisOptions.length}
              >
                {devisOptions.length ? (
                  rankedBcDevisOptions(devisOptions).map((d) => (
                    <option key={d.id} value={d.id}>
                      {txt(d.numDevis) || txt(d.description) || d.id} — {approvalStatusShort(d)}
                    </option>
                  ))
                ) : (
                  <option value="">Aucun devis disponible — créez d’abord un devis</option>
                )}
              </select>
              <p className="mt-1.5 text-[10px] leading-snug text-indigo-500">
                Le choix du devis lié pré-remplit automatiquement l’objet, le fournisseur, le montant HT,
                les frais de port, la catégorie, le N° SIFAC/D.A., la ligne budgétaire et le demandeur à
                partir de ce devis — ces champs restent modifiables. Il ne reste qu’à saisir le N° BC et
                joindre le fichier.
              </p>
            </div>
          )}

          <div>
            <label className={MODAL_LABEL}>Dépense / objet *</label>
            <input
              className={MODAL_INPUT}
              value={draft.description}
              onChange={set('description')}
              placeholder={isDevis ? 'ex. Microscope, réactifs, prestation…' : 'ex. BC de la commande microscope (même objet que le devis)'}
            />
          </div>

          {isDevis && (
            <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-3">
              <label className={MODAL_LABEL}>
                Produit / achat concerné — devis concurrents
              </label>
              <select
                className={MODAL_INPUT}
                value={draft.groupeAchatId || ''}
                onChange={pickProduct}
              >
                <option value="">
                  ➕ Nouvel achat — je décris l'objet ci-dessus
                </option>
                {productGroups.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}{p.count > 1 ? ` (${p.count} devis)` : ''}{p.approvedId ? ' — retenu ✓' : ''}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-[10px] leading-snug text-violet-500">
                Déposez plusieurs devis d'un même achat : en choisissant un produit déjà déposé, ce devis
                devient un candidat supplémentaire. À l'approbation, un seul devis est retenu (la dépense
                sera créée « BC signé » à la signature de son bon de commande) et les autres passent
                automatiquement « Non retenu ».
                Astuce : saisir exactement le même objet qu'un produit existant rattache aussi le devis.
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className={MODAL_LABEL}>{isDevis ? 'N° devis *' : 'N° BC *'}</label>
              <input
                className={MODAL_INPUT}
                value={isDevis ? draft.numDevis : draft.numBC}
                onChange={(ev) => setDraft((d) => ({ ...d, [isDevis ? 'numDevis' : 'numBC']: ev.target.value }))}
                placeholder={isDevis ? 'ex. 2026-0041' : 'ex. R20260215'}
              />
            </div>
            <div>
              <label className={MODAL_LABEL}>Fournisseur *</label>
              <select
                className={MODAL_INPUT}
                value={draft.fournisseur || ''}
                onChange={set('fournisseur')}
              >
                <option value="">— Choisir un fournisseur —</option>
                {supplierOptions.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
              {!supplierOptions.length && (
                <p className="mt-1 text-[10px] leading-snug text-slate-400">
                  Catalogue vide : ajoutez d’abord le fournisseur dans la page Librairie.
                </p>
              )}
            </div>
            <div>
              <label className={MODAL_LABEL}>Montant HT *</label>
              <input
                className={MODAL_INPUT}
                value={draft.montant}
                onChange={set('montant')}
                placeholder="ex. 1 234,56"
                inputMode="decimal"
              />
            </div>
            <div>
              <label className={MODAL_LABEL}>Frais de port (€)</label>
              <input
                className={MODAL_INPUT}
                value={draft.fraisPort}
                onChange={set('fraisPort')}
                placeholder="ex. 8,50 — vide si 0"
                inputMode="decimal"
              />
            </div>
            <div>
              <label className={MODAL_LABEL}>Demandeur</label>
              <input
                className={MODAL_INPUT}
                value={draft.demandeur || ''}
                onChange={set('demandeur')}
                list="depot-demandeurs"
                placeholder="Nom de la personne — ou « Service » pour un achat du Service"
              />
              <datalist id="depot-demandeurs">
                {(demandeurNames || []).map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </div>
            <div>
              <label className={MODAL_LABEL}>Ligne budgétaire{isDevis ? '' : ' *'}</label>
              <input
                className={MODAL_INPUT}
                value={draft.ligneBudgetaire || ''}
                onChange={setBudgetLine}
                list="depot-lignes-budgetaires"
                placeholder="ex. S2R01GEC (INTRUDE)"
              />
              <datalist id="depot-lignes-budgetaires">
                {(budgetLineOptions || []).map((ln) => (
                  <option key={ln} value={ln} />
                ))}
              </datalist>
            </div>
            <div>
              <label className={MODAL_LABEL}>Catégorie{isDevis ? '' : ' *'}</label>
              <select className={MODAL_INPUT} value={draft.categorie || ''} onChange={setCategorie}>
                <option value="">— non précisée —</option>
                {(categorieOptions || []).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              {!isDevis && (
                <p className="mt-1 text-[10px] leading-snug text-slate-400">
                  Fonctionnement / Investissement — la dépense « BC signé » sera imputée sur une ligne de ce type.
                </p>
              )}
            </div>
            <div>
              <label className={MODAL_LABEL}>N° SIFAC/D.A.{isDevis ? '' : ' *'}</label>
              <input
                className={MODAL_INPUT}
                value={draft.numSIFAC || ''}
                onChange={set('numSIFAC')}
                placeholder="ex. 2026000000"
              />
              {!isDevis && (
                <p className="mt-1 text-[10px] leading-snug text-slate-400">
                  Transmis à la dépense lors de la signature du BC. Obligatoire au dépôt d’un nouveau BC.
                </p>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <label className={MODAL_LABEL}>
              Fichier * — classé dans Budget_labo/{year}/{isDevis ? 'Devis' : 'BC'} — renommé
              automatiquement « {isDevis ? 'Devis' : 'BC'}_N°_ligne_fournisseur_demandeur_date_description »
              (l’objet du {isDevis ? 'devis' : 'BC'} est ajouté après un « _ » à la fin du nom pour reconnaître le
              document ; « _approuvé » est ajouté une fois le {isDevis ? 'devis' : 'BC'} approuvé — l’approbation d’un
              PDF crée en plus une copie signée « …_approuvé_signé.pdf », l’original reste intact)
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
                {uploadBusy ? '⏳ Téléversement…' : '⬆ Choisir un fichier'}
              </button>
              <input
                className={`${MODAL_INPUT} flex-1 min-w-[180px] font-mono text-xs text-blue-700`}
                value={draft.fichierUrl}
                onChange={set('fichierUrl')}
                placeholder="🔗 … ou collez le lien Google Drive du fichier"
              />
            </div>
            {txt(draft.fichierUrl) && (
              <p className="mt-1.5 text-[11px] text-slate-500 flex items-center gap-1.5 flex-wrap">
                📎 {txt(draft.fichierNom) || 'document'} :
                <a href={draft.fichierUrl} target="_blank" rel="noreferrer" className="text-blue-700 underline decoration-blue-300 underline-offset-2 truncate max-w-[280px]">{draft.fichierUrl}</a>
              </p>
            )}
            {uploadMsg && <p className="mt-1.5 text-[11px] leading-snug text-slate-500">{uploadMsg}</p>}
          </div>

          <div>
            <label className={MODAL_LABEL}>Notes</label>
            <textarea
              className={`${MODAL_INPUT} min-h-[54px]`}
              value={draft.notes}
              onChange={set('notes')}
              placeholder="Éventuelles précisions pour le superutilisateur…"
            />
          </div>

          <div>
            <label className={MODAL_LABEL}>Déposé par</label>
            <input className={MODAL_INPUT} value={draft.deposant} onChange={set('deposant')} placeholder="Nom du déposant" />
          </div>

          <p className="text-[10px] text-slate-400 leading-relaxed">
            Le dépôt envoie automatiquement un e-mail « Nouveau devis / BC à approuver » au superutilisateur ; l’approbation
            envoie « Devis / BC approuvé » au(x) gestionnaire(s). Ces e-mails partent du compte Google connecté (adresse de la
            fiche Personnel). Les fichiers restent dans le dossier du dataset › Budget_labo/&lt;année&gt;.
          </p>
        </div>

        <div className="px-4 py-3 border-t border-slate-200 flex justify-end gap-2 bg-slate-50 shrink-0">
          <button
            type="button" onClick={onCancel}
            className="px-4 py-2 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-200 bg-slate-100"
          >Annuler</button>
          <button
            type="button" onClick={handleSave} disabled={savingBusy}
            className="px-5 py-2 rounded-xl text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-wait"
          >{savingBusy ? 'Enregistrement…' : (editing ? 'Enregistrer les modifications' : 'Déposer & notifier le superutilisateur')}</button>
        </div>
      </div>
    </div>
  );
};








