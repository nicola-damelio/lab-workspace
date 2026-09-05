/* =========================================================================
   src/administration/collectionAddModal.jsx
   Fenêtre « Ajouter » des collections listées par CollectionPage
   (Questions ouvertes / Hygiène & Sécurité) : saisie manuelle d’un nouvel
   enregistrement, enregistré via `upsert` (même enveloppe d’audit que
   l’assistant d’import). Les statuts viennent des options de la base
   (Paramètres) ; responsable et priorité proposent des suggestions.
   ========================================================================= */
import React, { useState } from 'react';

const txt = (v) => (v === null || v === undefined ? '' : String(v).trim());
const pick = (rec, keys) => {
  for (const k of keys) {
    const v = rec && rec[k];
    if (txt(v)) return v;
  }
  return '';
};
const normalizeDup = (v) =>
  txt(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');

const ADD_INPUT = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500';
const ADD_LABEL = 'block text-[10px] font-black uppercase text-slate-400 tracking-wide mb-1';

const AddField = ({ label, required, children, className = '', hint }) => (
  <div className={className}>
    <label className={ADD_LABEL}>
      {label}
      {required ? <span className="text-red-400"> *</span> : null}
    </label>
    {children}
    {hint ? <div className="text-[10px] text-slate-400 mt-1 leading-snug">{hint}</div> : null}
  </div>
);

const AddSection = ({ icon, title, children }) => (
  <div className="border border-slate-200 rounded-2xl bg-white p-4 shadow-sm">
    <div className="flex items-center gap-2 mb-3">
      <span className="text-sm leading-none">{icon}</span>
      <h3 className="text-xs font-black uppercase tracking-wide text-slate-500">{title}</h3>
    </div>
    {children}
  </div>
);

export const CollectionAddModal = ({
  kind, cfg, existing, statusOptions, responsableOptions, prioriteOptions,
  rec, onCancel, onSave,
}) => {
  const isSicurezza = kind === 'sicurezza';
  const editing = !!rec;
  const title = editing
    ? ((cfg && cfg.editLabel) || (isSicurezza ? 'Modifier la tâche H&S' : 'Modifier la question'))
    : ((cfg && cfg.addLabel) || (isSicurezza ? 'Ajouter une tâche H&S' : 'Ajouter une question'));
  const [draft, setDraft] = useState(() => {
    const r = rec || {};
    return {
      description: txt(pick(r, ['description', 'question'])),
      statut: txt(pick(r, ['statut', 'status'])),
      responsable: txt(pick(r, ['responsable'])),
      priorite: txt(pick(r, ['priorite', 'urgence'])),
      tags: Array.isArray(r.tags) ? r.tags.join(', ') : txt(pick(r, ['tags', 'classification'])),
      commentaires: txt(pick(r, ['commentaires', 'note', 'notes'])),
    };
  });
  const [error, setError] = useState('');
  const set = (key) => (e) => setDraft((d) => ({ ...d, [key]: e.target.value }));

  const submit = () => {
    const description = txt(draft.description);
    if (!description) {
      setError(isSicurezza
        ? 'Merci de décrire la tâche H&S (obligatoire).'
        : 'Merci de décrire la question (obligatoire).');
      return;
    }
    const wanted = normalizeDup(description);
    const exists = !editing && (existing || []).some(
      (r) => normalizeDup(pick(r, ['description', 'question'])) === wanted
    );
    if (exists) {
      setError(isSicurezza
        ? 'Cette tâche existe déjà dans le tableau.'
        : 'Cette question existe déjà dans le tableau.');
      return;
    }
    const tags = draft.tags
      ? txt(draft.tags).split(/[,;]+/).map((s) => s.trim()).filter(Boolean)
      : [];
    const record = {
      description,
      statut: txt(draft.statut),
      responsable: txt(draft.responsable),
      commentaires: txt(draft.commentaires),
    };
    if (isSicurezza) record.priorite = txt(draft.priorite);
    else record.tags = tags;
    onSave(record, editing && rec.id);
  };

  return (
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center p-4"
      style={{ background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(3px)' }}
    >
      <div className="bg-slate-50 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden max-h-[94vh] flex flex-col">
        <div className="px-6 py-4 bg-gradient-to-br from-blue-700 to-indigo-800 text-white flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-black flex items-center gap-2">
              <span className="text-xl" aria-hidden="true">{isSicurezza ? '🛡️' : '❓'}</span>
              {title}
            </h2>
            <p className="text-blue-100 text-xs">
              {isSicurezza
                ? (editing
                  ? 'Tâche d’hygiène & de sécurité : ajustez la description, le statut, la priorité ou le responsable.'
                  : 'Tâche d’hygiène & de sécurité du laboratoire : description, responsable, statut et priorité.')
                : (editing
                  ? 'Question ouverte : ajustez le texte, le statut, le responsable ou les tags.'
                  : 'Question ouverte à suivre : description, responsable, statut et tags.')}
            </p>
          </div>
          <button
            type="button" onClick={onCancel}
            className="shrink-0 w-8 h-8 rounded-lg bg-white/15 hover:bg-white/30 text-white font-bold"
            title="Fermer"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-5 flex flex-col gap-3">
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-semibold text-red-600">
              {error}
            </div>
          )}

          <AddSection icon={isSicurezza ? '🛡️' : '❓'} title={isSicurezza ? 'Tâche H&S' : 'Question'}>
            <AddField label={isSicurezza ? 'Tâche / description' : 'Question / description'} required>
              <textarea
                className={`${ADD_INPUT} min-h-[70px]`} value={draft.description} onChange={set('description')}
                placeholder={isSicurezza
                  ? 'ex. Vérifier l’étiquetage des produits chimiques stockés'
                  : 'ex. Faut-il commander un nouveau lot d’anticorps secondaires ?'}
                autoFocus
              />
            </AddField>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              <AddField label="Statut">
                <select className={ADD_INPUT} value={draft.statut} onChange={set('statut')}>
                  <option value="">— Sans statut —</option>
                  {(statusOptions || []).map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </AddField>
              {isSicurezza ? (
                <AddField label="Priorité" hint="Suggestions : les niveaux déjà utilisés dans le tableau.">
                  <input
                    className={ADD_INPUT} value={draft.priorite} onChange={set('priorite')}
                    list="collection-priorites" placeholder="ex. Urgent"
                  />
                  <datalist id="collection-priorites">
                    {(prioriteOptions || []).map((v) => <option key={v} value={v} />)}
                  </datalist>
                </AddField>
              ) : (
                <AddField label="Tags / classification" hint="Plusieurs tags séparés par des virgules.">
                  <input
                    className={ADD_INPUT} value={draft.tags} onChange={set('tags')}
                    placeholder="ex. matériel, fournisseur"
                  />
                </AddField>
              )}
            </div>

            <div className="mt-3">
              <AddField label="Responsable" hint="Suggestions : le personnel de l’équipe et les responsables déjà utilisés.">
                <input
                  className={ADD_INPUT} value={draft.responsable} onChange={set('responsable')}
                  list="collection-responsables" placeholder="ex. Marie Curie"
                />
                <datalist id="collection-responsables">
                  {(responsableOptions || []).map((v) => <option key={v} value={v} />)}
                </datalist>
              </AddField>
            </div>
          </AddSection>

          <AddSection icon="💬" title="Notes">
            <textarea
              className={`${ADD_INPUT} min-h-[60px]`} value={draft.commentaires} onChange={set('commentaires')}
              placeholder="Contexte, précisions, remarques…"
            />
          </AddSection>
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 bg-white border-t border-slate-200">
          <button
            type="button" onClick={onCancel}
            className="px-4 py-2 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-200 bg-slate-100"
          >
            Annuler
          </button>
          <button
            type="button" onClick={submit}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm px-5 py-2 rounded-xl shadow-sm transition-colors"
          >
            💾 {editing ? 'Enregistrer les modifications' : title}
          </button>
        </div>
      </div>
    </div>
  );
};
