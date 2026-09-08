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
         – approuver un DEVIS crée (ou met à jour) la dépense liée avec le
           statut « Devis en cours », le lien du fichier dans numDevisUrl et la
           date de signature du devis (dateSignatureDevis = jour de l'approbation) ;
         – approuver un BC rattaché à un devis approuvé fait passer cette
           même dépense à « BC signé » (n° BC, lien numBCUrl et date de
           signature du BC, dateSignature, = jour de l'approbation) ;
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
import React, { useMemo, useRef, useState } from 'react';
import { useAdmin } from './AdminContext';
import { SmartTable } from './smartTable';
import { toFrDate } from './congesDates';
import {
  APPROVAL_PENDING, APPROVAL_APPROVED, APPROVAL_REJECTED, APPROVAL_NOT_RETAINED,
  isApprovalPending, approvalStatusOf,
} from './adminSchema';
import { uploadLocalFile, cloudBackendAvailable, renameDriveFile } from '../utils/driveUpload';
import {
  fileBudgetDocs,
  driveFileIdFromUrl,
  budgetDocFileName,
  hasApprovedSuffix,
  withApprovedSuffix,
} from './driveFiling';
import {
  sendAdminMail, personEmailOf, personnelEmailsMatching, superuserEmailsOf,
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
     Devis_<N° devis>_<ligne budgétaire>_<fournisseur>_<demandeur>_<date>
     BC_<N° BC>_<ligne budgétaire>_<fournisseur>_<demandeur>_<date>
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
    data, access, upsert, remove, currentUser, operators,
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

  const isSuper = !!access.isSuperuser;
  const currentName = txt(access.profile && access.profile.person
    ? access.profile.person.nom
    : (currentUser && currentUser.name));

  const [tab, setTab] = useState('devis'); // 'devis' | 'bc'
  const [modal, setModal] = useState(null); // null | { mode:'new', kind } | { mode:'edit', kind, rec }
  const [busyId, setBusyId] = useState(null); // id de la ligne en cours de décision
  const [note, setNote] = useState(null); // { text, mailto? } — résultat du dernier e-mail
  const [filingBusy, setFilingBusy] = useState(false); // rangement « à la demande » des fichiers

  const devisList = useMemo(() => rows
    .filter((r) => r && r.kind === 'devis')
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)), [rows]);
  const bcList = useMemo(() => rows
    .filter((r) => r && r.kind === 'bc')
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)), [rows]);
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
    const recs = (Array.isArray(rows) ? rows : []).filter((r) => r && r.id);
    if (!recs.length) return;
    let copied = 0; let already = 0; let failed = 0;
    const reasons = [];
    setFilingBusy(true);
    try {
      for (const rec of recs) {
        const res = await fileBudgetDocs(rec, { year: new Date().getFullYear() });
        if (!res) continue;
        copied += res.copied || 0;
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
    if (copied === 0 && already === 0 && failed === 0) {
      setNote({ text: 'Aucun fichier lié à ranger : déposez un devis / BC avec un fichier (choix PC ou lien Drive).' });
      return;
    }
    const year = new Date().getFullYear();
    const detail = failed
      ? ` — ${reasons.slice(0, 10).join(' · ')}${reasons.length > 10 ? ` · … et ${reasons.length - 10} autre(s)` : ''}`
      : '';
    setNote({
      text: `Rangement des fichiers : ${copied} copie${copied > 1 ? 's' : ''} créée${copied > 1 ? 's' : ''} dans Budget_labo/${year}/Devis|BC (l’original reste en place) · `
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
    const res = await sendAdminMail({
      to: superuserEmails,
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
          ? 'La dépense « Devis en cours » correspondante a été créée (ou mise à jour) automatiquement — date de signature du devis : aujourd’hui.'
          : 'La dépense liée passe à « BC signé » — date de signature du BC : aujourd’hui.')
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
      `Devis retenu : ${retained} — la dépense « Devis en cours » correspondante a été créée.`,
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
        /* Approbation du devis → dépense « Devis en cours » (créée ou mise à jour).
           La date de signature du devis est renseignée automatiquement (aujourd'hui).

           Devis candidats : quand plusieurs devis d'un même produit ont été
           déposés (même groupeAchatId), UN SEUL peut être approuvé — sinon
           l'approbation créerait une seconde dépense pour le même achat. */
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
            + `La dépense « Devis en cours » a été créée pour ce devis. Si vous voulez en retenir un `
            + `autre, supprimez cette dépense dans la page Dépenses puis approuvez le nouveau devis.`
          );
          return;
        }
        const patchDep = {
          description: txt(rec.description),
          fournisseur: txt(rec.fournisseur),
          numDevis: txt(rec.numDevis),
          numDevisUrl: txt(rec.fichierUrl),
          montant: numOf(rec.montant),
          ...(numOf(rec.fraisPort) !== null ? { fraisPort: numOf(rec.fraisPort) } : {}),
          dateDemande: isoOf(rec.dateDepot) || todayIso(),
          dateSignatureDevis: todayIso(),
          demandeur: txt(rec.demandeur) || txt(rec.deposant) || currentName,
          ligneBudgetaire: txt(rec.ligneBudgetaire),
          statut: 'Devis en cours',
          suivi: 'Devis en cours',
          commentaires: txt(rec.notes),
        };
        const dep = upsert('depenses', patchDep, rec.depenseId || null);
        const approvedDevis = upsert('devisBc', { statut: APPROVAL_APPROVED, depenseId: dep.id, decidedBy: currentName, decidedAt: Date.now() }, rec.id);
        /* Devis approuvé → le fichier Drive reçoit la marque « _approuvé ». */
        const approvedDevisName = await renameDepositDriveFileTo(approvedDevis);
        if (approvedDevisName) upsert('devisBc', { fichierNom: approvedDevisName }, approvedDevis.id);
        await notifyDecision({ ...rec, statut: APPROVAL_APPROVED, depenseId: dep.id }, APPROVAL_APPROVED);
        /* Les autres candidats du même produit encore « En attente » ne sont pas
           retenus : décision enregistrée (traçabilité) + e-mail au déposant. */
        for (const sib of candidats) {
          if (!isApprovalPending(sib.statut)) continue;
          const nonRetenu = upsert('devisBc', { statut: APPROVAL_NOT_RETAINED, decidedBy: currentName, decidedAt: Date.now() }, sib.id);
          await notifyNotRetained(nonRetenu, rec);
        }
      } else {
        /* Approbation du BC → la dépense du devis lié passe à « BC signé », avec la
           date de signature du BC (dateSignature) renseignée automatiquement. */
        const devisRec = rec.devisId ? devisById.get(rec.devisId) : null;
        const depId = txt(rec.depenseId) || (devisRec && txt(devisRec.depenseId));
        const dep = depId ? depensesById.get(depId) : null;
        if (!dep) {
          alert('Impossible d’approuver ce BC : le devis lié doit d’abord être approuvé (la dépense « Devis en cours » n’existe pas encore).');
          return;
        }
        upsert('depenses', {
          numBC: txt(rec.numBC),
          numBCUrl: txt(rec.fichierUrl),
          dateBC: isoOf(rec.dateDepot) || todayIso(),
          dateSignature: todayIso(),
          statut: 'BC signé',
          suivi: 'BC signé',
          fournisseur: txt(rec.fournisseur) || txt(dep.fournisseur),
          montant: numOf(rec.montant) === null ? numOf(dep.montant) : numOf(rec.montant),
          ...(numOf(rec.fraisPort) !== null ? { fraisPort: numOf(rec.fraisPort) } : {}),
          commentaires: txt(rec.notes) || txt(dep.commentaires),
          ...(txt(rec.demandeur) ? { demandeur: txt(rec.demandeur) } : {}),
          ...(txt(rec.ligneBudgetaire) ? { ligneBudgetaire: txt(rec.ligneBudgetaire) } : {}),
        }, dep.id);
        const approvedBc = upsert('devisBc', { statut: APPROVAL_APPROVED, depenseId: dep.id, decidedBy: currentName, decidedAt: Date.now() }, rec.id);
        /* BC approuvé → le fichier Drive reçoit la marque « _approuvé ». */
        const approvedBcName = await renameDepositDriveFileTo(approvedBc);
        if (approvedBcName) upsert('devisBc', { fichierNom: approvedBcName }, approvedBc.id);
        await notifyDecision({ ...rec, statut: APPROVAL_APPROVED, depenseId: dep.id }, APPROVAL_APPROVED);
      }
    } catch (err) {
      console.error(err);
      alert(`La décision n'a pas pu être enregistrée : ${(err && err.message) || err}`);
    } finally {
      setBusyId(null);
    }
  };

  /* ── Suppression (superutilisateur uniquement) ────────────────────────── */
  const removeRow = (rec) => {
    if (!rec || !rec.id || !isSuper) return;
    const ref = txt(rec.numBC) || txt(rec.numDevis) || txt(rec.description) || rec.id;
    if (window.confirm(`Supprimer définitivement cette ligne « ${ref} » ?`)) {
      remove('devisBc', rec.id);
    }
  };

    const activeKind = tab;
  const activeRows = tab === 'bc' ? bcList : devisRows;
  const columns = useMemo(
    () => buildColumns({
      kind: activeKind,
      isSuper,
      busyId,
      devisById,
      canEdit: (r) => isSuper
        || (txt(r.deposant) && currentName && sameName(r.deposant, currentName) && isApprovalPending(r.statut)),
      onDecide: decideRow,
      onEdit: (r) => setModal({ mode: 'edit', kind: activeKind, rec: r }),
      onRemove: removeRow,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeKind, isSuper, busyId, devisById, activeRows, currentName]
  );

  const pendingCount = (kind) => rows.filter((r) => r.kind === kind && isApprovalPending(r.statut)).length;
  const decidedCount = (kind) => rows.filter((r) => r.kind === kind && !isApprovalPending(r.statut)).length;

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
    const patch = {
      kind,
      description,
      fournisseur: txt(draft.fournisseur),
      ligneBudgetaire: txt(draft.ligneBudgetaire),
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
      statut: isApprovalPending(draft.statut) ? APPROVAL_PENDING : approvalStatusOf(draft.statut),
      dateDepot: txt(draft.dateDepot) || todayIso(),
    };
    const saved = upsert('devisBc', patch, existingId || null);
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
          réservée au superutilisateur.
        </p>
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
          <div className="text-[10px] text-slate-400 font-semibold">{devisList.length} déposé{devisList.length > 1 ? 's' : ''} · {decidedCount('devis')} traité{decidedCount('devis') > 1 ? 's' : ''}</div>
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
  canEdit, onDecide, onEdit, onRemove,
}) => {
  const statutTone = (r) => {
    if (r && r.statut === APPROVAL_NOT_RETAINED) return 'violet';
    const s = approvalStatusOf(r && r.statut);
    if (s === APPROVAL_APPROVED) return 'emerald';
    if (s === APPROVAL_REJECTED) return 'red';
    return 'amber';
  };
  const decisionLabel = (r) => {
    if (r && r.statut === APPROVAL_NOT_RETAINED) return APPROVAL_NOT_RETAINED;
    const s = approvalStatusOf(r && r.statut);
    return s === APPROVAL_APPROVED ? 'Approuvé' : s === APPROVAL_REJECTED ? 'Refusé' : 'En attente';
  };
  const numLabel = kind === 'bc' ? 'N° BC' : 'N° devis';
  const cols = [
    {
      key: 'decision', label: 'Décision', filter: 'facet', nowrap: true,
      value: (r) => decisionLabel(r),
      display: (r) => {
        const pending = isApprovalPending(r.statut);
        const busy = busyId === r.id;
        return (
          <div className="flex items-center gap-1.5">
            <Badge tone={statutTone(r)}>{decisionLabel(r)}</Badge>
            {isSuper && pending && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onDecide(r, APPROVAL_APPROVED)}
                  title="Approuver (crée / met à jour la dépense)"
                  className="w-7 h-7 rounded-lg border border-emerald-200 text-emerald-600 hover:bg-emerald-50 text-xs font-black disabled:opacity-40"
                >{busy ? '…' : '✓'}</button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onDecide(r, APPROVAL_REJECTED)}
                  title="Refuser"
                  className="w-7 h-7 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 text-xs font-black disabled:opacity-40"
                >✗</button>
              </>
            )}
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
   Fenêtre de dépôt / édition d'un devis ou d'un BC
   ═════════════════════════════════════════════════════════════════════════ */
const MODAL_INPUT = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500';
const MODAL_LABEL = 'block text-[10px] font-black uppercase text-slate-400 tracking-wide mb-1';

const DepositModal = ({
  mode, kind, rec, devisOptions, productGroups = [], fournisseurNames = [], budgetLineOptions = [],
  defaultDeposant, onCancel, onSave,
}) => {
  const editing = mode === 'edit' && !!rec;
  const isDevis = kind === 'devis';
  const year = new Date().getFullYear();
  /* Informations reprises du devis lié quand le BC (ou l’édition d’un dépôt
     historique) n’a pas encore ses propres valeurs : objet, fournisseur,
     montant HT, frais de port, ligne budgétaire et demandeur — le BC se
     rattachant au même devis reprend ses informations (modifiables ensuite
     dans le formulaire). */
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
     fournisseur, le montant HT, les frais de port, la ligne budgétaire et le
     demandeur (modifiables ensuite dans le formulaire). */
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
        ligneBudgetaire: def.ligneBudgetaire,
        demandeur: def.demandeur || d.demandeur,
        montant: def.montant,
        fraisPort: def.fraisPort,
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
            {isDevis ? 'l’approbation crée la dépense « Devis en cours »' : 'l’approbation fait passer la dépense liée à « BC signé »'}.
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
                les frais de port, la ligne budgétaire et le demandeur à partir de ce devis — ces champs
                restent modifiables. Il ne reste qu’à saisir le N° BC et joindre le fichier.
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
                « Devis en cours » est créée) et les autres passent automatiquement « Non retenu ».
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
                placeholder="Nom de la personne qui demande l’achat"
              />
            </div>
            <div>
              <label className={MODAL_LABEL}>Ligne budgétaire</label>
              <input
                className={MODAL_INPUT}
                value={draft.ligneBudgetaire || ''}
                onChange={set('ligneBudgetaire')}
                list="depot-lignes-budgetaires"
                placeholder="ex. S2R01GEC (INTRUDE)"
              />
              <datalist id="depot-lignes-budgetaires">
                {(budgetLineOptions || []).map((ln) => (
                  <option key={ln} value={ln} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <label className={MODAL_LABEL}>
              Fichier * — classé dans Budget_labo/{year}/{isDevis ? 'Devis' : 'BC'} — renommé
              automatiquement « {isDevis ? 'Devis' : 'BC'}_N°_ligne_fournisseur_demandeur_date »
              (+ « _approuvé » une fois le {isDevis ? 'devis' : 'BC'} approuvé)
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








