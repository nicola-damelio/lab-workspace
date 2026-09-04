/* =========================================================================
   src/administration/personnelModal.jsx
   Fenêtre d’ajout / édition d’une personne. Corps → Grade est hiérarchique :
   les grades proposés dépendent du corps (GRADES_BY_CORPS) ; le corps
   « Stagiaire » active le bloc stage lié à une Recette.
   ========================================================================= */
import React, { useState } from 'react';

const D0 = () => ({
  nom: '', type: '', corps: '', grade: '', bap: '',
  dateEmbauche: '', dateFinContrat: '', dernierePromotion: '', dernierRIPEC: '',
  dutiesText: '', formationsText: '', encadrantsText: '', recetteId: '',
  dateDebutStage: '', dateFinStage: '', dureeMois: '', commentaires: '',
});

export const PersonnelModal = ({ modal, corpsOptions, gradesMap, types, baps, recettes, onCancel, onSave }) => {
  const editing = modal.mode === 'edit';
  const [draft, setDraft] = useState(() => {
    const r = editing && modal.rec ? modal.rec : null;
    if (!r) return D0();
    return {
      nom: r.nom || '', type: r.type || types[0], corps: r.corps || '', grade: r.grade || '', bap: r.bap || '',
      dateEmbauche: r.dateEmbauche || '', dateFinContrat: r.dateFinContrat || '',
      dernierePromotion: r.dernierePromotion || '', dernierRIPEC: r.dernierRIPEC || '',
      dutiesText: Array.isArray(r.duties) ? r.duties.join(', ') : (r.duties || ''),
      formationsText: Array.isArray(r.formations) ? r.formations.join('\n') : (r.formations || ''),
      encadrantsText: Array.isArray(r.encadrants) ? r.encadrants.join('\n') : (r.encadrants || ''),
      recetteId: r.recetteId || '', dateDebutStage: r.dateDebutStage || '',
      dateFinStage: r.dateFinStage || '',
      dureeMois: r.dureeMois === null || r.dureeMois === undefined ? '' : String(r.dureeMois),
      commentaires: r.commentaires || '',
    };
  });
  const set = (k) => (ev) => setDraft((d) => ({ ...d, [k]: ev.target.value }));
  const grades = (gradesMap[draft.corps] || []);
  const showStage = draft.corps === 'Stagiaire' || (draft.type === 'Temporaire' && !draft.corps);
  const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500';
  const labelCls = 'block text-[10px] font-black uppercase text-slate-400 tracking-wide mb-1';

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(3px)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden max-h-[94vh] flex flex-col">
        <div className="px-6 py-4 bg-gradient-to-br from-blue-600 to-indigo-700 text-white">
          <h2 className="text-lg font-black">{editing ? 'Modifier la personne' : 'Ajouter une personne'}</h2>
          <p className="text-blue-100 text-xs">Le grade est une sous-classification du corps (ex. PR → PR2, PR1, CE2, CE1).</p>
        </div>
        <div className="p-6 overflow-y-auto custom-scrollbar grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className={labelCls}>Nom complet</label>
            <input className={inputCls} value={draft.nom} onChange={set('nom')} placeholder="Nom Prénom" />
          </div>
          <div>
            <label className={labelCls}>Type</label>
            <select className={inputCls} value={draft.type} onChange={(e) => {
              const v = e.target.value;
              setDraft((d) => ({ ...d, type: v, corps: v === 'Temporaire' && d.corps === '' ? 'Stagiaire' : d.corps }));
            }}>
              <option value="">—</option>
              {(types || []).map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>BAP</label>
            <select className={inputCls} value={draft.bap} onChange={set('bap')}>
              <option value="">—</option>
              {(baps || []).map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Corps</label>
            <select className={inputCls} value={draft.corps} onChange={(e) => {
              const corps = e.target.value;
              const gs = gradesMap[corps] || [];
              setDraft((d) => ({
                ...d,
                corps,
                type: corps === 'Stagiaire' ? 'Temporaire' : d.type,
                grade: gs.includes(d.grade) ? d.grade : (gs[0] || ''),
              }));
            }}>
              <option value="">— Choisir —</option>
              {(corpsOptions || []).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Grade (du corps)</label>
            <select className={inputCls} value={draft.grade} onChange={set('grade')}>
              <option value="">{grades.length ? '—' : '— pas de grade —'}</option>
              {grades.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Arrivée / embauche</label>
            <input className={inputCls} type="date" value={draft.dateEmbauche} onChange={set('dateEmbauche')} />
          </div>
          <div>
            <label className={labelCls}>Fin de contrat</label>
            <input className={inputCls} type="date" value={draft.dateFinContrat} onChange={set('dateFinContrat')} />
          </div>
          <div>
            <label className={labelCls}>Dernière promotion</label>
            <input className={inputCls} value={draft.dernierePromotion} onChange={set('dernierePromotion')} placeholder="ex. 2024-09" />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>Missions (SST, radioprotection…)</label>
            <input className={inputCls} value={draft.dutiesText} onChange={set('dutiesText')} placeholder="SST, ASV, Radioprotection" />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>Formations (une par ligne : intitulé | date)</label>
            <textarea className={`${inputCls} min-h-[56px]`} value={draft.formationsText} onChange={set('formationsText')} placeholder={'SST initial | 2024-03\nHabilitations électriques | 2024-06'} />
          </div>

          {showStage && (
            <>
              <div className="sm:col-span-2">
                <label className={labelCls}>Encadrants (un par ligne)</label>
                <textarea className={`${inputCls} min-h-[48px]`} value={draft.encadrantsText} onChange={set('encadrantsText')} placeholder="Prénom Nom" />
              </div>
              <div>
                <label className={labelCls}>Ligne budgétaire liée</label>
                <select className={inputCls} value={draft.recetteId} onChange={set('recetteId')}>
                  <option value="">— Aucune —</option>
                  {(recettes || []).map((r) => <option key={r.id} value={r.id}>{r.ligne || r.id}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Début / fin de stage</label>
                <div className="flex gap-2">
                  <input className={inputCls} type="date" value={draft.dateDebutStage} onChange={set('dateDebutStage')} />
                  <input className={inputCls} type="date" value={draft.dateFinStage} onChange={set('dateFinStage')} />
                </div>
              </div>
              <div>
                <label className={labelCls}>Durée (mois)</label>
                <input className={inputCls} type="number" min="0" step="0.5" value={draft.dureeMois} onChange={set('dureeMois')} />
              </div>
            </>
          )}

          <div className="sm:col-span-2">
            <label className={labelCls}>Commentaires</label>
            <textarea className={`${inputCls} min-h-[56px]`} value={draft.commentaires} onChange={set('commentaires')} />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2 bg-slate-50">
          <button onClick={onCancel} className="px-4 py-2 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-200 bg-slate-100">Annuler</button>
          <button onClick={() => onSave(draft, editing ? modal.rec.id : undefined)}
            className="px-5 py-2 rounded-xl text-sm font-bold text-white bg-blue-600 hover:bg-blue-700">Enregistrer</button>
        </div>
      </div>
    </div>
  );
};

