/* =========================================================================
   src/administration/omPage.jsx
   Page « OM prévus / souhaités » — ordres de mission à préparer (CRUD complet).

   Chaque OM peut contenir :
     · description (mission) — obligatoire
     · demandeur · destination · n° OM (référence)
     · ligne budgétaire liée (recette)
     · dates : demande / mission (départ) / retour
     · statut : En attente / Acceptée / Refusée / Terminée — le changement de
       statut (approbation) est réservé au superutilisateur, et une fois l’OM
       « Acceptée » un e-mail prévient le superutilisateur et le(s) gestionnaire(s)
     · coût estimé ou exact : transport · logement · repas · inscription
       (total recalculé automatiquement)
     · commentaires

   La liste se remplit via l’assistant d’import (feuille « ENT / Prix /
   Description » du classeur Google Sheets) ou à la main : bouton
   « ＋ Ajouter un OM » (et édition / suppression par ligne).
   ========================================================================= */
import React, { useEffect, useMemo, useState } from 'react';
import { useAdmin } from './AdminContext';
import { SmartTable } from './smartTable';
import { AdminImportModal } from './adminImportModal';
import { omColumns } from './collectionPages';
import { OM_COST_STATUSES, OM_STATUSES } from './adminSchema';
import { parseEuroAmount } from './importUtils';
import { findRecetteTwin, sameCatType } from './recetteLink';
import {
  sendAdminMail, personnelEmailsMatching, superuserEmailsOf, mergeEmails,
  summarizeMail, mailBodyText,
} from './emailNotify';

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
const demandeurOf = (r) => pick(r, ['demandeur', 'porteur', 'nom', 'name']);
const missionOf = (r) => pick(r, ['description', 'intitule', 'motif']);
const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

/* Approbation d’un OM : l’état « Acceptée » correspond à la décision positive
   (les valeurs d’import anglaises restent reconnues). */
const isOmApproved = (raw) =>
  /accept/i.test(String(raw || '').normalize('NFD').replace(/[\u0300-\u036f]/g, ''));

