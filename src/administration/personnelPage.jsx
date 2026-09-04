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
import { SmartTable } from './smartTable';

const toArray = (v) => {
  if (Array.isArray(v)) return v.filter(Boolean);
  if (typeof v === 'string') return v.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
  return [];
};

/* Sous-ligne « Cat. A · Éch. 8 · Chev. 3 » affichée sous le BAP. */
const cadreBits = (p) => [
  p.categorie ? `Cat. ${p.categorie}` : '',
  p.echelon && p.chevron ? `Éch. ${p.echelon} · Chev. ${p.chevron}`
    : p.echelon ? `Éch. ${p.echelon}`
    : p.chevron ? `Chev. ${p.chevron}` : '',
].filter(Boolean).join(' · ');

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
      hdr: patch.hdr || '',
      categorie: String(patch.categorie || '').trim(),
      echelon: String(patch.echelon || '').trim(),
      chevron: String(patch.chevron || '').trim(),
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

  const recetteLigne = (id) => {
    const found = recettes.find((r) => r.id === id);
    return found ? found.ligne : '';
  };

  /* Colonnes du SmartTable : chaque champ visible est triable et filtrable.
     Les champs fusionnés dans une même cellule (Catégorie, Échelon, Chevron,
     formations, ligne du stage…) restent disponibles comme critères cachés. */
  const personnelCols = [
    {
      key: 'nom', label: 'Nom', filter: 'text',
      value: (p) => p.nom || '',
      display: (p) => (
        <div className="min-w-[150px]">
          <div className="font-bold text-slate-800">{p.nom}</div>
          {(p.duties || []).length > 0 && (
            <div className="text-[10px] text-slate-400 font-medium">{(p.duties || []).join(' · ')}</div>
          )}
        </div>
      ),
    },
    {
      key: 'type', label: 'Type',
      value: (p) => p.type || '',
      display: (p) => <span className="text-xs font-bold text-slate-600">{p.type || '—'}</span>,
    },
    {
      key: 'corps', label: 'Corps',
      value: (p) => p.corps || '',
      display: (p) => (
        p.corps
          ? <span className="inline-block text-[10px] font-black px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-600">{p.corps}</span>
          : <span className="text-slate-300">—</span>
      ),
    },
    {
      key: 'grade', label: 'Grade',
      value: (p) => p.grade || '',
      display: (p) => (
        p.grade
          ? <span className="inline-block text-[10px] font-black px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-blue-700" title={`sous-classification de ${p.corps || ''}`}>{p.grade}</span>
          : <span className="text-slate-300">—</span>
      ),
    },
    {
      key: 'hdr', label: 'HDR',
      value: (p) => p.hdr || '',
      display: (p) => (
        p.hdr === 'Oui'
          ? <span className="inline-block text-[10px] font-black px-2 py-0.5 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700">HDR</span>
          : p.hdr === 'Non'
            ? <span className="text-[10px] font-bold text-slate-300">non</span>
            : <span className="text-slate-300">—</span>
      ),
    },
    {
      key: 'bap', label: 'BAP / cadre',
      value: (p) => p.bap || '',
      display: (p) => (
        <div>
          <span className="text-slate-600">{p.bap || '—'}</span>
          {cadreBits(p) && <div className="text-[10px] text-slate-400 font-medium">{cadreBits(p)}</div>}
        </div>
      ),
    },
    {
      key: 'contrat', label: 'Contrat',
      value: (p) => p.dateEmbauche || p.dateFinContrat || '',
      display: (p) => (
        <div className="text-slate-600 text-xs whitespace-nowrap">
          {p.dateEmbauche ? <div>Arrivée {p.dateEmbauche}</div> : null}
          {p.dateFinContrat ? <div className="text-red-500">Fin {p.dateFinContrat}</div> : null}
          {!p.dateEmbauche && !p.dateFinContrat ? <span className="text-slate-300">—</span> : null}
        </div>
      ),
    },
    {
      key: 'stage', label: 'Stagiaire / ligne',
      value: (p) => {
        if (!isStage(p)) return '';
        const ligne = recetteLigne(p.recetteId);
        return ligne ? `Stagiaire · ${ligne}` : 'Stagiaire · non lié';
      },
      display: (p) => (
        <div className="text-xs text-slate-500 max-w-[220px]">
          {isStage(p) ? <span className="text-amber-600 font-bold">Stagiaire</span> : <span className="text-slate-300">—</span>}
          {isStage(p) && p.recetteId ? (
            <div className="truncate" title={recetteLigne(p.recetteId)}>→ {recetteLigne(p.recetteId) || 'ligne inconnue'}</div>
          ) : null}
          {isStage(p) && !p.recetteId ? <div className="italic">non lié à une Recette</div> : null}
        </div>
      ),
    },
    {
      key: 'actions', label: '', sortable: false, filterable: false, align: 'right', nowrap: true,
      value: () => '',
      display: (p) => (
        <div className="flex items-center gap-1 justify-end">
          <button onClick={() => setModal({ mode: 'edit', rec: p })} title="Modifier" className="w-7 h-7 rounded-lg border border-slate-200 text-slate-400 hover:bg-blue-50 hover:text-blue-600 text-xs">✎</button>
          <button onClick={() => onRemove(p)} title="Retirer" className="w-7 h-7 rounded-lg border border-slate-200 text-slate-400 hover:bg-red-50 hover:text-red-600 text-xs">🗑</button>
        </div>
      ),
    },
    /* Critères de filtre / recherche supplémentaires (sans colonne dédiée). */
    { key: 'categorieF', label: 'Catégorie', hidden: true, value: (p) => p.categorie || '' },
    { key: 'echelonF', label: 'Échelon', hidden: true, filter: 'facet', value: (p) => p.echelon || '' },
    { key: 'chevronF', label: 'Chevron', hidden: true, filter: 'facet', value: (p) => p.chevron || '' },
    { key: 'dutiesF', label: 'Missions (duties)', hidden: true, filter: 'text', value: (p) => (p.duties || []).join(' ') },
    { key: 'formationsF', label: 'Formations', hidden: true, filter: 'text', value: (p) => (p.formations || []).join(' ') },
    { key: 'encadrantsF', label: 'Encadrants (stage)', hidden: true, filter: 'text', value: (p) => (p.encadrants || []).join(' ') },
    { key: 'promoF', label: 'Promotion / RIPEC', hidden: true, filter: 'text', value: (p) => [p.dernierePromotion, p.dernierRIPEC].filter(Boolean).join(' ') },
    { key: 'ligneF', label: 'Ligne budgétaire du stage', hidden: true, filter: 'text', value: (p) => recetteLigne(p.recetteId) },
    { key: 'datesStageF', label: 'Dates / durée du stage', hidden: true, filter: 'text', value: (p) => [p.dateDebutStage, p.dateFinStage, p.dureeMois && `${p.dureeMois} mois`].filter(Boolean).join(' ') },
    { key: 'commentairesF', label: 'Commentaires', hidden: true, filter: 'text', value: (p) => p.commentaires || '' },
  ];

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
        <SmartTable
          columns={personnelCols}
          rows={list}
          minWidth="1180px"
          searchPlaceholder="Rechercher un nom, un corps, un grade, un BAP…"
          emptyLabel="Annuaire vide"
          noMatchLabel="Aucun membre ne correspond aux filtres."
        />
      )}

      {importOpen && <AdminImportModal kind="personnel" onClose={() => setImportOpen(false)} />}

      {modal && <PersonnelModal
        modal={modal} corpsOptions={corpsOptions} gradesMap={gradesMap} types={types} baps={baps} recettes={recettes}
        onCancel={() => setModal(null)} onSave={onSave}
      />}
    </div>
  );
};

