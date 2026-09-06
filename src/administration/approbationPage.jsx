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
     devis : { kind:'devis', description, fournisseur, numDevis, montant?,
               fichierNom, fichierUrl, fichierMime, notes, deposant,
               statut, depenseId?, decidedBy?, decidedAt? }
     bc    : { kind:'bc',    description, fournisseur, numBC, montant?,
               fichierNom, fichierUrl, fichierMime, notes, deposant,
               statut, devisId?, depenseId?, decidedBy?, decidedAt? }
     + enveloppe d'audit posée par upsert() (createdAt/By, updatedAt/By).
   ========================================================================= */
import React, { useMemo, useRef, useState } from 'react';
import { useAdmin } from './AdminContext';
import { SmartTable } from './smartTable';
import { toFrDate } from './congesDates';
import {
  APPROVAL_PENDING, APPROVAL_APPROVED, APPROVAL_REJECTED, isApprovalPending, approvalStatusOf,
} from './adminSchema';
import { uploadLocalFile, cloudBackendAvailable } from '../utils/driveUpload';
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

  const isSuper = !!access.isSuperuser;
  const currentName = txt(access.profile && access.profile.person
    ? access.profile.person.nom
    : (currentUser && currentUser.name));

  const [tab, setTab] = useState('devis'); // 'devis' | 'bc'
  const [modal, setModal] = useState(null); // null | { mode:'new', kind } | { mode:'edit', kind, rec }
  const [busyId, setBusyId] = useState(null); // id de la ligne en cours de décision
  const [note, setNote] = useState(null); // { text, mailto? } — résultat du dernier e-mail

  const devisList = useMemo(() => rows
    .filter((r) => r && r.kind === 'devis')
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)), [rows]);
  const bcList = useMemo(() => rows
    .filter((r) => r && r.kind === 'bc')
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)), [rows]);
  const devisById = useMemo(() => new Map(devisList.map((d) => [d.id, d])), [devisList]);
  const devisOptions = useMemo(() => devisList, [devisList]);

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
           La date de signature du devis est renseignée automatiquement (aujourd'hui). */
        const patchDep = {
          description: txt(rec.description),
          fournisseur: txt(rec.fournisseur),
          numDevis: txt(rec.numDevis),
          numDevisUrl: txt(rec.fichierUrl),
          montant: numOf(rec.montant),
          dateDemande: isoOf(rec.dateDepot) || todayIso(),
          dateSignatureDevis: todayIso(),
          demandeur: txt(rec.deposant) || currentName,
          statut: 'Devis en cours',
          suivi: 'Devis en cours',
          commentaires: txt(rec.notes),
        };
        const dep = upsert('depenses', patchDep, rec.depenseId || null);
        upsert('devisBc', { statut: APPROVAL_APPROVED, depenseId: dep.id, decidedBy: currentName, decidedAt: Date.now() }, rec.id);
        await notifyDecision({ ...rec, statut: APPROVAL_APPROVED, depenseId: dep.id }, APPROVAL_APPROVED);
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
          commentaires: txt(rec.notes) || txt(dep.commentaires),
        }, dep.id);
        upsert('devisBc', { statut: APPROVAL_APPROVED, depenseId: dep.id, decidedBy: currentName, decidedAt: Date.now() }, rec.id);
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
  const activeRows = tab === 'bc' ? bcList : devisList;
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
    if (!txt(draft.fichierUrl)) {
      alert('Le fichier (devis ou BC) est obligatoire : téléversez-le ou collez son lien Google Drive.');
      return false;
    }
    if (kind === 'bc' && !txt(draft.devisId)) {
      alert('Choisissez le devis auquel ce bon de commande se rattache (déposez d’abord le devis).');
      return false;
    }
    const patch = {
      kind,
      description,
      fournisseur: txt(draft.fournisseur),
      numDevis: kind === 'devis' ? numDevis : txt(draft.numDevis),
      numBC: kind === 'bc' ? numBC : '',
      devisId: kind === 'bc' ? txt(draft.devisId) : '',
      montant: numOf(draft.montant),
      fichierNom: txt(draft.fichierNom),
      fichierUrl: txt(draft.fichierUrl),
      fichierMime: txt(draft.fichierMime),
      notes: txt(draft.notes),
      deposant: txt(draft.deposant) || currentName,
      statut: isApprovalPending(draft.statut) ? APPROVAL_PENDING : approvalStatusOf(draft.statut),
      dateDepot: txt(draft.dateDepot) || todayIso(),
    };
    const saved = upsert('devisBc', patch, existingId || null);
    if (isNew) {
      await notifyDeposit(saved);
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
        </div>
      </div>

      {note && (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50/70 px-4 py-2.5 text-[11px] text-slate-600 leading-relaxed">
          <span>{note.text}</span>
          <span className="flex items-center gap-2 shrink-0">
            {note.mailto ? (
              <a href={note.mailto} className="font-black text-blue-700 underline">✉ Ouvrir ma messagerie</a>
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
    const s = approvalStatusOf(r && r.statut);
    if (s === APPROVAL_APPROVED) return 'emerald';
    if (s === APPROVAL_REJECTED) return 'red';
    return 'amber';
  };
  const decisionLabel = (r) => {
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
        </div>
      ),
    },
    {
      key: 'fournisseur', label: 'Fournisseur', filter: 'facet',
      value: (r) => txt(r.fournisseur),
      display: (r) => (txt(r.fournisseur) ? <span className="whitespace-nowrap text-xs font-semibold text-slate-600">{r.fournisseur}</span> : <span className="text-slate-300">—</span>),
    },
    {
      key: 'montant', label: 'Montant HT', numeric: true, align: 'right', nowrap: true,
      value: (r) => numOf(r.montant) || '',
      display: (r) => {
        const n = numOf(r.montant);
        return n === null ? <span className="text-slate-300">—</span> : <span className="whitespace-nowrap text-xs font-black text-slate-700 tabular-nums">{euro.format(n)}</span>;
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
            {approvalStatusOf(d.statut) === APPROVAL_APPROVED
              ? <span className="text-emerald-600 ml-1" title="Devis approuvé">✓</span>
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
  mode, kind, rec, devisOptions, defaultDeposant, onCancel, onSave,
}) => {
  const editing = mode === 'edit' && !!rec;
  const isDevis = kind === 'devis';
  const year = new Date().getFullYear();
  const [draft, setDraft] = useState(() => {
    if (rec) {
      return {
        kind: rec.kind || kind,
        description: txt(rec.description),
        fournisseur: txt(rec.fournisseur),
        numDevis: txt(rec.numDevis),
        numBC: txt(rec.numBC),
        devisId: txt(rec.devisId),
        montant: rec.montant === null || rec.montant === undefined ? '' : String(rec.montant).replace('.', ','),
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
      description: '',
      fournisseur: '',
      numDevis: isDevis ? '' : '',
      numBC: isDevis ? '' : '',
      devisId: isDevis ? '' : (devisOptions && devisOptions[0] ? devisOptions[0].id : ''),
      montant: '',
      fichierNom: '',
      fichierUrl: '',
      fichierMime: '',
      notes: '',
      deposant: txt(defaultDeposant),
      statut: APPROVAL_PENDING,
      dateDepot: todayIso(),
    };
  });

  const set = (k) => (ev) => setDraft((d) => ({ ...d, [k]: ev.target.value }));
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
      const driveName = (String(file.name || '').trim() || 'document').slice(0, 180);
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
                onChange={set('devisId')}
                disabled={!devisOptions.length}
              >
                {devisOptions.length ? (
                  devisOptions.map((d) => (
                    <option key={d.id} value={d.id}>
                      {txt(d.numDevis) || txt(d.description) || d.id} — {approvalStatusOf(d.statut) === APPROVAL_APPROVED ? 'approuvé' : 'en attente'}
                    </option>
                  ))
                ) : (
                  <option value="">Aucun devis disponible — créez d’abord un devis</option>
                )}
              </select>
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

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className={MODAL_LABEL}>{isDevis ? 'N° devis (optionnel)' : 'N° BC'}</label>
              <input
                className={MODAL_INPUT}
                value={isDevis ? draft.numDevis : draft.numBC}
                onChange={(ev) => setDraft((d) => ({ ...d, [isDevis ? 'numDevis' : 'numBC']: ev.target.value }))}
                placeholder={isDevis ? 'ex. 2026-0041' : 'ex. R20260215'}
              />
            </div>
            <div>
              <label className={MODAL_LABEL}>Fournisseur (optionnel)</label>
              <input className={MODAL_INPUT} value={draft.fournisseur} onChange={set('fournisseur')} placeholder="Nom du fournisseur" />
            </div>
            <div>
              <label className={MODAL_LABEL}>Montant HT (optionnel)</label>
              <input
                className={MODAL_INPUT}
                value={draft.montant}
                onChange={set('montant')}
                placeholder="ex. 1 234,56"
                inputMode="decimal"
              />
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <label className={MODAL_LABEL}>
              Fichier * — classé dans Budget_labo/{year}/{isDevis ? 'Devis' : 'BC'} (dossiers créés si besoin)
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
            <label className={MODAL_LABEL}>Notes (optionnel)</label>
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








