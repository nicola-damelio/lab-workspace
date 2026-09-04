/* =========================================================================
   src/administration/personnelPage.jsx
   Page « Personnel » — annuaire (Permanent / Technique / Temporaire),
   corps & grades (le grade est une sous-classification du corps : PR → PR2/
   PR1/CE2/CE1, MCF → CN/HC, DR → DR2/DR1…), BAP, missions, formations et
   bloc stagiaire lié à une ligne budgétaire (Recette).
   ========================================================================= */
import React, { useMemo, useState } from 'react';
import { useAdmin } from './AdminContext';
import { PERSONNEL_TYPES, PERSONNEL_CORPS, GRADES_BY_CORPS, BAP_LIST } from './adminSchema';
import { PersonnelModal } from './personnelModal';
import { AdminImportModal } from './adminImportModal';

const toArray = (v) => {
  if (Array.isArray(v)) return v.filter(Boolean);
  if (typeof v === 'string') return v.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
  return [];
};

export const PersonnelPage = () => {
  const { data, settings, upsert, remove } = useAdmin();
  const list = useMemo(() => (Array.isArray(data.personnel) ? data.personnel : []), [data.personnel]);
  const recettes = useMemo(() => (Array.isArray(data.recettes) ? data.recettes : []), [data.recettes]);
  const corpsOptions = (Array.isArray(settings.corps) && settings.corps.length ? settings.corps : PERSONNEL_CORPS);
  const types = (Array.isArray(settings.personnelTypes) && settings.personnelTypes.length ? settings.personnelTypes : PERSONNEL_TYPES);
  const baps = (Array.isArray(settings.bap) && settings.bap.length ? settings.bap : BAP_LIST);
  const gradesMap = (settings.gradesByCorps && typeof settings.gradesByCorps === 'object' ? settings.gradesByCorps : GRADES_BY_CORPS);

  const [modal, setModal] = useState(null); // null | {mode:'new'} | {mode:'edit', rec}
  const [importOpen, setImportOpen] = useState(false);

  const onSave = (patch, existingId) => {
    if (!String(patch.nom || '').trim()) { alert('Merci de saisir le nom.'); return; }
    const cleaned = {
      nom: String(patch.nom || '').trim(),
      type: patch.type || types[0],
      corps: patch.corps || '',
      grade: patch.grade || '',
      bap: patch.bap || '',
      dateEmbauche: String(patch.dateEmbauche || '').trim(),
      dateFinContrat: String(patch.dateFinContrat || '').trim(),
      dernierePromotion: String(patch.dernierePromotion || '').trim(),
      dernierRIPEC: String(patch.dernierRIPEC || '').trim(),
      duties: toArray(patch.dutiesText),
      formations: toArray(patch.formationsText),
      encadrants: toArray(patch.encadrantsText),
      recetteId: patch.recetteId || null,
      dateDebutStage: String(patch.dateDebutStage || '').trim(),
      dateFinStage: String(patch.dateFinStage || '').trim(),
      dureeMois: patch.dureeMois === '' || patch.dureeMois === null || patch.dureeMois === undefined ? null : Number(patch.dureeMois),
      commentaires: String(patch.commentaires || ''),
    };
    upsert('personnel', cleaned, existingId);
    setModal(null);
  };

  const onRemove = (rec) => {
    if (window.confirm(`Retirer « ${rec.nom} » de l’annuaire ?`)) remove('personnel', rec.id);
  };

  // Un « stagiaire » est un Temporaire sans corps propre (corps « Stagiaire »).
  // Doctorants / ATER / post-docs sont des Temporaires à part entière.
  const isStage = (p) => p.corps === 'Stagiaire' || (p.type === 'Temporaire' && !p.corps);

  return (
    <div className="max-w-full mx-auto flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs font-bold text-slate-400">
          {list.length} membre{list.length > 1 ? 's' : ''} · le grade est choisi dans la liste propre au corps sélectionné.
        </p>
        <button
          onClick={() => setImportOpen(true)}
          className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-bold text-sm px-4 py-2 rounded-xl shadow-sm transition-colors flex items-center gap-1.5"
          title="Importer le personnel / les stagiaires depuis la feuille Google Sheets (coller, CSV ou Excel)"
        >
          <span className="text-base leading-none">📥</span> Importer
        </button>
        <button
          onClick={() => setModal({ mode: 'new' })}
          className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm px-4 py-2 rounded-xl shadow-sm transition-colors flex items-center gap-1.5"
        >
          <span className="text-base leading-none">+</span> Ajouter une personne
        </button>
      </div>

      {list.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-10 text-center">
          <div className="text-4xl mb-2">👥</div>
          <p className="font-black text-slate-700">Annuaire vide</p>
          <p className="text-sm text-slate-400 mt-1">Ajoutez le personnel permanent, technique ou temporaire de l’équipe.</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-x-auto">
          <table className="w-full text-sm min-w-[860px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400 border-b border-slate-200">
                <th className="px-3 py-2.5">Nom</th>
                <th className="px-3 py-2.5">Type</th>
                <th className="px-3 py-2.5">Corps</th>
                <th className="px-3 py-2.5">Grade</th>
                <th className="px-3 py-2.5">BAP</th>
                <th className="px-3 py-2.5">Contrat</th>
                <th className="px-3 py-2.5">Stagiaire / ligne</th>
                <th className="px-3 py-2.5 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50/60 align-top">
                  <td className="px-3 py-2.5 font-bold text-slate-800">
                    {p.nom}
                    {(p.duties || []).length > 0 && (
                      <div className="text-[10px] text-slate-400 font-medium">{(p.duties || []).join(' · ')}</div>
                    )}
                  </td>
                  <td className="px-3 py-2.5"><span className="text-xs font-bold text-slate-600">{p.type || '—'}</span></td>
                  <td className="px-3 py-2.5">
                    {p.corps ? <span className="inline-block text-[10px] font-black px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-600">{p.corps}</span> : '—'}
                  </td>
                  <td className="px-3 py-2.5">
                    {p.grade ? (
                      <span className="inline-block text-[10px] font-black px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-blue-700" title={`sous-classification de ${p.corps || ''}`}>{p.grade}</span>
                    ) : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-slate-600">{p.bap || '—'}</td>
                  <td className="px-3 py-2.5 text-slate-600 text-xs whitespace-nowrap">
                    {p.dateEmbauche ? <div>Arrivée {p.dateEmbauche}</div> : null}
                    {p.dateFinContrat ? <div className="text-red-500">Fin {p.dateFinContrat}</div> : null}
                    {!p.dateEmbauche && !p.dateFinContrat ? '—' : null}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-500 max-w-[200px]">
                    {isStage(p) ? (
                      <span className="text-amber-600 font-bold">Stagiaire</span>
                    ) : '—'}
                    {isStage(p) && p.recetteId ? (
                      <div className="truncate" title={(recettes.find((r) => r.id === p.recetteId) || {}).ligne}>
                        → {(recettes.find((r) => r.id === p.recetteId) || {}).ligne || 'ligne inconnue'}
                      </div>
                    ) : null}
                    {isStage(p) && !p.recetteId ? <div className="italic">non lié à une Recette</div> : null}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <div className="flex items-center gap-1 justify-end">
                      <button onClick={() => setModal({ mode: 'edit', rec: p })} title="Modifier" className="w-7 h-7 rounded-lg border border-slate-200 text-slate-400 hover:bg-blue-50 hover:text-blue-600 text-xs">✎</button>
                      <button onClick={() => onRemove(p)} title="Retirer" className="w-7 h-7 rounded-lg border border-slate-200 text-slate-400 hover:bg-red-50 hover:text-red-600 text-xs">🗑</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {importOpen && <AdminImportModal kind="personnel" onClose={() => setImportOpen(false)} />}

      {modal && <PersonnelModal
        modal={modal} corpsOptions={corpsOptions} gradesMap={gradesMap} types={types} baps={baps} recettes={recettes}
        onCancel={() => setModal(null)} onSave={onSave}
      />}
    </div>
  );
};

