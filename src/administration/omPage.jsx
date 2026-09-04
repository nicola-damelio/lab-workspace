/* =========================================================================
   src/administration/omPage.jsx
   Page « OM » — ordres de mission (CRUD complet).

   Chaque OM peut contenir :
     · description (mission) — obligatoire
     · demandeur · destination · n° OM (référence)
     · ligne budgétaire liée (recette)
     · dates : demande / mission (départ) / retour
     · statut : En attente / Acceptée / Refusée / Terminée
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

const Notice = ({ tone, text, onClose }) => (
  <div className={`rounded-xl border px-4 py-2.5 text-xs font-semibold flex items-center justify-between gap-3 ${NOTICE_TONES[tone] || NOTICE_TONES.info}`}>
    <span>{text}</span>
    {onClose && (
      <button type="button" onClick={onClose} className="shrink-0 font-black opacity-60 hover:opacity-100" title="Masquer">✕</button>
    )}
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
const OmModal = ({ rec, recettes, demandeurNames, onCancel, onSave }) => {
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
    onSave({
      description,
      demandeur: txt(draft.demandeur),
      destination: txt(draft.destination),
      numOM: txt(draft.numOM),
      recetteId,
      ligneBudgetaire: recetteId
        ? txt((recettes.find((r) => r.id === recetteId) || {}).ligne)
        : (editing ? txt(draft.ligneBudgetaire) : ''),
      statut: txt(draft.statut),
      coutStatut: txt(draft.coutStatut),
      dateDemande: isoOf(draft.dateDemande),
      dateMission: isoOf(draft.dateMission),
      dateRetour: isoOf(draft.dateRetour),
      commentaires: txt(draft.commentaires),
      ...couts,
      coutTotal,
    }, editing && rec.id);
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
              <Field label="Ligne budgétaire liée" hint="La recette sur laquelle l’OM sera imputé.">
                <select className={MODAL_INPUT} value={draft.recetteId} onChange={setRecette}>
                  <option value="">— Aucune ligne budgétaire —</option>
                  {recettes.map((r) => (
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              <Field label="Statut">
                <select className={MODAL_INPUT} value={draft.statut} onChange={set('statut')}>
                  {OM_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
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
  const { data, upsert, remove, currentUser } = useAdmin();
  const om = useMemo(() => (Array.isArray(data.om) ? data.om : []), [data.om]);
  const recettes = useMemo(() => (Array.isArray(data.recettes) ? data.recettes : []), [data.recettes]);

  const [modal, setModal] = useState(null); // null | { mode: 'new' } | { mode: 'edit', rec }
  const [importOpen, setImportOpen] = useState(false);
  const [notice, setNotice] = useState(null); // { tone, text }

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

  const columns = [
    ...omColumns(recettes),
    {
      key: 'actions', label: '', filter: 'none', filterable: false,
      value: () => '',
      display: (r) => (
        <div className="flex items-center gap-1 whitespace-nowrap">
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
      ),
    },
  ];
  return (
    <div className="max-w-full mx-auto flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs font-bold text-slate-400 max-w-2xl">
          {om.length} ordre{om.length > 1 ? 's' : ''} de mission · les colonnes sont
          triables (en-têtes) et filtrables (bouton « Filtres »).
        </p>
        <div className="flex items-center gap-2 flex-wrap">
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

      {notice && <Notice tone={notice.tone} text={notice.text} onClose={() => setNotice(null)} />}

      <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-2.5 text-[11px] text-slate-600 leading-relaxed">
        <b>Fonctionnement :</b> chaque OM décrit une mission (dates, demandeur, destination,
        ligne budgétaire, coûts estimés ou exacts et statut). Le bouton <b>« ＋ Ajouter un OM »</b>
        permet une saisie manuelle complète ; <b>« ✏️ Modifier »</b> ouvre la fiche d’un OM existant
        et <b>« 🗑️ »</b> le supprime. L’assistant d’import (bouton « 📥 Importer ») reste disponible
        pour rejouer la feuille « ENT / Prix / Description » du classeur.
      </div>

      {om.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-10 text-center">
          <div className="text-4xl mb-2">✈️</div>
          <p className="font-black text-slate-700">Aucun ordre de mission pour le moment</p>
          <p className="text-sm text-slate-400 mt-1 mb-4">
            Utilisez « ＋ Ajouter un OM » pour saisir une mission à la main (dates, coûts, statut…)
            ou « 📥 Importer » pour rejouer la feuille « ENT / Prix / Description » du classeur.
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
          onCancel={() => setModal(null)}
          onSave={onSave}
        />
      )}

      {importOpen && <AdminImportModal kind="om" onClose={() => setImportOpen(false)} />}
    </div>
  );
};