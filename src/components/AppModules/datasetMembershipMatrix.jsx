/* =========================================================================
   src/components/AppModules/datasetMembershipMatrix.jsx
   « QUI VOIT QUEL DATASET » — la matrice personne × dataset du panneau
   d'équipe (page d'accueil, superutilisateur).

   Ce que ce composant N'EST PAS : une seconde vérité. La règle d'accès vit
   sur chaque document dataset (`access`, voir utils/datasetAccess.js), et
   c'est elle que la page d'accueil applique pour ouvrir ou masquer une
   carte. La matrice se contente de la MONTRER dans l'autre sens et d'écrire
   ses patches (utils/datasetMembership.js) — jamais une liste de datasets
   portée par un compte.

   Une ligne = un compte, une colonne = un dataset :
     · cocher une case nomme la personne dans le dataset ET restreint le
       dataset (sinon « visible par tous » contredirait la case cochée) ;
     · l'en-tête de colonne porte le geste 🌐 / 🔒 (visible par toute
       l'équipe / seulement les membres), les noms de membres étant conservés ;
     · la fin de ligne affiche le nombre de datasets que la personne VERRA
       réellement (calculé par la même règle que l'application).
   ========================================================================= */
import React, { useEffect, useMemo, useState } from 'react';
import { datasetAccessOf } from '../../utils/datasetAccess';
import {
  addMember, removeMember, setDatasetRestriction, unknownMembersOf,
  invitableOperators, sameMember, datasetsOfUser, membershipSummary,
} from '../../utils/datasetMembership';

const kindIcon = (kind) => (kind === 'administration' ? '🏛️' : '🧪');

const memberOf = (access, name) =>
  !!name && access.memberNames.some((n) => sameMember(n, name));

const sameAccess = (a, b) =>
  a.restricted === b.restricted && a.memberNames.join('\u0000') === b.memberNames.join('\u0000');

