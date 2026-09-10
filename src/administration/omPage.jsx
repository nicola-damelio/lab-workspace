/* =========================================================================
   src/administration/omPage.jsx
   Page « OM prévus / souhaités » — ordres de mission à préparer (CRUD complet).

   Chaque OM peut contenir :
     · description (mission) — obligatoire
     · demandeur · destination · n° OM (référence)
     · ligne budgétaire liée (recette)
     · dates : demande / mission (départ) / retour
     · statut : En attente / Acceptée / Test / Refusée / Terminée — le changement de
       statut (approbation) est réservé au superutilisateur, et une fois l’OM
       « Acceptée » un e-mail prévient le superutilisateur et le(s) gestionnaire(s).
       « Test » = OM comptée dans les prévisions « OM prévus » des Recettes sans
       être réellement acceptée ;
     · coût estimé ou exact : transport · logement · repas · inscription
       (total recalculé automatiquement)
     · commentaires

   La liste se remplit via l’assistant d’import (feuille « ENT / Prix /
   Description » du classeur Google Sheets) ou à la main : bouton
   « ＋ Ajouter un OM » (et édition / suppression par ligne).
   ========================================================================= */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAdmin } from './AdminContext';
import { SmartTable } from './smartTable';
import { AdminImportModal } from './adminImportModal';
import { omColumns } from './collectionPages';
import { OM_COST_STATUSES, OM_STATUSES, APPROVAL_GESTION } from './adminSchema';
import { parseEuroAmount } from './importUtils';
import { uploadLocalFile, cloudBackendAvailable } from '../utils/driveUpload';
import { budgetDocPath, budgetDocFileName } from './driveFiling';
import { findRecetteTwin, sameCatType } from './recetteLink';
import {
  sendAdminMail, personnelEmailsMatching, superuserEmailsOf, mergeEmails,
  summarizeMail, mailBodyText,
} from './emailNotify';
import { scopeMeNames, scopeMePersonId, scopeCanSeeItem, scopePersonIdForName } from './ownScope';
import {
  TRANSFER_TARGETS, targetMetaOf, cibleEmailsOf, partModeOf, omTransferSummary,
  devisPatchFromOmPart, reimbPatchFromOm, omTransferStatus, TRANSFER_MODES, isDevisGestion,
} from './transferAchats';

