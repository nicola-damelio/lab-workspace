/* =========================================================================
   src/components/AppModules/datasetAccessModal.jsx
   Éditeur « Membres du dataset » (réservé au superutilisateur, affiché depuis
   les cartes de l’écran d’accueil). Modifie le champ top-level `access`
   { restricted, memberNames } du document dataset : seuls les membres cochés
   (et le superutilisateur, qui a toujours accès) voient / ouvrent le dataset.
   ========================================================================= */
import React, { useMemo, useState } from 'react';
import { normalizeOperators } from '../../utils/auth';
import { datasetAccessOf, normalizeMemberNames } from '../../utils/datasetAccess';

const norm = (s) => String(s || '').trim().toLowerCase();

export const DatasetAccessModal = ({ dset, operators, onClose, onSave }) => {
  const access = useMemo(() => datasetAccessOf(dset), [dset]);
  const originalNames = access.memberNames;
  const team = useMemo(() => normalizeOperators(operators || []), [operators]);

  // Comptes réellement invitables : tous sauf les superutilisateurs (qui ont
  // déjà un accès permanent et n’ont pas besoin d’être « membres »).
  const invitable = team.filter((op) => op && op.name && op.role !== 'superuser');

  const [restricted, setRestricted] = useState(access.restricted);
  const [selected, setSelected] = useState(
    () => new Set(originalNames.map((n) => norm(n)))
  );
  const [saving, setSaving] = useState(false);

  const toggle = (name) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const key = norm(name);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAll = () => {
    setSelected(new Set(invitable.map((op) => norm(op.name))));
  };

  const clearAll = () => setSelected(new Set());

  const handleSave = async () => {
    if (saving) return;
    // Conserve la casse d’origine (membres historiques ou opérateurs).
    const all = new Map();
    originalNames.forEach((n) => { const k = norm(n); if (!all.has(k)) all.set(k, n); });
    invitable.forEach((op) => { const k = norm(op.name); if (!all.has(k)) all.set(k, op.name); });
    const memberNames = normalizeMemberNames(
      [...all.values()].filter((n) => selected.has(norm(n)))
    );
    setSaving(true);
    try {
      await onSave(dset.id, { restricted, memberNames });
    } catch (e) {
      console.error('Save dataset access error:', e && e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 z-[999999] flex items-center justify-center p-4 backdrop-blur-sm">
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col border border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-100 px-5 py-4 flex items-start justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <h3 className="text-base font-black text-slate-800">👥 Membres du dataset</h3>
            <p className="text-[11px] text-slate-500 truncate mt-0.5">
              {dset.title || 'Sans titre'} · {dset.kind === 'administration' ? '🏛️ Base d’administration' : '🧪 Dataset scientifique'}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            className="text-slate-400 hover:text-slate-700 text-lg leading-none px-1.5 py-0.5 rounded hover:bg-slate-100 transition-colors"
            title="Fermer"
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto custom-scrollbar" style={{ maxHeight: '55vh' }}>
          <label className="flex items-start gap-3 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={restricted}
              onChange={(e) => setRestricted(e.target.checked)}
              className="mt-0.5"
            />
            <span className="text-sm leading-snug">
              <span className="font-bold text-slate-700">Restreindre la visibilité aux membres ci-dessous</span>
              <span className="block text-[11px] text-slate-500">
                Si décoché, ce dataset reste visible par tous les comptes de l’équipe
                (comportement actuel des datasets existants). Une fois coché, seuls les
                membres sélectionnés + le superutilisateur le voient et peuvent l’ouvrir.
              </span>
            </span>
          </label>
          <p className={`mt-3 text-[11px] font-bold rounded-xl px-3 py-2 border leading-snug ${
            restricted
              ? 'bg-amber-50 border-amber-200 text-amber-800'
              : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}>
            {restricted
              ? `🔒 Actuellement : visible uniquement par ${selected.size} compte(s) coché(s) + le superutilisateur.`
              : '🌐 Actuellement : visible par TOUS les comptes de l’équipe. Cochez la case ci-dessus pour restreindre l’accès.'}
          </p>

          <div className="flex items-center justify-between mt-4 mb-2">
            <span className="text-[11px] font-black uppercase tracking-wide text-slate-400">
              Comptes autorisés {restricted ? `(${selected.size})` : ''}
            </span>
            <div className="flex gap-2">
              <button
                onClick={selectAll}
                disabled={saving}
                className="text-[11px] font-bold text-blue-600 hover:text-blue-800 hover:underline"
              >
                Tout sélectionner
              </button>
              <button
                onClick={clearAll}
                disabled={saving}
                className="text-[11px] font-bold text-slate-500 hover:text-slate-700 hover:underline"
              >
                Tout retirer
              </button>
            </div>
          </div>

          {invitable.length === 0 ? (
            <p className="text-xs italic text-slate-400 bg-slate-50 border border-slate-200 rounded-xl px-3 py-3">
              Aucun autre compte scientifique — seul le superutilisateur a accès.
              Créez des comptes dans « Settings → Scientists / Operators » (ou
              « Setup » d’une base d’administration) puis revenez ici.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {invitable.map((op) => {
                const key = norm(op.name);
                const checked = selected.has(key);
                return (
                  <label
                    key={op.id || op.name}
                    className={`flex items-center gap-3 px-3 py-2 rounded-xl border text-sm cursor-pointer transition-colors ${
                      checked
                        ? 'bg-blue-50 border-blue-200'
                        : 'bg-white border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={saving}
                      onChange={() => toggle(op.name)}
                    />
                    <span className="text-base" aria-hidden="true">🧪</span>
                    <span className="font-bold text-slate-800 flex-1 min-w-0 truncate">
                      {op.name}
                    </span>
                    {restricted && checked && (
                      <span className="text-[10px] font-black uppercase text-blue-700 bg-blue-100 rounded-full px-2 py-0.5">
                        Membre
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          )}

          <p className="mt-3 text-[11px] text-slate-400 leading-snug">
            👑 Le superutilisateur a toujours accès, même s’il n’est pas dans la liste.
            « Défini dans le dataset » = le nom du compte (celui utilisé pour se connecter).
          </p>
        </div>

        <div className="border-t border-slate-100 px-5 py-3 flex justify-end gap-2 shrink-0">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded"
          >
            Annuler
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className={`px-4 py-2 text-sm font-bold text-white rounded shadow-sm transition-colors ${
              saving ? 'bg-slate-400 cursor-wait' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {saving ? 'Enregistrement…' : 'Enregistrer les membres'}
          </button>
        </div>
      </div>
    </div>
  );
};