export const DatasetMembershipMatrix = ({ datasets = [], operators = [], onSaveAccess }) => {
  const list = useMemo(
    () => (Array.isArray(datasets) ? datasets : [])
      .filter((d) => d && d.id)
      .slice()
      .sort((a, b) => {
        const ka = a.kind === 'administration' ? 0 : 1;
        const kb = b.kind === 'administration' ? 0 : 1;
        if (ka !== kb) return ka - kb;
        return String(a.title || '').localeCompare(String(b.title || ''));
      }),
    [datasets]
  );
  const rows = useMemo(() => invitableOperators(operators), [operators]);
  /* Le brouillon ne porte QUE les datasets modifiés : tout le reste est lu
     dans les datasets eux-mêmes (aucune copie qui pourrait vieillir). */
  const [draft, setDraft] = useState(() => new Map());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  /* Les datasets relus (écriture faite ici ou sur un autre poste) remplacent le
     brouillon : ce qui n'est plus en attente n'a plus à l'être. Le COMPTE-RENDU
     de l'enregistrement, lui, reste affiché — sinon « ✅ N dataset(s) mis à
     jour » disparaîtrait au re-rendu que l'écriture vient justement de
     déclencher (le parent republie la liste des datasets). */
  useEffect(() => { setDraft(new Map()); }, [datasets]);

  const accessOf = (dset) => draft.get(String(dset.id)) || datasetAccessOf(dset);
  const withDraft = useMemo(
    () => list.map((d) => ({ ...d, access: accessOf(d) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [list, draft]
  );

  const setAccess = (dset, next) => {
    setDraft((prev) => {
      const map = new Map(prev);
      if (sameAccess(next, datasetAccessOf(dset))) map.delete(String(dset.id));
      else map.set(String(dset.id), next);
      return map;
    });
    setNote('');
  };

  const toggleCell = (dset, op) => {
    const access = accessOf(dset);
    const next = memberOf(access, op.name)
      ? removeMember({ access }, op.name)
      : addMember({ access }, op.name);
    setAccess(dset, { restricted: next.restricted, memberNames: next.memberNames });
  };

  const toggleRestriction = (dset) => {
    const access = accessOf(dset);
    setAccess(dset, setDatasetRestriction({ access }, !access.restricted));
  };

  const setRow = (op, want) => {
    const next = new Map(draft);
    list.forEach((dset) => {
      const access = next.get(String(dset.id)) || datasetAccessOf(dset);
      if (memberOf(access, op.name) === want) return;
      const patch = want ? addMember({ access }, op.name) : removeMember({ access }, op.name);
      const clean = { restricted: patch.restricted, memberNames: patch.memberNames };
      if (sameAccess(clean, datasetAccessOf(dset))) next.delete(String(dset.id));
      else next.set(String(dset.id), clean);
    });
    setDraft(next);
    setNote('');
  };

  const save = async () => {
    if (busy || !draft.size || typeof onSaveAccess !== 'function') return;
    setBusy(true);
    const patches = [...draft.entries()].map(([id, access]) => ({ id, access }));
    let done = 0;
    for (const patch of patches) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await onSaveAccess(patch.id, patch.access);
        done += 1;
      } catch (e) {
        console.error('Dataset membership save error:', e && e.message);
      }
    }
    setBusy(false);
    setDraft(new Map());
    setNote(done === patches.length
      ? `✅ ${done} dataset(s) mis à jour — visible immédiatement sur les pages d’accueil.`
      : `⚠️ ${done}/${patches.length} dataset(s) enregistré(s) — réessayez pour les autres.`);
  };

  const summary = useMemo(() => membershipSummary(list, operators), [list, operators]);

  if (!list.length) {
    return (
      <p className="text-xs italic text-slate-400 bg-slate-50 border border-dashed border-slate-300 rounded-lg px-3 py-3">
        Aucun dataset pour l’instant : créez une base d’administration ou un dataset scientifique, puis
        attribuez-les ici aux différents comptes.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-sm font-black text-slate-800 uppercase">🗂️ Datasets de chaque personne</h4>
          <p className="text-[11px] text-slate-500 leading-snug">
            Les datasets cochés pour une personne sont exactement ceux qu’elle verra sur sa page d’accueil.
            Cocher une case restreint le dataset aux personnes nommées (👑 le superutilisateur voit tout, toujours).
          </p>
        </div>
        <div className="text-[11px] font-bold text-slate-500 shrink-0 text-right">
          {summary.accounts} compte(s) · {summary.datasets} dataset(s) · {summary.restricted} restreint(s)
          {draft.size > 0 && <span className="ml-2 text-amber-700">● {draft.size} modifié(s)</span>}
        </div>
      </div>

      {!rows.length ? (
        <p className="text-xs italic text-slate-400 bg-slate-50 border border-dashed border-slate-300 rounded-lg px-3 py-3">
          Aucun compte membre pour l’instant — créez d’abord les comptes ci-dessus : ce sont eux qui se voient
          attribuer les datasets (le superutilisateur a accès à tout, par principe).
        </p>
      ) : (
        <div className="overflow-x-auto border border-slate-200 rounded-xl">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50">
                <th className="sticky left-0 z-10 bg-slate-50 text-left px-3 py-2 font-black text-slate-500 uppercase text-[10px] border-b border-slate-200 min-w-[210px]">
                  Compte
                </th>
                {list.map((dset) => {
                  const access = accessOf(dset);
                  const unknown = unknownMembersOf({ ...dset, access }, operators);
                  return (
                    <th key={dset.id} className="px-2 py-2 border-b border-l border-slate-200 align-bottom">
                      <div className="flex flex-col items-center gap-1 max-w-[120px] mx-auto">
                        <span className="font-bold text-slate-700 leading-tight text-center break-words">
                          {kindIcon(dset.kind)} {dset.title || 'Sans titre'}
                        </span>
                        <button
                          type="button"
                          onClick={() => toggleRestriction(dset)}
                          disabled={busy}
                          className={`text-[9px] font-black uppercase rounded-full border px-2 py-0.5 transition-colors ${
                            access.restricted
                              ? 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100'
                              : 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                          }`}
                          title={access.restricted
                            ? 'Seulement les personnes cochées (+ superutilisateur) — cliquez pour rendre le dataset visible par toute l’équipe'
                            : 'Visible par toute l’équipe — cliquez pour le réserver aux personnes cochées'}
                        >
                          {access.restricted ? '🔒 Membres' : '🌐 Tous'}
                        </button>
                        {unknown.length > 0 && (
                          <span
                            className="text-[9px] font-bold text-amber-700 text-center leading-tight"
                            title={`Nom(s) sans compte : ${unknown.join(', ')} — ces noms n’ouvrent le dataset à personne`}
                          >
                            ⚠️ {unknown.length} nom(s) sans compte
                          </span>
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((op) => {
                const visible = datasetsOfUser(withDraft, { name: op.name, role: 'user' }).length;
                return (
                  <tr key={op.id || op.name} className="odd:bg-white even:bg-slate-50/60">
                    <td className="sticky left-0 z-10 bg-inherit px-3 py-2 border-b border-slate-100">
                      <div className="flex items-center gap-2">
                        <span className="text-base" aria-hidden="true">🧪</span>
                        <div className="min-w-0">
                          <p className="font-bold text-slate-800 truncate">{op.name}</p>
                          <p className="text-[10px] text-slate-400">
                            {visible} dataset(s) visible(s)
                            {!op.passwordHash && <span className="text-red-500 font-bold"> · ⚠️ sans mot de passe</span>}
                          </p>
                        </div>
                        <div className="ml-auto flex gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => setRow(op, true)}
                            disabled={busy}
                            className="text-[10px] font-bold text-slate-500 hover:text-blue-700 px-1.5 py-0.5 rounded hover:bg-blue-50"
                            title="Tous les datasets"
                          >
                            tout
                          </button>
                          <button
                            type="button"
                            onClick={() => setRow(op, false)}
                            disabled={busy}
                            className="text-[10px] font-bold text-slate-500 hover:text-red-600 px-1.5 py-0.5 rounded hover:bg-red-50"
                            title="Aucun dataset"
                          >
                            rien
                          </button>
                        </div>
                      </div>
                    </td>
                    {list.map((dset) => {
                      const access = accessOf(dset);
                      const isMember = memberOf(access, op.name);
                      return (
                        <td key={dset.id} className="px-2 py-2 border-b border-l border-slate-100 text-center">
                          <input
                            type="checkbox"
                            checked={isMember}
                            disabled={busy}
                            onChange={() => toggleCell(dset, op)}
                            className="rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                            title={isMember
                              ? `${op.name} est membre de « ${dset.title || 'Sans titre'} »`
                              : `Autoriser ${op.name} sur « ${dset.title || 'Sans titre'} »`}
                          />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={busy || !draft.size}
          className={`font-bold py-2 px-4 rounded-lg text-sm shadow-sm transition-colors ${
            busy || !draft.size
              ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-700 text-white'
          }`}
        >
          {busy ? 'Enregistrement…' : `Enregistrer les accès${draft.size ? ` (${draft.size})` : ''}`}
        </button>
        <button
          type="button"
          onClick={() => { setDraft(new Map()); setNote(''); }}
          disabled={busy || !draft.size}
          className="text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-lg px-3 py-2 disabled:opacity-40"
        >
          Annuler les modifications
        </button>
        {note && <span className="text-[11px] font-semibold text-slate-600">{note}</span>}
      </div>

      {summary.unknown.length > 0 && (
        <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 leading-relaxed">
          ⚠️ Nom(s) inscrit(s) comme membres mais sans compte correspondant : <b>{summary.unknown.join(', ')}</b>.
          Ces noms n’ouvrent le dataset à personne — corrigez le nom du compte, ou retirez-le du dataset.
        </p>
      )}
    </div>
  );
};