/* ── Petites aides ─────────────────────────────────────────────────────── */
const txt = (v) => (v === null || v === undefined ? '' : String(v).trim());
const pick = (rec, keys) => {
  for (const k of keys) {
    const v = rec && rec[k];
    if (txt(v)) return v;
  }
  return '';
};
const numOf = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const numToInput = (v) => {
  const n = numOf(v);
  return n === null ? '' : String(Math.round(n * 100) / 100).replace('.', ',');
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
const demandeurOf = (r) => pick(r, ['demandeur', 'porteur', 'nom', 'name']);
const missionOf = (r) => pick(r, ['description', 'intitule', 'motif']);
const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

/* Approbation d’un OM : l’état « Acceptée » correspond à la décision positive
   (les valeurs d’import anglaises restent reconnues). */
const isOmApproved = (raw) =>
  /accept/i.test(String(raw || '').normalize('NFD').replace(/[\u0300-\u036f]/g, ''));

/* « OM en test » : statut « Test » choisi par le superutilisateur — l’OM est
   comptée dans les prévisions « OM prévus » de la page Recettes mais n’est PAS
   acceptée (pas de notification, pas de transfert possible). */
const isOmTest = (raw) => /^test$/i.test(txt(raw));

/* Teinte + pastille du statut affiché en PREMIÈRE colonne.
   Seule « Acceptée » est verte ; « En attente », « Test » (compté en prévision
   sans acceptation) et « Refusée » restent en AMBRE (jaune) : un état
   non-accepté ne doit jamais être montré en rouge (fausse impression de refus)
   ni en vert (fausse impression d’acceptation). */
const omStatutTone = (v) => {
  const s = txt(v).toLowerCase();
  if (/(accept)/.test(s)) return 'bg-emerald-50 border-emerald-200 text-emerald-700';
  if (/(refus|rejet)/.test(s)) return 'bg-amber-50 border-amber-200 text-amber-700';
  if (/(termin)/.test(s)) return 'bg-indigo-50 border-indigo-200 text-indigo-700';
  return 'bg-amber-50 border-amber-200 text-amber-700';
};
const StatutPill = ({ value }) =>
  txt(value)
    ? <span className={`inline-block text-[10px] font-black uppercase px-2 py-0.5 rounded-full border ${omStatutTone(value)}`}>{txt(value)}</span>
    : <span className="text-slate-300">—</span>;

/* Clés coût : canoniques (formulaire) + alias hérités des anciens imports. */
const COST_INPUTS = [
  { key: 'coutVoyage', label: 'Transport', legacy: ['voyage'], icon: '🚆' },
  { key: 'coutLogement', label: 'Logement', legacy: ['logement'], icon: '🏨' },
  { key: 'coutRepas', label: 'Repas', legacy: ['repas'], icon: '🍽️' },
  { key: 'coutInscription', label: 'Inscription', legacy: ['inscription'], icon: '🎟️' },
];
const costValue = (rec, cost) => pick(rec, [cost.key, ...cost.legacy]);
/* Documents (N° devis + lien) éventuellement joints à un poste « Commande/BC »
   d'un OM : renseignés par le membre (facultatifs), ils permettent au directeur
   de transférer l'OM « pour signature ». */
const omPartDevisNum = (om, key) => txt(om && pick(om, [`devisNum_${key}`, 'numDevis']));
const omPartDevisUrl = (om, key) => txt(om && pick(om, [`devisUrl_${key}`, 'fichierUrl', 'numDevisUrl']));
/* Un poste « Commande/BC » est « complet » quand son N° devis ET son lien sont
   fournis. */
const omPartComplete = (om, key) => !!omPartDevisNum(om, key) && !!omPartDevisUrl(om, key);

const NOTICE_TONES = {
  ok: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  info: 'bg-blue-50 border-blue-200 text-blue-700',
  warn: 'bg-amber-50 border-amber-200 text-amber-700',
};

const Notice = ({ tone, text, onClose, mailto, consoleUrl }) => (
  <div className={`rounded-xl border px-4 py-2.5 text-xs font-semibold flex items-center justify-between gap-3 ${NOTICE_TONES[tone] || NOTICE_TONES.info}`}>
    <span className="min-w-0">{text}</span>
    <span className="flex items-center gap-3 shrink-0">
      {mailto && (
        <a href={mailto} className="font-black text-blue-700 underline whitespace-nowrap" title="Ouvrir votre messagerie pour envoyer l’e-mail">✉ Ouvrir ma messagerie</a>
      )}
      {consoleUrl && (
        <a
          href={consoleUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-black text-blue-700 underline whitespace-nowrap"
          title="Console Google Cloud — à faire une seule fois par le propriétaire du projet"
        >
          ⚙ Activer l’API Gmail
        </a>
      )}
      {onClose && (
        <button type="button" onClick={onClose} className="shrink-0 font-black opacity-60 hover:opacity-100" title="Masquer">✕</button>
      )}
    </span>
  </div>
);

/* ── Formulaires ───────────────────────────────────────────────────────── */
const MODAL_INPUT = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500';
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
/* ═════════════════════════════════════════════════════════════════════════
   Fenêtre d’ajout / édition d’un ordre de mission
   ═════════════════════════════════════════════════════════════════════════ */
const OmModal = ({
  rec, recettes, demandeurNames, statusOptions, onCancel, onSave, canDecide = false,
  currentUser, onApproved, meName = '', mePersonId = null, personnel = [], lockDemandeurToMe = false,
}) => {
  const editing = !!rec;
  const [draft, setDraft] = useState(() => ({
    description: txt(rec && missionOf(rec)),
    /* Nouvelle demande : le demandeur est le membre connecté (« demandeur =
       moi »), verrouillé pour les membres — chacun ne voit que ses propres OM. */
    demandeur: txt(rec && demandeurOf(rec)) || (lockDemandeurToMe ? meName : ''),
    destination: txt(rec && pick(rec, ['destination', 'ville'])),
    numOM: txt(rec && pick(rec, ['numOM', 'numeroOm', 'omNo'])),
    recetteId: (rec && rec.recetteId) || '',
    ligneBudgetaire: txt(rec && pick(rec, ['ligneBudgetaire', 'ligne'])),
    statut: txt(rec && pick(rec, ['statut'])) || 'En attente',
    coutStatut: txt(rec && pick(rec, ['coutStatut', 'prix'])) || 'Estimé',
    dateDemande: rec ? isoOf(pick(rec, ['dateDemande'])) : todayIso(),
    dateMission: isoOf(rec && pick(rec, ['dateMission', 'dateDebut'])),
    dateRetour: isoOf(rec && pick(rec, ['dateRetour'])),
    commentaires: txt(rec && pick(rec, ['commentaires', 'notes'])),
    ...COST_INPUTS.reduce((acc, c) => { acc[c.key] = numToInput(rec && costValue(rec, c)); return acc; }, {}),
    partMode: COST_INPUTS.reduce((acc, c) => { acc[c.key] = partModeOf(rec, c.key); return acc; }, {}),
    /* Documents (N° devis + lien/fichier) d'un poste payé par le laboratoire
       (« BC ») : facultatifs à la soumission — ils permettent au directeur de
       transférer l'OM « pour signature » directement. */
    ...COST_INPUTS.reduce((acc, c) => {
      acc[`devisNum_${c.key}`] = txt(rec && rec[`devisNum_${c.key}`]);
      acc[`devisUrl_${c.key}`] = txt(rec && rec[`devisUrl_${c.key}`]);
      return acc;
    }, {}),
  }));
  const [error, setError] = useState('');
  /* Fichier(s) devis joints depuis le PC pour les postes « Commande / BC » :
     téléversés vers Budget_labo/<année>/Devis, le lien est enregistré dans le
     champ « devisUrl_… » du poste concerné. */
  const partFileRefs = useRef({});
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');

  const set = (key) => (e) => setDraft((d) => ({ ...d, [key]: e.target.value }));
  /* Mode de paiement d'un poste de coût : « bc » = payé par commande (devis à
     faire signer) ; « reimb » = frais avancés par le membre puis remboursés
     (aucun BC). */
  const setPartMode = (key) => (mode) => setDraft((d) => ({ ...d, partMode: { ...(d.partMode || {}), [key]: mode } }));

  /* Téléversement d'un devis (fichier local du PC) pour un poste « BC ». */
  const pickPartFile = async (file, key) => {
    if (!file || !key) return;
    setUploadMsg('');
    if (!cloudBackendAvailable()) {
      setUploadMsg('⚠️ Google Drive n’est pas connecté — collez le lien du devis dans le champ « lien » ci-dessous.');
      return;
    }
    setUploadBusy(true);
    try {
      const year = new Date().getFullYear();
      const label = ((COST_INPUTS.find((x) => x.key === key) || {}).label) || key;
      const driveName = budgetDocFileName({
        prefix: 'Devis',
        code: txt(draft[`devisNum_${key}`]),
        ligne: txt(draft.ligneBudgetaire),
        fournisseur: '',
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
        setDraft((d) => ({
          ...d,
          [`devisUrl_${key}`]: url,
          [`devisNum_${key}`]: txt(d[`devisNum_${key}`]),
        }));
        setUploadMsg(`✓ Devis « ${label} » téléversé dans Budget_labo/${year}/Devis (dossier créé si besoin).`);
      } else {
        setUploadMsg('⚠️ Téléversement impossible — collez le lien du devis dans le champ « lien » ci-dessous.');
      }
    } catch (err) {
      console.error(err);
      setUploadMsg(`⚠️ Téléversement impossible : ${(err && err.message) || err}`);
    } finally {
      setUploadBusy(false);
    }
  };

  /* La base Recettes contient parfois plusieurs exemplaires du même intitulé de
     ligne budgétaire : dans le menu on n’en montre qu’un seul, considéré comme
     « Fonctionnement » (règle du labo). Seule exception : si l’OM en cours
     d’édition est déjà imputé sur un autre exemplaire de cet intitulé, on garde
     celui-ci pour ne jamais changer le lien silencieusement à l’enregistrement. */
  const selectedRecetteId =
    draft.recetteId && recettes.some((r) => r.id === draft.recetteId) ? draft.recetteId : '';
  const keyOfRecette = (r) => (txt(r.ligne) || txt(r.name) || r.id).toLowerCase().replace(/\s+/g, ' ').trim();
  const recetteGroups = new Map();
  recettes.forEach((r) => {
    const k = keyOfRecette(r);
    if (!recetteGroups.has(k)) recetteGroups.set(k, []);
    recetteGroups.get(k).push(r);
  });
  const recetteOptions = [...recetteGroups.values()].map((group) =>
    group.find((r) => r.id === selectedRecetteId)
    || group.find((r) => String(r.type || '').toLowerCase().includes('fonctionnement'))
    || group[0]);
  const recetteDupCount = recettes.length - recetteOptions.length;

  const setRecette = (e) => {
    const id = e.target.value;
    const found = recettes.find((r) => r.id === id);
    setDraft((d) => ({ ...d, recetteId: id, ligneBudgetaire: found ? txt(found.ligne) : '' }));
  };

  const parts = COST_INPUTS
    .map((c) => parseNum(draft[c.key]))
    .filter((n) => n !== null);
  const liveTotal = parts.length ? parts.reduce((s, n) => s + n, 0) : null;
  const previousTotal = numOf(rec && pick(rec, ['coutTotal']));
  const displayTotal = liveTotal !== null ? liveTotal : previousTotal;

  const submit = () => {
    const description = txt(draft.description);
    if (!description) {
      setError('Merci de renseigner la mission : c’est l’intitulé de l’OM (obligatoire).');
      return;
    }
    /* Les dates d’aller (départ en mission) et de retour sont OBLIGATOIRES
       dans une demande d’OM. */
    const dateMission = isoOf(draft.dateMission);
    const dateRetour = isoOf(draft.dateRetour);
    if (!dateMission || !dateRetour) {
      setError('Les dates de départ (aller) et de retour de la mission sont obligatoires.');
      return;
    }
    const couts = {};
    COST_INPUTS.forEach((c) => { couts[c.key] = parseNum(draft[c.key]); });
    const coutTotal = liveTotal !== null ? liveTotal : previousTotal;
    const recetteId = draft.recetteId && recettes.some((r) => r.id === draft.recetteId) ? draft.recetteId : '';
    const previous = txt(rec && pick(rec, ['statut']));
    const decided = txt(draft.statut) || previous || 'En attente';
    const patch = {
      description,
      demandeur: txt(draft.demandeur),
      destination: txt(draft.destination),
      numOM: txt(draft.numOM),
      recetteId,
      ligneBudgetaire: recetteId
        ? txt((recettes.find((r) => r.id === recetteId) || {}).ligne)
        : (editing ? txt(draft.ligneBudgetaire) : ''),
      statut: decided,
      coutStatut: txt(draft.coutStatut),
      dateDemande: isoOf(draft.dateDemande),
      dateMission: isoOf(draft.dateMission),
      dateRetour: isoOf(draft.dateRetour),
      commentaires: txt(draft.commentaires),
      ...couts,
      coutTotal,
      partMode: COST_INPUTS.reduce((acc, c) => { acc[c.key] = txt(draft.partMode && draft.partMode[c.key]) || 'bc'; return acc; }, {}),
      ...COST_INPUTS.reduce((acc, c) => {
        acc[`devisNum_${c.key}`] = txt(draft[`devisNum_${c.key}`]);
        acc[`devisUrl_${c.key}`] = txt(draft[`devisUrl_${c.key}`]);
        return acc;
      }, {}),
    };
    /* Attribution stable à la fiche Personnel du demandeur : chacun ne voit que
       ses propres OM (« demandeur = moi »). */
    const demandeurPersonId = lockDemandeurToMe
      ? (mePersonId || scopePersonIdForName(personnel, patch.demandeur))
      : scopePersonIdForName(personnel, patch.demandeur);
    if (demandeurPersonId) patch.demandeurPersonId = demandeurPersonId;
    if (canDecide && decided !== previous) {
      patch.statutChangedBy = (currentUser && currentUser.name) || '';
      patch.statutChangedAt = Date.now();
    }
    onSave(patch, editing && rec.id);
    /* Une fois l’OM « Acceptée », on prévient le superutilisateur et le(s) gestionnaire(s). */
    if (canDecide && !isOmApproved(previous) && isOmApproved(decided) && typeof onApproved === 'function') {
      onApproved(patch, editing && rec.id);
    }
  };
  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(3px)' }}>
      <div className="bg-slate-50 rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden max-h-[94vh] flex flex-col">
        <div className="px-6 py-4 bg-gradient-to-br from-blue-700 to-indigo-800 text-white flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-black flex items-center gap-2">
              <span className="text-xl" aria-hidden="true">✈️</span>
              {editing ? 'Modifier l’ordre de mission' : 'Ajouter un OM'}
            </h2>
            <p className="text-blue-100 text-xs">Ordre de mission : dates, demandeur, destination, coûts et statut.</p>
          </div>
          <button type="button" onClick={onCancel} className="shrink-0 w-8 h-8 rounded-lg bg-white/15 hover:bg-white/30 text-white font-bold" title="Fermer">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-5 flex flex-col gap-3">
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-semibold text-red-600">
              {error}
            </div>
          )}

          <Section icon="✈️" title="Mission">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <Field label="Mission / description" required>
                  <input
                    className={MODAL_INPUT} value={draft.description} onChange={set('description')}
                    placeholder="ex. Congrès de biologie structurale à Barcelone" autoFocus
                  />
                </Field>
              </div>
              <Field label="Destination">
                <input className={MODAL_INPUT} value={draft.destination} onChange={set('destination')} placeholder="ex. Barcelone (Espagne)" />
              </Field>
              <Field label="N° OM / référence" hint="Si le numéro d’ordre de mission a déjà été attribué.">
                <input className={MODAL_INPUT} value={draft.numOM} onChange={set('numOM')} placeholder="ex. 2025-042" />
              </Field>
            </div>
          </Section>

          <Section icon="👤" title="Demandeur & budget">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field
                label="Demandeur"
                hint={lockDemandeurToMe
                  ? 'Verrouillé sur vous-même : chacun ne voit que ses propres OM.'
                  : 'Personne à l’origine de la demande de mission.'}
              >
                <input
                  className={MODAL_INPUT} value={draft.demandeur}
                  onChange={set('demandeur')}
                  readOnly={lockDemandeurToMe}
                  list={lockDemandeurToMe ? undefined : 'om-demandeurs'}
                  placeholder={lockDemandeurToMe ? 'vous-même' : 'ex. Marie Curie'}
                />
                {!lockDemandeurToMe && (
                  <datalist id="om-demandeurs">
                    {(demandeurNames || []).map((n) => <option key={n} value={n} />)}
                  </datalist>
                )}
              </Field>
              <Field
                label="Ligne budgétaire liée"
                hint={`La recette sur laquelle l’OM sera imputé${recetteDupCount > 0 ? ' — les intitulés en double dans Recettes sont regroupés (considérés « Fonctionnement »).' : '.'}`}
              >
                <select className={MODAL_INPUT} value={selectedRecetteId} onChange={setRecette}>
                  <option value="">— Aucune ligne budgétaire —</option>
                  {recetteOptions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {txt(r.ligne) || txt(r.name) || r.id}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </Section>
          <Section icon="📅" title="Dates & statut">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field
                label="Date de demande"
                hint={editing ? '' : 'Renseignée automatiquement : jour de la création de l’OM.'}
              >
                <input
                  type="date" className={MODAL_INPUT} value={draft.dateDemande} onChange={set('dateDemande')}
                  disabled={!editing}
                />
              </Field>
              <Field label="Départ (mission)" required>
                <input type="date" className={MODAL_INPUT} value={draft.dateMission} onChange={set('dateMission')} />
              </Field>
              <Field label="Retour" required>
                <input type="date" className={MODAL_INPUT} value={draft.dateRetour} onChange={set('dateRetour')} />
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3 items-end">
              <Field label="Statut">
                {!editing ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-slate-600 leading-snug">
                    <b>En attente</b> — statut fixé automatiquement à la création&nbsp;;
                    seule l’approbation (réservée au superutilisateur) le modifiera ensuite.
                  </div>
                ) : canDecide ? (
                  <select className={MODAL_INPUT} value={draft.statut} onChange={set('statut')}>
                    {(statusOptions && statusOptions.length ? statusOptions : OM_STATUSES).map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                ) : (
                  <div className="flex items-center gap-2">
                    <input className={MODAL_INPUT} value={draft.statut} readOnly disabled title="Le changement de statut est réservé au superutilisateur" />
                    <span className="text-[11px]" title="Le changement de statut est réservé au superutilisateur">🔒</span>
                  </div>
                )}
              </Field>
              <Field label="Coût (estimé / exact)">
                <select className={MODAL_INPUT} value={draft.coutStatut} onChange={set('coutStatut')}>
                  {OM_COST_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
            </div>
          </Section>

          <Section icon="💶" title="Coûts (€)">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {COST_INPUTS.map((c) => {
                const isBc = !(draft.partMode && draft.partMode[c.key] === 'reimb');
                return (
                  <Field key={c.key} label={`${c.icon} ${c.label}`}>
                    <input
                      className={MODAL_INPUT} inputMode="decimal" value={draft[c.key]} onChange={set(c.key)}
                      placeholder="0,00"
                    />
                    <div className="mt-1.5 flex gap-1">
                      {['bc', 'reimb'].map((mode) => {
                        const active = (mode === 'bc') === isBc;
                        return (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => setPartMode(c.key)(mode)}
                            title={mode === 'bc'
                              ? 'Payé par le laboratoire sur commande : ce poste sera converti en devis « Approbation devis & BC », soldé quand son BC est signé.'
                              : 'Frais avancés par le membre puis remboursés : ce poste migrera dans Dépenses › Remboursements (badge « À corriger »).'}
                            className={`px-1.5 py-0.5 rounded-md text-[9px] font-black uppercase transition-colors ${
                              active
                                ? (mode === 'bc' ? 'bg-blue-600 text-white' : 'bg-amber-500 text-white')
                                : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                            }`}
                          >
                            {mode === 'bc' ? 'BC' : 'Remb.'}
                          </button>
                        );
                      })}
                    </div>
                    {isBc ? (
                      <div className="mt-1.5 space-y-1.5">
                        <input
                          className={`${MODAL_INPUT} !px-2 !py-1 text-xs`}
                          value={draft[`devisNum_${c.key}`] || ''} onChange={set(`devisNum_${c.key}`)}
                          placeholder="N° devis (facultatif)"
                          title="N° du devis de ce poste — facultatif à la soumission (requis pour un transfert « pour signature »)."
                        />
                        <input
                          className={`${MODAL_INPUT} !px-2 !py-1 text-xs text-blue-700 placeholder:text-slate-300`}
                          value={draft[`devisUrl_${c.key}`] || ''} onChange={set(`devisUrl_${c.key}`)}
                          placeholder="🔗 lien du devis (facultatif)"
                          title="Lien Google Drive du devis de ce poste — facultatif à la soumission."
                        />
                        <div className="flex items-center gap-1.5">
                          <input
                            ref={(el) => { partFileRefs.current[c.key] = el; }}
                            type="file"
                            className="hidden"
                            accept=".pdf,.doc,.docx,.odt,.xls,.xlsx,.jpg,.jpeg,.png,.txt"
                            onChange={(e) => {
                              const f = e.target.files && e.target.files[0];
                              if (e.target) e.target.value = '';
                              if (f) pickPartFile(f, c.key);
                            }}
                          />
                          <button
                            type="button"
                            disabled={uploadBusy}
                            onClick={() => {
                              const el = partFileRefs.current[c.key];
                              if (el) el.click();
                            }}
                            title="Choisir le fichier du devis sur ce PC — téléversé dans Budget_labo/<année>/Devis"
                            className="text-[10px] font-black px-2 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 disabled:opacity-50 whitespace-nowrap"
                          >⬆ Devis (PC)</button>
                          <span className={`text-[9px] truncate min-w-0 flex-1 ${txt(draft[`devisUrl_${c.key}`]) ? 'text-emerald-600 font-semibold' : 'text-slate-400'}`}>
                            {txt(draft[`devisUrl_${c.key}`]) ? 'devis joint ✓' : 'ou collez le lien ci-dessus'}
                          </span>
                        </div>
                      </div>
                    ) : null}
                  </Field>
                );
              })}
            </div>
            <p className="mt-1.5 text-[10px] text-slate-400 leading-snug">
              Sous chaque montant : <b className="text-slate-500">BC</b> = commandé par le laboratoire (devis dans
              « Approbation devis & BC », soldé à la signature du BC) · <b className="text-slate-500">Remb.</b> = frais
              avancés par le membre puis remboursés (aucun BC : migre vers Dépenses › Remboursements, « À corriger »).
              Pour un poste « BC », les champs <b className="text-slate-500">N° devis / lien du devis</b> sont
              facultatifs à la soumission : s'ils sont renseignés, le directeur pourra transférer l'OM
              <b className="text-slate-500"> « pour signature »</b> ; sinon, elle partira « pour révision »
              (devis « En gestion » à compléter).
            </p>
            {uploadMsg && (
              <p className="mt-2 text-[11px] leading-snug text-slate-500">{uploadMsg}</p>
            )}
            <div className="mt-3 rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 flex items-center justify-between gap-3">
              <div className="text-[11px] font-semibold text-slate-500">
                Total du tableau
                {liveTotal !== null && (
                  <span className="block text-[10px] font-normal text-slate-400">Recalculé automatiquement à partir des postes ci-dessus.</span>
                )}
              </div>
              <div className={`text-lg font-black tabular-nums ${draft.coutStatut === 'Exact' ? 'text-emerald-600' : 'text-slate-800'}`}>
                {displayTotal !== null && displayTotal !== undefined ? euro.format(displayTotal) : '—'}
              </div>
            </div>
          </Section>

          <Section icon="💬" title="Commentaires">
            <textarea
              className={`${MODAL_INPUT} min-h-[70px]`} value={draft.commentaires} onChange={set('commentaires')}
              placeholder="Contexte, justificatifs attendus, remarques…"
            />
          </Section>
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 bg-white border-t border-slate-200">
          <button type="button" onClick={onCancel} className="px-4 py-2 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-200 bg-slate-100">
            Annuler
          </button>
          <button
            type="button" onClick={submit}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm px-5 py-2 rounded-xl shadow-sm transition-colors"
          >
            💾 {editing ? 'Enregistrer les modifications' : 'Ajouter l’OM'}
          </button>
        </div>
      </div>
    </div>
  );
};
/* ═════════════════════════════════════════════════════════════════════════
   Page OM
   ═════════════════════════════════════════════════════════════════════════ */
export const OmPage = () => {
  const {
    data, settings, upsert, removeRecord, importMany, updateMany,
    currentUser, access, operators, navigate, focus, clearFocus,
  } = useAdmin();
  const om = useMemo(() => (Array.isArray(data.om) ? data.om : []), [data.om]);
  const depenses = useMemo(() => (Array.isArray(data.depenses) ? data.depenses : []), [data.depenses]);
  const recettes = useMemo(() => (Array.isArray(data.recettes) ? data.recettes : []), [data.recettes]);
  const personnel = useMemo(() => (Array.isArray(data.personnel) ? data.personnel : []), [data.personnel]);
  /* Devis / BC déposés (page « Approbation devis & BC ») et fiches du registre
     « Remboursements » (page Dépenses) : suivent la résolution des OM
     transférées (BC signé pour les postes « Commande », remboursement corrigé
     pour les postes « Remboursement »). */
  const devisBc = useMemo(() => (Array.isArray(data.devisBc) ? data.devisBc : []), [data.devisBc]);
  const reimbursements = useMemo(
    () => (Array.isArray(data.reimbursements) ? data.reimbursements : []),
    [data.reimbursements]
  );

  const [modal, setModal] = useState(null); // null | { mode: 'new' } | { mode: 'edit', rec }
  const [importOpen, setImportOpen] = useState(false);
  const [notice, setNotice] = useState(null); // { tone, text, mailto? }
  /* OM « cible » d’une navigation inter-page (page Recettes › survol d’un OM
     prévu) : on surligne l’OM correspondant dans le tableau. */
  const [focusRow, setFocusRow] = useState(null);
  /* Réafficher les OM « soldées » (toutes les parties réglées — BC signé et/ou
     remboursements corrigés) qui sont masquées par défaut. */
  const [showSoldes, setShowSoldes] = useState(false);

  useEffect(() => {
    if (!focus || focus.pageId !== 'om') return;
    const rid = focus.recordId;
    if (rid && om.some((o) => o.id === rid)) {
      setFocusRow(rid);
      /* La ligne ciblée (ex. clic sur un OM prévu de la page Recettes) peut être
         une OM TRANSFÉRÉE — masquée par défaut : on rétablit l’affichage pour
         qu’elle soit bien visible (et supprimable) à l’arrivée. */
      const target = om.find((o) => o.id === rid);
      if (target && target.transfert) setShowSoldes(true);
    }
    if (typeof clearFocus === 'function') clearFocus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  /* L’approbation (changement de statut) est réservée au superutilisateur. */
  const isSuper = !!access.isSuperuser;
  const currentName = txt((access.profile && access.profile.person && access.profile.person.nom)
    || (currentUser && currentUser.name));

  /* Isolation « chacun ne voit que ses propres OM » : le superutilisateur voit
     tout (il approuve et transfère) ; chaque autre membre ne voit que ses
     propres demandes — jamais celles des autres. Les OM sont attribuées par la
     fiche Personnel du demandeur (`demandeurPersonId`, posée à la création),
     sinon par correspondance de nom (anciens imports Google Sheets). */
  const meNames = useMemo(() => scopeMeNames(access, currentUser), [access, currentUser]);
  const mePersonId = useMemo(() => scopeMePersonId(access), [access]);
  const myOm = useMemo(
    () => (isSuper ? om : om.filter((o) => scopeCanSeeItem(o, { isSuper, meNames, mePersonId }))),
    // scopeCanSeeItem dépend de meNames / mePersonId (recalculés à chaque rendu).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [om, isSuper, meNames, mePersonId]
  );

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

  /* Options de statut : personnalisées dans Setup › Options des listes déroulantes. */
  const omStatutOptions = useMemo(() => {
    const base = (Array.isArray(settings && settings.omStatuses) && settings.omStatuses.length)
      ? settings.omStatuses
      : OM_STATUSES;
    const set = base.map((s) => txt(s)).filter(Boolean);
    om.forEach((r) => {
      const s = txt(pick(r, ['statut']));
      if (s && set.indexOf(s) === -1) set.push(s);
    });
    /* Le statut « Test » (compté en prévision dans Recettes, sans acceptation
       réelle) reste toujours proposé, même si la liste personnalisée de Setup
       ne l’a pas encore. */
    if (set.indexOf('Test') === -1) set.push('Test');
    return set;
  }, [settings, om]);

  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  /* Suggestions « demandeur » : pour un membre, uniquement lui-même (« demandeur
     = moi », verrouillé) ; pour le superutilisateur, tous les noms déjà saisis. */
  const demandeurNames = useMemo(() => {
    if (!isSuper) {
      const set = new Set();
      meNames.forEach((n) => { const s = txt(n); if (s) set.add(s); });
      return [...set];
    }
    const set = new Set();
    myOm.forEach((r) => {
      const d = demandeurOf(r);
      if (d) set.add(d);
    });
    if (currentUser && txt(currentUser.name)) set.add(txt(currentUser.name));
    return [...set].sort((a, b) => a.localeCompare(b, 'fr'));
  }, [myOm, currentUser, isSuper, meNames]);

  /* Les plus récentes d’abord (par départ, sinon date de demande) — sur les
     seules OM visibles par le membre connecté (les siennes, sauf pour le
     superutilisateur qui voit tout). */
  const rows = useMemo(() => [...myOm].sort((a, b) => {
    const da = isoOf(pick(a, ['dateMission', 'dateDebut'])) || isoOf(a.dateDemande);
    const db = isoOf(pick(b, ['dateMission', 'dateDebut'])) || isoOf(b.dateDemande);
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return db.localeCompare(da);
  }), [myOm]);

  /* Suivi des OM transférées : un poste « Commande / BC » est soldé quand la
     dépense liée à son devis porte la date de signature de son BC ; un poste
     « Remboursement » l'est quand sa fiche du registre Remboursements n'est
     plus « À corriger ». */
  const omStatusByKey = useMemo(() => {
    const map = new Map();
    myOm.forEach((o) => map.set(o.id, omTransferStatus(o, devisBc, depenses, reimbursements)));
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myOm, devisBc, depenses, reimbursements]);

  /* Quand une OM transférée a TOUS ses postes soldés (BC signé + remboursements
     corrigés), son statut passe automatiquement à « Terminée » : elle sort
     alors des projections « OM prévus » de la page Recettes. */
  const autoTerminatedRef = useRef(new Set());
  useEffect(() => {
    if (!isSuper) return;
    om.forEach((o) => {
      if (!o.transfert || autoTerminatedRef.current.has(o.id)) return;
      const st = omStatusByKey.get(o.id);
      if (!st || !st.allResolved || !st.parts.length) return;
      autoTerminatedRef.current.add(o.id);
      if (!/termin/i.test(txt(pick(o, ['statut'])))) {
        upsert('om', {
          statut: 'Terminée',
          statutChangedBy: 'Système (frais soldés : BC signés / remboursements corrigés)',
          statutChangedAt: Date.now(),
        }, o.id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [om, omStatusByKey, isSuper]);

  /* Par défaut, une OM transférée dont TOUS les postes sont soldés disparaît
     de la liste ; la case « Afficher les soldées » la réaffiche. Les OM jamais
     transférées restent toujours visibles. */
  const visibleRows = useMemo(() => {
    if (showSoldes) return rows;
    /* Une OM transférée (signature ou révision) disparaît de la liste ; elle
       n'est réaffichée que via « Afficher les transférées ». */
    return rows.filter((o) => !o.transfert);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, showSoldes, omStatusByKey]);
  const hiddenSoldes = rows.length - visibleRows.length;

  /* Envoi d’un e-mail au superutilisateur (et au(x) gestionnaire(s)) quand
     l’OM passe « Acceptée ». */
  const notifyApproved = async (rec) => {
    const label = missionOf(rec) || txt(rec.description) || 'ordre de mission';
    const ref = txt(rec.numOM);
    const subject = `[Lab Workspace] OM accepté${ref ? ` — ${ref}` : ''}`;
    const lines = [
      "L'ordre de mission suivant a été accepté :",
      `  ${label}${ref ? ` (${ref})` : ''}`,
      `Demandeur : ${txt(rec.demandeur) || '—'}`,
      `Destination : ${txt(rec.destination) || '—'}`,
      txt(rec.dateMission)
        ? `Mission : du ${txt(rec.dateMission)}${txt(rec.dateRetour) ? ` au ${txt(rec.dateRetour)}` : ''}`
        : '',
      (rec.coutTotal !== undefined && rec.coutTotal !== null && rec.coutTotal !== '')
        ? `Coût total : ${euro.format(Number(rec.coutTotal))}`
        : '',
      txt(rec.ligneBudgetaire) ? `Ligne budgétaire : ${txt(rec.ligneBudgetaire)}` : '',
      `Décision prise par : ${currentName || 'superutilisateur'}`,
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

  /* Changement rapide de statut dans le tableau — réservé au superutilisateur. */
  const quickStatut = (r, rawValue) => {
    const value = txt(rawValue);
    if (!value || !isSuper) return;
    const previous = txt(pick(r, ['statut']));
    if (value === previous) return;
    upsert('om', {
      statut: value,
      statutChangedBy: currentName,
      statutChangedAt: Date.now(),
    }, r.id);
    if (!isOmApproved(previous) && isOmApproved(value)) notifyApproved({ ...r, statut: value });
  };

  /* E-mail au superutilisateur quand un membre soumet une NOUVELLE demande
     d’OM (« OM prévus / souhaités ») — il approuve puis transfère. */
  const notifyNewOm = async (patch) => {
    const label = missionOf(patch) || 'ordre de mission';
    const subject = `[Lab Workspace] Nouvelle demande d’OM — ${label}`;
    const lines = [
      'Une nouvelle demande d’ordre de mission a été soumise :',
      `  ${label}`,
      `Demandeur : ${txt(patch && demandeurOf(patch)) || '—'}`,
      txt(patch && patch.destination) ? `Destination : ${txt(patch.destination)}` : '',
      (patch && isoOf(patch.dateMission))
        ? `Mission : du ${isoOf(patch.dateMission)}${isoOf(patch.dateRetour) ? ` au ${isoOf(patch.dateRetour)}` : ''}`
        : '',
      (patch && patch.coutTotal !== undefined && patch.coutTotal !== null && patch.coutTotal !== '')
        ? `Coût total : ${euro.format(Number(patch.coutTotal))}`
        : 'Coût non chiffré',
      txt(patch && patch.ligneBudgetaire) ? `Ligne budgétaire : ${txt(patch.ligneBudgetaire)}` : '',
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
    const label = missionOf(patch) || 'sans titre';
    upsert('om', patch, existingId);
    setModal(null);
    setNotice({
      tone: 'ok',
      text: existingId
        ? `Ordre de mission « ${label} » enregistré.`
        : `Ordre de mission « ${label} » ajouté.`,
    });
    /* Nouvelle demande soumise par un membre → prévenir le superutilisateur. */
    if (!existingId && !isSuper && typeof notifyNewOm === 'function') {
      notifyNewOm({ ...patch });
    }
  };

  const onRemove = (rec) => {
    if (!rec) return;
    if (!isSuper && !scopeCanSeeItem(rec, { isSuper, meNames, mePersonId })) return;
    const label = missionOf(rec) || rec.id;
    if (!window.confirm(`Supprimer l’ordre de mission « ${label} » ?\nCette action est définitive.`)) return;
    removeRecord('om', rec);
    setNotice({ tone: 'ok', text: `Ordre de mission « ${label} » supprimé.` });
  };

  /* ── Transfert d’un OM « Acceptée » vers la page Dépenses › onglet OM ──
     Le transfert crée une ligne de type « om » DANS la collection depenses :
     elle devient un enregistrement indépendant (édition, facture, paiement,
     déplacement entre Achats / PI / OM). La collection om — les demandes de
     mission « prévues / souhaitées » — n’est pas touchée. */
  const linkedDepenseOf = (rec) =>
    (Array.isArray(depenses) ? depenses : []).find((d) => d && d.omId && d.omId === rec.id) || null;

  const _transferOmToDepenses = (rec) => {
    if (!rec || !rec.id) return;
    if (rec.transfert) {
      setNotice({ tone: 'info', text: `L’OM « ${missionOf(rec) || rec.id} » a été transférée via la colonne « Gestion des frais » (devis / remboursements).` });
      return;
    }
    if (linkedDepenseOf(rec)) {
      setNotice({ tone: 'info', text: `L’OM « ${missionOf(rec) || rec.id} » est déjà transféré dans Dépenses › OM.` });
      return;
    }
    if (!isSuper) return;
    let recetteId = rec.recetteId && recettes.some((r) => r.id === rec.recetteId) ? rec.recetteId : '';
    let recetteObj = recetteId ? (recettes.find((r) => r.id === recetteId) || null) : null;
    /* Catégorie de la nouvelle dépense OM : celle de l’OM, ou — si absente —
       le type de la ligne imputée (jamais « Fonctionnement » par défaut : un
       OM porté par une ligne « Investissement » ne doit pas devenir une
       dépense « Fonctionnement »). Si l’OM est classé dans un type qui ne
       correspond pas à sa ligne mais qu’une fiche homonyme du bon type
       existe, la nouvelle dépense y est réimputée (cohérence Recettes). */
    let categorie = txt(pick(rec, ['categorie']));
    if (!categorie && recetteObj) categorie = txt(recetteObj.type);
    if (recetteObj && categorie && !sameCatType(categorie, recetteObj.type)) {
      const twin = findRecetteTwin(recettes, recetteObj, categorie);
      if (twin) {
        recetteObj = twin;
        recetteId = twin.id;
      }
    }
    const patch = {
      type: 'om',
      omId: rec.id,
      description: txt(missionOf(rec)),
      demandeur: txt(demandeurOf(rec)),
      destination: txt(pick(rec, ['destination', 'ville'])),
      categorie: categorie || 'Fonctionnement',
      classification: 'Mission',
      ligneBudgetaire: recetteObj
        ? txt(recetteObj.ligne)
        : txt(pick(rec, ['ligneBudgetaire', 'ligne'])),
      recetteId,
      montant: parseNum(rec.coutTotal),
      fraisPort: null,
      dateDemande: isoOf(rec.dateDemande) || isoOf(rec.dateMission),
      dateMission: isoOf(pick(rec, ['dateMission', 'dateDebut'])),
      dateRetour: isoOf(rec.dateRetour),
      fournisseur: '',
      numDevis: '', numDevisUrl: '', numSIFAC: '', dateBC: '', numBC: '', numBCUrl: '',
      dateSignature: '', dateSignatureDevis: '', dateApprobFournisseur: '',
      numFacture: '', numFactureUrl: '',
      omNo: txt(pick(rec, ['numOM', 'numeroOm', 'omNo'])),
      omUrl: txt(pick(rec, ['omUrl', 'lienOm'])),
      suivi: '',
      statut: '',
      nonComptabiliseEnt: false,
      ent: '',
      livraisonComplete: '',
      livraisons: [],
      commentaires: txt(pick(rec, ['commentaires', 'notes'])),
    };
    const created = upsert('depenses', patch, null);
    upsert('om', { depenseId: created && created.id }, rec.id);
    setNotice({
      tone: 'ok',
      text: `OM « ${missionOf(rec) || rec.id} » transféré dans Dépenses › OM (ligne indépendante). Vous pouvez la déplacer vers Achats / PI si besoin.`,
    });
    if (created && created.id && typeof navigate === 'function') {
      navigate('depenses', { kind: 'depense', recordId: created.id });
    }
  };

  const approvedTransferables = useMemo(
    () => om.filter((o) => isOmApproved(pick(o, ['statut'])) && !o.transfert && !linkedDepenseOf(o)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [om, depenses]
  );
  const _transferAllOm = () => {
    if (!approvedTransferables.length) return;
    /* Toutes les lignes de dépense d’un seul coup : `importMany` fait UNE
       seule écriture (contrairement à une boucle d’`upsert`, où seul le
       dernier correctif survivrait — état React). Les OMs sont ensuite
       marqués par UN `updateMany`. */
    const patches = approvedTransferables.map((o) => {
      let recetteId = o.recetteId && recettes.some((r) => r.id === o.recetteId) ? o.recetteId : '';
      let recetteObj = recetteId ? (recettes.find((r) => r.id === recetteId) || null) : null;
      let categorie = txt(pick(o, ['categorie']));
      if (!categorie && recetteObj) categorie = txt(recetteObj.type);
      if (recetteObj && categorie && !sameCatType(categorie, recetteObj.type)) {
        const twin = findRecetteTwin(recettes, recetteObj, categorie);
        if (twin) {
          recetteObj = twin;
          recetteId = twin.id;
        }
      }
      return {
        type: 'om',
        omId: o.id,
        description: txt(missionOf(o)),
        demandeur: txt(demandeurOf(o)),
        destination: txt(pick(o, ['destination', 'ville'])),
        categorie: categorie || 'Fonctionnement',
        classification: 'Mission',
        ligneBudgetaire: recetteObj
          ? txt(recetteObj.ligne)
          : txt(pick(o, ['ligneBudgetaire', 'ligne'])),
        recetteId,
        montant: parseNum(o.coutTotal),
        fraisPort: null,
        dateDemande: isoOf(o.dateDemande) || isoOf(o.dateMission),
        dateMission: isoOf(pick(o, ['dateMission', 'dateDebut'])),
        dateRetour: isoOf(o.dateRetour),
        fournisseur: '',
        numFacture: '', numFactureUrl: '',
        omNo: txt(pick(o, ['numOM', 'numeroOm', 'omNo'])),
        omUrl: txt(pick(o, ['omUrl', 'lienOm'])),
        suivi: '', statut: '',
        nonComptabiliseEnt: false, ent: '',
        livraisonComplete: '', livraisons: [],
        commentaires: txt(pick(o, ['commentaires', 'notes'])),
      };
    });
    const inserted = importMany('depenses', patches);
    const created = (inserted && Array.isArray(inserted.records)) ? inserted.records : [];
    if (created.length) {
      updateMany('om', created
        .filter((d) => d && d.omId)
        .map((d) => ({ id: d.omId, patch: { depenseId: d.id } })));
    }
    setNotice({
      tone: 'ok',
      text: `${approvedTransferables.length} OM accepté${approvedTransferables.length > 1 ? 's' : ''} transféré${approvedTransferables.length > 1 ? 's' : ''} dans Dépenses › OM.`,
    });
  };

  /* ── Décision du directeur : « accepter et transférer » l'OM ──────────────
     Chaque poste « Commande/BC » devient son propre devis dans la page
     « Approbation devis & BC » :
       · poste « complet » (N° devis + lien renseignés) → devis « En attente »
         (affiché « en attente de signature ») ;
       · poste incomplet → devis « En gestion » à compléter (la responsable
         d'achats le complète puis l'envoie pour signature).
     Les postes « Remboursement » migrent vers Dépenses › Remboursements
     (fiche « À corriger »). L'OM transférée n'est plus listée. */
  const doTransferOm = async (rec, mode) => {
    if (!rec || !rec.id || !isSuper) return;
    if (rec.transfert) {
      setNotice({ tone: 'info', text: `L’OM « ${missionOf(rec) || rec.id} » est déjà transférée.` });
      return;
    }
    const summary = omTransferSummary(rec);
    if (!summary.hasCommande && !summary.hasRemboursement) {
      setNotice({ tone: 'warn', text: `Chiffrez au moins un poste de coût avant de transférer l’OM « ${missionOf(rec) || rec.id} ».` });
      return;
    }
    const allReady = summary.commande.length > 0 && summary.commande.every((p) => omPartComplete(rec, p.key));
    if (mode === TRANSFER_MODES.SIGNATURE && !allReady) {
      setNotice({
        tone: 'warn',
        text: `Il manque le N° devis / le lien d’au moins un poste « Commande » de l’OM « ${missionOf(rec) || rec.id} » : utilisez « accepter et transférer pour révision » (les devis manquants partiront « En gestion »).`,
      });
      return;
    }
    if (mode === TRANSFER_MODES.REVISION && allReady) {
      /* Documents déjà complets : on propose plutôt un transfert pour signature. */
      if (window.confirm(`Tous les postes « Commande » de l’OM « ${missionOf(rec) || rec.id} » ont leur N° devis et leur fichier : transférer pour signature ?`)) {
        mode = TRANSFER_MODES.SIGNATURE;
      }
    }
    const meta = targetMetaOf(TRANSFER_TARGETS.Achats.code);
    const label = missionOf(rec) || rec.id;
    const wasApproved = isOmApproved(pick(rec, ['statut']));
    const signatureWay = mode === TRANSFER_MODES.SIGNATURE;
    const confirmLines = [
      signatureWay
        ? `Accepter et transférer l’OM « ${label} » pour signature ?`
        : `Accepter et transférer l’OM « ${label} » pour révision ?`,
      '',
      summary.commande.length
        ? `• ${summary.commande.length} devis dans « Approbation devis & BC » (postes Commande : ${euro.format(summary.commandeTotal)}) — ${signatureWay ? '« en attente de signature »' : 'ceux sans N° devis / fichier partiront « En gestion »'}`
        : '',
      summary.hasRemboursement
        ? `• 1 fiche dans Dépenses › Remboursements (postes Remboursement : ${euro.format(summary.remboursementTotal)}) — badge « À corriger »`
        : '',
      '',
      'Un e-mail prévient la responsable d’achats. L’OM transférée disparaîtra de cette liste.',
    ].filter(Boolean);
    if (!window.confirm(confirmLines.join('\n'))) return;

    let createdDevis = 0; let gestionDevis = 0;
    summary.commande.forEach((part) => {
      const base = devisPatchFromOmPart(rec, part, { cible: meta.code, by: currentName });
      const ready = omPartComplete(rec, part.key);
      /* Le statut du devis suit la complétude du poste : un poste « complet »
         part directement en signature, un poste sans N° devis / fichier part
         « En gestion » pour être complété. */
      base.statut = ready ? base.statut : APPROVAL_GESTION;
      if (!base.transfert) base.transfert = { cible: meta.code, by: currentName, at: Date.now(), depuis: 'om' };
      base.transfert.mode = mode;
      if (ready) {
        base.numDevis = omPartDevisNum(rec, part.key);
        base.fichierUrl = omPartDevisUrl(rec, part.key);
        base.fichierNom = '';
        base.notes = [base.notes, 'Devis complet (N° + fichier) déclaré par le demandeur — en attente de signature.'].filter(Boolean).join(' · ');
      } else {
        gestionDevis += 1;
        base.notes = [base.notes, '⚠️ À compléter avant signature : N° devis et fichier du devis (poste « Commande »).'].filter(Boolean).join(' · ');
      }
      const saved = upsert('devisBc', base, null);
      if (saved && saved.id) createdDevis += 1;
    });
    let reimbId = '';
    if (summary.hasRemboursement) {
      const saved = upsert('reimbursements', reimbPatchFromOm(rec, summary.remboursement, { cible: meta.code, by: currentName }), null);
      if (saved && saved.id) reimbId = saved.id;
    }
    upsert('om', {
      ...(!wasApproved ? { statut: 'Acceptée', statutChangedBy: currentName, statutChangedAt: Date.now() } : {}),
      transfert: {
        cible: meta.code,
        by: currentName,
        at: Date.now(),
        mode,
        devisCount: createdDevis,
        reimbId,
      },
    }, rec.id);
    /* Pas de notification « accepté » séparée ici : quand l'OM n'était pas
       encore décidée, l'e-mail de transfert ci-dessous annonce déjà
       l'acceptation (« acceptée … ») à la responsable d'achats. Un avis
       supplémentaire doublerait l'e-mail (deux messages partaient au lieu
       d'un) et prêtait à confusion — surtout en révision, où les devis
       repartent « En gestion » et ne sont PAS encore approuvés. */
    const mailLines = [
      signatureWay
        ? `L’OM « ${label} » a été acceptée et transmise pour signature.`
        : `L’OM « ${label} » a été acceptée et transmise pour révision : complétez les devis « En gestion » (N° devis et fichier) dans « Approbation devis & BC », puis envoyez-les pour signature.`,
      `Demandeur : ${txt(demandeurOf(rec)) || '—'}`,
      `Destination : ${txt(pick(rec, ['destination', 'ville'])) || '—'}`,
      summary.commande.length
        ? `Postes « Commande » (${createdDevis} devis dans « Approbation devis & BC »${gestionDevis ? `, dont ${gestionDevis} « En gestion »` : ' — en attente de signature'}) : ${summary.commande.map((p) => `${p.label} ${euro.format(p.montant)}`).join(' · ')}`
        : '',
      summary.hasRemboursement
        ? `Postes « Remboursement » (fiche créée dans Dépenses › Remboursements, badge « À corriger ») : ${summary.remboursement.map((p) => `${p.label} ${euro.format(p.montant)}`).join(' · ')}`
        : '',
      `Décision prise par : ${currentName || 'directeur'}.`,
    ].filter(Boolean);
    const res = await sendAdminMail({
      to: cibleEmailsOf(personnel, meta.code),
      subject: `[Lab Workspace] OM « ${label} » ${signatureWay ? 'transmise pour signature' : 'acceptée — devis à compléter'}`,
      text: mailBodyText(mailLines),
    });
    const mailSummary = summarizeMail(res, `${meta.title} notifié`);
    const doneText = `OM « ${label} » ${signatureWay ? 'acceptée et transmise pour signature' : 'acceptée — devis « En gestion » créés'} : ${createdDevis} devis dans « Approbation devis & BC »${reimbId ? ' + 1 fiche Remboursement dans Dépenses › Remboursements' : ''}. ${mailSummary.text}`;
    setNotice({
      tone: res && res.ok ? 'ok' : 'warn',
      text: doneText,
      mailto: mailSummary.mailto || undefined,
      consoleUrl: mailSummary.consoleUrl || undefined,
    });
    if (createdDevis && typeof navigate === 'function') navigate('devisBc');
  };

  /* ── Transfert DIRECT d’un OM vers Dépenses › Remboursements ─────────────
     Bouton « 💸 Remb. » porté par chaque OM prévu / souhaité (superutilisateur).
     Circuit « frais avancés » : TOUS les postes chiffrés deviennent des postes
     « Remboursement » et UNE fiche du registre dédié est créée (badge
     « À corriger », comme depuis la page Recettes). L’OM est acceptée au passage
     puis marquée transférée (`remboursementsSeuls`) : elle disparaît de cette
     liste et son montant n’est plus compté dans « OM prévus » (pages Recettes /
     Budget) — il passe dans la colonne « Remboursements », déduite du solde de
     la ligne budgétaire. */
  const transferOmToRemb = (rec) => {
    if (!rec || !rec.id || !isSuper) return;
    const label = missionOf(rec) || rec.id;
    /* OM déjà transmise pour signature (des devis existent) : basculer ses
       postes en remboursement laisserait ces devis orphelins dans
       « Approbation devis & BC » — on l’explique au lieu de le faire
       silencieusement. */
    if (rec.transfert && !rec.transfert.remboursementsSeuls) {
      setNotice({
        tone: 'warn',
        text: `L’OM « ${label} » a déjà été transmise pour signature (devis / BC en cours) : son remboursement se gère depuis « Approbation devis & BC » et la fiche Remboursement créée à cette occasion.`,
      });
      return;
    }
    const already = reimbursements
      .find((x) => x && txt(x.sourceKind) === 'om' && txt(x.sourceId) === rec.id) || null;
    if (already) {
      setNotice({ tone: 'ok', text: `L’OM « ${label} » est déjà transférée dans Dépenses › Remboursements.` });
      return;
    }
    const summary = omTransferSummary(rec);
    if (!summary.parts.length) {
      setNotice({ tone: 'warn', text: `Chiffrez au moins un poste de coût avant de transférer l’OM « ${label} » vers les remboursements.` });
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
    /* Tous les postes deviennent « Remboursement » : aucun ne reste compté
       « OM prévu » (sinon le montant serait compté deux fois). */
    const partMode = { ...(rec.partMode || {}) };
    summary.parts.forEach((p) => { partMode[p.key] = 'reimb'; });
    const saved = upsert('reimbursements', reimbPatchFromOm(rec, summary.parts, { cible, by: currentName }), null);
    upsert('om', {
      ...(isOmApproved(pick(rec, ['statut']))
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
    }, rec.id);
    setNotice({
      tone: 'ok',
      text: `OM « ${label} » transférée vers Dépenses › Remboursements (fiche « À corriger », ${euro.format(total)}).`,
    });
  };

  const columns = [
    {
      key: 'statut', label: 'Statut', filter: 'facet',
      value: (r) => pick(r, ['statut']) || 'En attente',
      display: (r) => {
        const v = pick(r, ['statut']) || 'En attente';
        if (!isSuper) {
          return (
            <span className="inline-flex items-center gap-1.5" title="Statut — modification réservée au superutilisateur">
              <StatutPill value={v} />
              <span className="text-[10px] opacity-60">🔒</span>
            </span>
          );
        }
        return (
          <select
            value={v}
            onChange={(e) => quickStatut(r, e.target.value)}
            title="Statut (approbation réservée au superutilisateur : En attente / Acceptée / Test / Refusée / Terminée)"
            className={`inline-block max-w-[180px] text-[10px] font-black uppercase rounded-full border pl-2 pr-1 py-0.5 outline-none cursor-pointer ${omStatutTone(v)}`}
          >
            <option value="">— Sans statut —</option>
            {omStatutOptions.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        );
      },
    },
    ...omColumns(recettes).filter((c) => c.key !== 'statut'),
    {
      key: 'gestion', label: 'Gestion des frais', filter: 'none', filterable: false, sortable: false,
      value: (r) => {
        const s = omStatusByKey.get(r.id);
        return `${r.transfert ? `transmis ${txt(r.transfert.cible)} ` : ''}${s && s.pending ? `${s.pending} en attente` : ''}${s && s.allResolved ? 'soldé' : ''}`.trim();
      },
      display: (r) => {
        const approved = isOmApproved(pick(r, ['statut']));
        const inTest = isOmTest(pick(r, ['statut']));
        const pendingDecision = String(pick(r, ['statut']) || 'En attente').trim() === 'En attente';
        const st = omStatusByKey.get(r.id);
        const transferred = !!r.transfert;
        const metaT = r.transfert ? targetMetaOf(r.transfert.cible) : null;
        const readyAll = !omTransferSummary(r).commande.some((p) => !omPartComplete(r, p.key));
        const chip = (p) => {
          if (p.mode === 'bc') {
            if (p.devis && isDevisGestion(p.devis)) return <span className="text-orange-600 whitespace-nowrap" title="Devis « En gestion » : N° devis / fichier à compléter dans « Approbation devis & BC »">… en gestion</span>;
            if (p.state === 'bc-signe') return <span className="text-emerald-600 font-black whitespace-nowrap" title="BC signé (date de signature BC dans Dépenses)">✓ BC signé</span>;
            if (p.state === 'bc-en-cours') return <span className="text-blue-600 whitespace-nowrap" title="Devis signé, BC non signé">… BC à signer</span>;
            if (p.state === 'bc-devis-attente') return <span className="text-amber-600 whitespace-nowrap" title="Devis en attente de signature dans « Approbation devis & BC »">… en attente de signature</span>;
            return <span className="text-slate-300 whitespace-nowrap">devis à créer</span>;
          }
          if (p.fiche) {
            return p.fiche.aCorriger
              ? <span className="text-amber-600 whitespace-nowrap" title="Montants estimés à corriger une fois les justificatifs réels connus">… À corriger</span>
              : <span className="text-emerald-600 font-black whitespace-nowrap" title="Fiche Remboursement corrigée">✓ remboursé</span>;
          }
          return <span className="text-slate-300 whitespace-nowrap">fiche à créer</span>;
        };
        const transferButton = (mode, tone, label, hint, disabled = false) => (
          <button
            type="button"
            disabled={disabled}
            onClick={() => doTransferOm(r, mode)}
            title={hint}
            className={`text-left text-[11px] font-black px-2 py-1 rounded-lg border whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${tone}`}
          >
            {label}
          </button>
        );
        /* Transfert « frais avancés » : TOUS les postes de l’OM basculent en
           remboursement (1 fiche dans Dépenses › Remboursements, badge
           « À corriger », montant déduit du solde de la ligne budgétaire). */
        const reimbButton = (disabled = false) => (
          <button
            type="button"
            disabled={disabled}
            onClick={() => transferOmToRemb(r)}
            title={disabled
              ? 'Chiffrez au moins un poste de coût (Transport · Logement · Repas · Inscription) pour transférer l’OM en remboursement.'
              : 'Transférer l’OM en remboursement : tous les postes deviennent « Remboursement » — 1 fiche « À corriger » dans Dépenses › Remboursements, montant déduit du solde de la ligne budgétaire'}
            className="text-left text-[11px] font-black px-2 py-1 rounded-lg border whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed transition-colors border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
          >
            💸 Remb.
          </button>
        );
        return (
          <div className="min-w-[230px] max-w-[320px] flex flex-col gap-1">
            {transferred && metaT ? (
              <div className="flex items-center flex-wrap gap-1.5">
                <span className="text-[10px] font-semibold text-slate-500 whitespace-nowrap" title={`Transférée par ${txt(r.transfert.by) || '—'} le ${r.transfert.at ? new Date(r.transfert.at).toLocaleDateString('fr-FR') : '—'}`}>{metaT.icon} {metaT.title}</span>
                {st && st.pending > 0 ? (
                  <span className="inline-block text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 whitespace-nowrap" title="Postes non soldés : devis en attente de signature / « En gestion », BC à signer, remboursement à corriger">⏳ en cours</span>
                ) : st && st.allResolved ? (
                  <span className="inline-block text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 whitespace-nowrap" title="Tous les postes soldés — l'OM disparaît de la liste (case « Afficher les transférées »)">✓ Soldé</span>
                ) : null}
              </div>
            ) : null}
            {!transferred && inTest ? (
              <div className="flex items-center gap-1.5">
                <span
                  className="inline-block text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 whitespace-nowrap"
                  title="« Test » : OM comptée dans les prévisions « OM prévus » de la page Recettes, mais PAS acceptée — aucun transfert tant que le statut ne passe pas à « Acceptée »."
                >🧪 en test</span>
              </div>
            ) : null}
            {!transferred && isSuper && !linkedDepenseOf(r) && (pendingDecision || approved) ? (
              <div className="flex flex-col gap-1">
                <span className="text-[9px] uppercase font-black text-slate-400">
                  {approved ? 'Transférer' : 'Accepter & transférer'}
                </span>
                <div className="flex items-center gap-1 flex-wrap">
                  {transferButton(
                    TRANSFER_MODES.SIGNATURE,
                    'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
                    approved ? '📨 Pour signature' : '✓ Signature',
                    'Tous les postes « Commande » ont un N° devis + fichier : créés « en attente de signature »',
                    !readyAll,
                  )}
                  {transferButton(
                    TRANSFER_MODES.REVISION,
                    'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100',
                    approved ? '🔧 Pour révision' : '✎ Révision',
                    'Les postes sans N° devis / fichier partent « En gestion » pour être complétés',
                  )}
                  {reimbButton(!(st && st.parts.length))}
                </div>
              </div>
            ) : null}
            {!transferred && !approved && !pendingDecision && !inTest ? <span className="text-[10px] text-slate-300">OM refusée</span> : null}
            {st && st.parts.length ? st.parts.map((p) => (
              <div key={p.key} className="flex items-center gap-1.5 text-[10px] leading-tight">
                <span className="shrink-0">{p.icon}</span>
                <span className="text-slate-500 shrink-0">{p.label}</span>
                <span className="text-[10px] text-slate-400 tabular-nums whitespace-nowrap">{p.montant !== null && p.montant !== undefined ? euro.format(p.montant) : '—'}</span>
                {transferred ? chip(p) : <span className={`text-[9px] font-black uppercase px-1 rounded whitespace-nowrap ${p.mode === 'bc' ? 'text-blue-600 bg-blue-50' : 'text-amber-600 bg-amber-50'}`}>{p.mode === 'bc' ? 'BC' : 'Remb.'}</span>}
              </div>
            )) : null}
            {st && !st.hasCosts ? <span className="text-[10px] text-slate-300">aucun poste chiffré</span> : null}
          </div>
        );
      },
    },
    {
      key: 'actions', label: '', filter: 'none', filterable: false,
      value: () => '',
      display: (r) => {
        const approved = isOmApproved(pick(r, ['statut']));
        const linked = linkedDepenseOf(r);
        return (
          <div className="flex items-center gap-1 whitespace-nowrap">
            {approved && r.transfert ? (
              <button
                type="button"
                title="Les frais ont été transférés (devis / remboursements) — ouvrir la page « Approbation devis & BC » pour les compléter et les faire signer."
                onClick={() => { if (typeof navigate === 'function') navigate('devisBc'); }}
                className="text-[11px] font-black px-2 py-1 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
              >→ Devis & BC</button>
            ) : linked ? (
              <button
                type="button"
                title="Déjà transféré dans Dépenses › OM — ouvrir la ligne"
                onClick={() => {
                  if (typeof navigate === 'function') navigate('depenses', { kind: 'depense', recordId: linked.id });
                }}
                className="text-[11px] font-black px-2 py-1 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
              >✓ Dans Dépenses</button>
            ) : null}
            <button
              type="button" title="Modifier l’ordre de mission"
              onClick={() => setModal({ mode: 'edit', rec: r })}
              className="text-[11px] font-black px-2 py-1 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
            >✏️ Modifier</button>
            <button
              type="button" title="Supprimer l’ordre de mission"
              onClick={() => onRemove(r)}
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
          {visibleRows.length} demande{visibleRows.length > 1 ? 's' : ''} de mission à suivre
          ({myOm.length} OM prévu{myOm.length > 1 ? 's' : ''} / souhaité{myOm.length > 1 ? 's' : ''} au total{!isSuper ? ' — vos demandes uniquement' : ''}
          {hiddenSoldes > 0 ? ` — ${hiddenSoldes} transférée${hiddenSoldes > 1 ? 's' : ''} masquée${hiddenSoldes > 1 ? 's' : ''}` : ''}) · les colonnes sont
          triables (en-têtes) et filtrables (bouton « Filtres »).
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <label
            className="flex items-center gap-1.5 text-[10px] font-black text-slate-500 cursor-pointer select-none bg-white border border-slate-200 rounded-xl px-3 py-2 hover:border-slate-300 whitespace-nowrap"
            title="Une OM acceptée et transférée (pour signature ou pour révision) disparaît de la liste ; cochez pour la réafficher."
          >
            <input type="checkbox" className="accent-cyan-600" checked={showSoldes} onChange={(e) => setShowSoldes(e.target.checked)} />
            Afficher les transférées
          </label>
          {isSuper && (
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              title="Importer des OM depuis la feuille Google Sheets (feuille « ENT / Prix / Description ») — action du superutilisateur"
              className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-bold text-sm px-4 py-2 rounded-xl shadow-sm transition-colors flex items-center gap-1.5"
            >
              <span className="text-base leading-none">📥</span> Importer
            </button>
          )}
          <button
            type="button"
            onClick={() => setModal({ mode: 'new' })}
            title="Saisir un nouvel ordre de mission à la main"
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm px-4 py-2 rounded-xl shadow-sm transition-colors flex items-center gap-1.5"
          >
            <span className="text-base leading-none">＋</span> Ajouter un OM
          </button>
        </div>
      </div>

      {notice && <Notice tone={notice.tone} text={notice.text} mailto={notice.mailto} consoleUrl={notice.consoleUrl} onClose={() => setNotice(null)} />}

      <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-2.5 text-[11px] text-slate-600 leading-relaxed">
        <b>OM prévus / souhaités :</b> chaque OM décrit une mission à préparer. Chaque membre ne voit que ses propres OM
        (demandeur = lui-même, verrouillé) — le superutilisateur, qui accepte et transfère, voit tout. La <b>première colonne « Statut »</b>
        (En attente / Acceptée / Test / Refusée / Terminée) n’est modifiable que par le superutilisateur. Le statut <b>« Test »</b> compte l’OM
        dans les prévisions <b>« OM prévus »</b> de la page Recettes sans l’accepter réellement (aucune notification, aucun transfert). Dans le formulaire,
        chaque <b>poste de coût</b> est étiqueté <b>« BC »</b> (commandé par le laboratoire : devis dans « Approbation
        devis & BC ») ou <b>« Remb. »</b> (frais avancés par le membre puis remboursés : fiche dans Dépenses ›
        Remboursements). Pour une demande en attente, la colonne <b>« Gestion des frais »</b> propose au directeur
        <b>« ✓ Signature »</b> ou <b>« ✎ Révision »</b> : l'OM est acceptée, des devis « en attente de signature »
        (postes complets) ou « En gestion » (à compléter) sont créés par poste « Commande », et la fiche Remboursement
        « À corriger » pour les postes « Remb. ». Le bouton <b>« 💸 Remb. »</b> transfère quant à lui <b>tous les postes</b>
        en remboursement (frais avancés : 1 fiche dans Dépenses › Remboursements, montant déduit du solde). L’OM transférée
        <b>disparaît de la liste</b> et son montant est suivi dans les colonnes <b>« OM en signature / signé »</b> de la page
        Recettes jusqu'à la signature des BC.
        « ✏️ Modifier » ouvre la fiche, « 🗑️ » supprime, « 📥 Importer » rejoue la feuille « ENT / Prix / Description » du classeur.
      </div>

      {visibleRows.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-10 text-center">
          <div className="text-4xl mb-2">✈️</div>
          <p className="font-black text-slate-700">
            {isSuper ? 'Aucun OM prévu / souhaité pour le moment' : 'Aucun OM prévu / souhaité à votre nom'}
          </p>
          <p className="text-sm text-slate-400 mt-1 mb-4">
            {isSuper ? (
              hiddenSoldes > 0 ? (
                <>Toutes les OM affichables ont été transférées (pour signature ou pour révision). Cochez
                  « Afficher les transférées » pour les retrouver dans la liste.</>
              ) : (
                <>Utilisez « ＋ Ajouter un OM » pour saisir une mission à la main (dates, coûts, statut…). Chaque OM en
                  attente peut être acceptée puis transférée dans « Approbation devis & BC » : <b>pour signature</b>
                  (postes complets) ou <b>pour révision</b> (devis « En gestion » à compléter). Ou « 📥 Importer » pour
                  rejouer la feuille « ENT / Prix / Description » du classeur.</>
              )
            ) : (
              <>Chaque membre ne voit que ses propres OM — ajoutez votre première mission (dates, destination, coûts
                par poste BC / Remboursement) : le N° devis et le lien de chaque poste « Commande » ne sont pas
                obligatoires pour soumettre.</>
            )}
          </p>
          <button
            type="button"
            onClick={() => setModal({ mode: 'new' })}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm px-5 py-2.5 rounded-xl shadow-sm transition-colors"
          >
            <span className="text-base leading-none">＋</span> Ajouter un OM
          </button>
        </div>
      ) : (
        <SmartTable
          columns={columns}
          rows={visibleRows}
          focusRowKey={focusRow}
          onFocusDone={() => setFocusRow(null)}
          minWidth="1560px"
          searchPlaceholder="Rechercher mission, demandeur, destination, n° OM…"
          emptyLabel="Aucun ordre de mission pour le moment"
          noMatchLabel="Aucun ordre de mission ne correspond aux filtres."
        />
      )}

      {modal && (
        <OmModal
          rec={modal.mode === 'edit' ? modal.rec : null}
          recettes={recettes}
          demandeurNames={demandeurNames}
          statusOptions={omStatutOptions}
          canDecide={isSuper}
          currentUser={currentUser}
          meName={currentName}
          mePersonId={mePersonId}
          personnel={personnel}
          lockDemandeurToMe={!isSuper}
          onApproved={notifyApproved}
          onCancel={() => setModal(null)}
          onSave={onSave}
        />
      )}

      {importOpen && <AdminImportModal kind="om" onClose={() => setImportOpen(false)} />}
    </div>
  );
};