/* Teinte + pastille du statut affiché en PREMIÈRE colonne. */
const omStatutTone = (v) => {
  const s = txt(v).toLowerCase();
  if (/(accept)/.test(s)) return 'bg-emerald-50 border-emerald-200 text-emerald-700';
  if (/(refus)/.test(s)) return 'bg-red-50 border-red-200 text-red-600';
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

const NOTICE_TONES = {
  ok: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  info: 'bg-blue-50 border-blue-200 text-blue-700',
  warn: 'bg-amber-50 border-amber-200 text-amber-700',
};

const Notice = ({ tone, text, onClose, mailto }) => (
  <div className={`rounded-xl border px-4 py-2.5 text-xs font-semibold flex items-center justify-between gap-3 ${NOTICE_TONES[tone] || NOTICE_TONES.info}`}>
    <span className="min-w-0">{text}</span>
    <span className="flex items-center gap-3 shrink-0">
      {mailto && (
        <a href={mailto} className="font-black text-blue-700 underline whitespace-nowrap" title="Ouvrir votre messagerie pour envoyer l’e-mail">✉ Ouvrir ma messagerie</a>
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
const OmModal = ({ rec, recettes, demandeurNames, statusOptions, onCancel, onSave, canDecide = false, currentUser, onApproved }) => {
  const editing = !!rec;
  const [draft, setDraft] = useState(() => ({
    description: txt(rec && missionOf(rec)),
    demandeur: txt(rec && demandeurOf(rec)),
    destination: txt(rec && pick(rec, ['destination', 'ville'])),
    numOM: txt(rec && pick(rec, ['numOM', 'numeroOm', 'omNo'])),
    recetteId: (rec && rec.recetteId) || '',
    ligneBudgetaire: txt(rec && pick(rec, ['ligneBudgetaire', 'ligne'])),
    statut: txt(rec && pick(rec, ['statut'])) || 'En attente',
    coutStatut: txt(rec && pick(rec, ['coutStatut', 'prix'])) || 'Estimé',
    dateDemande: isoOf(rec && pick(rec, ['dateDemande'])),
    dateMission: isoOf(rec && pick(rec, ['dateMission', 'dateDebut'])),
    dateRetour: isoOf(rec && pick(rec, ['dateRetour'])),
    commentaires: txt(rec && pick(rec, ['commentaires', 'notes'])),
    ...COST_INPUTS.reduce((acc, c) => { acc[c.key] = numToInput(rec && costValue(rec, c)); return acc; }, {}),
  }));
  const [error, setError] = useState('');

  const set = (key) => (e) => setDraft((d) => ({ ...d, [key]: e.target.value }));

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
    };
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
              <Field label="Demandeur">
                <input
                  className={MODAL_INPUT} value={draft.demandeur} onChange={set('demandeur')} list="om-demandeurs"
                  placeholder="ex. Marie Curie"
                />
                <datalist id="om-demandeurs">
                  {(demandeurNames || []).map((n) => <option key={n} value={n} />)}
                </datalist>
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
              <Field label="Date de demande">
                <input type="date" className={MODAL_INPUT} value={draft.dateDemande} onChange={set('dateDemande')} />
              </Field>
              <Field label="Départ (mission)">
                <input type="date" className={MODAL_INPUT} value={draft.dateMission} onChange={set('dateMission')} />
              </Field>
              <Field label="Retour">
                <input type="date" className={MODAL_INPUT} value={draft.dateRetour} onChange={set('dateRetour')} />
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3 items-end">
              <Field label="Statut">
                {canDecide ? (
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
              {COST_INPUTS.map((c) => (
                <Field key={c.key} label={`${c.icon} ${c.label}`}>
                  <input
                    className={MODAL_INPUT} inputMode="decimal" value={draft[c.key]} onChange={set(c.key)}
                    placeholder="0,00"
                  />
                </Field>
              ))}
            </div>
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
    data, settings, upsert, remove, importMany, updateMany,
    currentUser, access, operators, navigate, focus, clearFocus,
  } = useAdmin();
  const om = useMemo(() => (Array.isArray(data.om) ? data.om : []), [data.om]);
  const depenses = useMemo(() => (Array.isArray(data.depenses) ? data.depenses : []), [data.depenses]);
  const recettes = useMemo(() => (Array.isArray(data.recettes) ? data.recettes : []), [data.recettes]);
  const personnel = useMemo(() => (Array.isArray(data.personnel) ? data.personnel : []), [data.personnel]);

  const [modal, setModal] = useState(null); // null | { mode: 'new' } | { mode: 'edit', rec }
  const [importOpen, setImportOpen] = useState(false);
  const [notice, setNotice] = useState(null); // { tone, text, mailto? }
  /* OM « cible » d’une navigation inter-page (page Recettes › survol d’un OM
     prévu) : on surligne l’OM correspondant dans le tableau. */
  const [focusRow, setFocusRow] = useState(null);

  useEffect(() => {
    if (!focus || focus.pageId !== 'om') return;
    const rid = focus.recordId;
    if (rid && om.some((o) => o.id === rid)) setFocusRow(rid);
    if (typeof clearFocus === 'function') clearFocus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  /* L’approbation (changement de statut) est réservée au superutilisateur. */
  const isSuper = !!access.isSuperuser;
  const currentName = txt((access.profile && access.profile.person && access.profile.person.nom)
    || (currentUser && currentUser.name));

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
    return set;
  }, [settings, om]);

  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  /* Suggestions « demandeur » : déjà saisis dans les OM + utilisateur courant. */
  const demandeurNames = useMemo(() => {
    const set = new Set();
    om.forEach((r) => {
      const d = demandeurOf(r);
      if (d) set.add(d);
    });
    if (currentUser && txt(currentUser.name)) set.add(txt(currentUser.name));
    return [...set].sort((a, b) => a.localeCompare(b, 'fr'));
  }, [om, currentUser]);

  /* Les plus récentes d’abord (par départ, sinon date de demande). */
  const rows = useMemo(() => [...om].sort((a, b) => {
    const da = isoOf(pick(a, ['dateMission', 'dateDebut'])) || isoOf(a.dateDemande);
    const db = isoOf(pick(b, ['dateMission', 'dateDebut'])) || isoOf(b.dateDemande);
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return db.localeCompare(da);
  }), [om]);

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
  };

  const onRemove = (rec) => {
    if (!rec || !rec.id) return;
    const label = missionOf(rec) || rec.id;
    if (!window.confirm(`Supprimer l’ordre de mission « ${label} » ?\nCette action est définitive.`)) return;
    remove('om', rec.id);
    setNotice({ tone: 'ok', text: `Ordre de mission « ${label} » supprimé.` });
  };

  /* ── Transfert d’un OM « Acceptée » vers la page Dépenses › onglet OM ──
     Le transfert crée une ligne de type « om » DANS la collection depenses :
     elle devient un enregistrement indépendant (édition, facture, paiement,
     déplacement entre Achats / PI / OM). La collection om — les demandes de
     mission « prévues / souhaitées » — n’est pas touchée. */
  const linkedDepenseOf = (rec) =>
    (Array.isArray(depenses) ? depenses : []).find((d) => d && d.omId && d.omId === rec.id) || null;

  const transferOmToDepenses = (rec) => {
    if (!rec || !rec.id) return;
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
    () => om.filter((o) => isOmApproved(pick(o, ['statut'])) && !linkedDepenseOf(o)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [om, depenses]
  );
  const transferAllOm = () => {
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
            title="Statut (approbation réservée au superutilisateur)"
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
      key: 'actions', label: '', filter: 'none', filterable: false,
      value: () => '',
      display: (r) => {
        const approved = isOmApproved(pick(r, ['statut']));
        const linked = linkedDepenseOf(r);
        return (
          <div className="flex items-center gap-1 whitespace-nowrap">
            {approved ? (
              linked ? (
                <button
                  type="button"
                  title="Déjà transféré dans Dépenses › OM — ouvrir la ligne"
                  onClick={() => {
                    if (typeof navigate === 'function') navigate('depenses', { kind: 'depense', recordId: linked.id });
                  }}
                  className="text-[11px] font-black px-2 py-1 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
                >✓ Dans Dépenses</button>
              ) : isSuper ? (
                <button
                  type="button"
                  title="Créer la dépense liée dans la page Dépenses › onglet OM (ligne indépendante de ce tableau)"
                  onClick={() => transferOmToDepenses(r)}
                  className="text-[11px] font-black px-2 py-1 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-colors"
                >→ Dépenses</button>
              ) : null
            ) : (
              <span title="L’OM doit être « Acceptée » avant de pouvoir être transféré en dépense" className="text-[10px] text-slate-300">↦ après acceptation</span>
            )}
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
          {om.length} demande{om.length > 1 ? 's' : ''} de mission (OM prévus / souhaités) · les colonnes sont
          triables (en-têtes) et filtrables (bouton « Filtres »).
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          {isSuper && approvedTransferables.length > 0 && (
            <button
              type="button"
              onClick={() => {
                if (!window.confirm(`Transférer ${approvedTransferables.length} OM accepté${approvedTransferables.length > 1 ? 's' : ''} dans Dépenses › onglet OM ?\nChaque OM devient une ligne de dépense indépendante (type OM).`)) return;
                transferAllOm();
              }}
              title="Créer la ligne de dépense OM de chaque OM « Acceptée » pas encore transféré"
              className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 font-bold text-sm px-4 py-2 rounded-xl shadow-sm transition-colors flex items-center gap-1.5"
            >
              <span className="text-base leading-none">⬇</span> Transférer {approvedTransferables.length} OM accepté{approvedTransferables.length > 1 ? 's' : ''}
            </button>
          )}
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            title="Importer des OM depuis la feuille Google Sheets (feuille « ENT / Prix / Description »)"
            className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-bold text-sm px-4 py-2 rounded-xl shadow-sm transition-colors flex items-center gap-1.5"
          >
            <span className="text-base leading-none">📥</span> Importer
          </button>
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

      {notice && <Notice tone={notice.tone} text={notice.text} mailto={notice.mailto} onClose={() => setNotice(null)} />}

      <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-2.5 text-[11px] text-slate-600 leading-relaxed">
        <b>OM prévus / souhaités :</b> chaque OM décrit une mission à préparer (dates, demandeur, destination,
        ligne budgétaire, coûts estimés ou exacts). La <b>première colonne « Statut »</b>
        (En attente / Acceptée / Refusée / Terminée) n’est modifiable que par le superutilisateur ;
        une fois l’OM <b>Acceptée</b>, un e-mail prévient la gestionnaire. Le bouton
        <b>« → Dépenses »</b> (ou « ⬇ Transférer… ») crée alors une <b>ligne de type « OM » dans la page
        Dépenses › onglet OM</b> : ce tableau-là est <b>indépendant</b> — il ne rejoue pas cette liste, il suit
        la dépense réelle (facture, paiement), que l’on peut déplacer vers « Achats » / « PI ». Le bouton
        <b>« ＋ Ajouter un OM »</b> permet une saisie manuelle complète ; <b>« ✏️ Modifier »</b> ouvre
        la fiche d’un OM existant et <b>« 🗑️ »</b> le supprime. L’assistant d’import
        (bouton « 📥 Importer ») reste disponible pour rejouer la feuille « ENT / Prix / Description » du classeur.
      </div>

      {om.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-10 text-center">
          <div className="text-4xl mb-2">✈️</div>
          <p className="font-black text-slate-700">Aucun OM prévu / souhaité pour le moment</p>
          <p className="text-sm text-slate-400 mt-1 mb-4">
            Utilisez « ＋ Ajouter un OM » pour saisir une mission à la main (dates, coûts, statut…) — une fois
            l’OM « Acceptée », son bouton « → Dépenses » crée la dépense réelle dans Dépenses › onglet OM.
            Ou « 📥 Importer » pour rejouer la feuille « ENT / Prix / Description » du classeur.
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
          rows={rows}
          focusRowKey={focusRow}
          onFocusDone={() => setFocusRow(null)}
          minWidth="1420px"
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
          onApproved={notifyApproved}
          onCancel={() => setModal(null)}
          onSave={onSave}
        />
      )}

      {importOpen && <AdminImportModal kind="om" onClose={() => setImportOpen(false)} />}
    </div>
  );
};