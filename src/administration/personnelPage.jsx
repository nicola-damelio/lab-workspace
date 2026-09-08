/* =========================================================================
   src/administration/personnelPage.jsx
   Page « Personnel » — annuaire (Permanent / Technique / Temporaire),
   corps & grades (le grade est une sous-classification du corps : PR → PR2/
   PR1/CE2/CE1, MCF → CN/HC, DR → DR2/DR1…), BAP, missions, formations et
   bloc stagiaire lié à une ligne budgétaire (Recette).
   ========================================================================= */
import React, { useEffect, useMemo, useState } from 'react';
import { useAdmin } from './AdminContext';
import { PERSONNEL_TYPES, PERSONNEL_CORPS, GRADES_BY_CORPS, BAP_LIST, PERSONNEL_POSITIONS, FORMATION_SUGGESTIONS, statutLabelOf } from './adminSchema';
import { PersonnelModal } from './personnelModal';
import { AdminImportModal } from './adminImportModal';
import { SmartTable } from './smartTable';
import { personEmailOf } from './emailNotify';

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

/* ── Promotions d’une fiche ─────────────────────────────────────────────────
   Historique « Position | YYYY-MM » (tableau promotions, la plus récente en
   dernier). Les anciennes fiches ne portaient que dernierePromotion (date) —
   elles restent compatibles : l’historique vide retombe sur cette date. */
const promoStrings = (p) => {
  const arr = Array.isArray(p.promotions) ? p.promotions.filter(Boolean) : [];
  if (arr.length) return arr;
  const d = String((p && p.dernierePromotion) || '').trim();
  return d ? [d] : [];
};

/* « PR2 | 2024-09 » → { label: 'PR2', date: '2024-09' } (dernier « | »).
   Une valeur sans « | » qui ressemble à une date (2024 ou 2024-09 — anciennes
   fiches « Dernière promotion ») est traitée comme une date. */
const splitEntry = (s) => {
  const t = String(s || '').trim();
  const i = t.lastIndexOf('|');
  if (i >= 0) return { label: t.slice(0, i).trim(), date: t.slice(i + 1).trim() };
  if (/^\d{4}(-\d{1,2})?$/.test(t)) return { label: '', date: t };
  return { label: t, date: '' };
};

/* ── Pièces jointes (documents & images, entretiens EP / EF) ────────────────
   Chaque pièce = { name, url (Drive › personnel/<nom>/…, lien externe ou
   data: local), mime, at }. Les valeurs déjà enregistrées restent affichées. */
const cleanAttachment = (a) => {
  const url = String((a && (a.url || a.dataUrl)) || '').trim();
  if (!url) return null;
  const name = String((a && a.name) || (a && a.label) || '').trim();
  return {
    name,
    url,
    mime: String((a && a.mime) || '').trim(),
    at: Number((a && a.at)) || Date.now(),
    cloud: Boolean(a && a.cloud) || !/^data:/i.test(url),
  };
};

/** Liste plate des pièces cliquables d’une fiche (documents + entretiens). */
const personDocsList = (p) => {
  const out = [];
  (Array.isArray(p && p.documents) ? p.documents : []).forEach((d, i) => {
    const url = String((d && (d.url || d.dataUrl)) || '').trim();
    if (!url) return;
    out.push({
      key: `doc${i}`,
      name: String((d && (d.name || d.label)) || '').trim() || 'Document',
      url,
      mime: (d && d.mime) || '',
      kind: 'doc',
    });
  });
  const pushEnt = (obj, kind, fallback) => {
    const url = String((obj && (obj.url || obj.dataUrl)) || '').trim();
    if (!url) return;
    out.push({
      key: kind,
      name: String((obj && obj.name) || '').trim() || fallback,
      url,
      mime: (obj && obj.mime) || '',
      kind,
    });
  };
  pushEnt(p && p.entretienPro, 'EP', 'Entretien professionnel');
  pushEnt(p && p.entretienFormation, 'EF', 'Entretien de formation');
  return out;
};

/* ── Bascule automatique « Membres précédents » ─────────────────────────────
   Une fiche quitte la table principale dès que la date du jour est POSTÉRIEURE
   à la fin de son contrat (dateFinContrat) — ou de son stage à défaut. Elle est
   alors affichée automatiquement dans le tableau « Membres précédents », sans
   jamais être retirée de l’annuaire (elle reste modifiable / réactivable).    */
const contractEndOf = (p) => {
  const raw = String((p && (p.dateFinContrat || p.dateFinStage)) || '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
};

const isoToday = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const isFormerMember = (p, todayISO) => {
  const end = contractEndOf(p);
  return Boolean(end && end < todayISO);
};

export const PersonnelPage = () => {
  const { data, settings, upsert, remove, focus, clearFocus } = useAdmin();
  const list = useMemo(() => (Array.isArray(data.personnel) ? data.personnel : []), [data.personnel]);
  const recettes = useMemo(() => (Array.isArray(data.recettes) ? data.recettes : []), [data.recettes]);
  /* Membres permanents / techniques de l’annuaire → encadrants des stagiaires. */
  const permanents = useMemo(
    () => list.filter((p) => p && p.nom && statutLabelOf(p) === 'Permanent').map((p) => String(p.nom).trim()).filter(Boolean),
    [list],
  );
  const corpsOptions = (Array.isArray(settings.corps) && settings.corps.length ? settings.corps : PERSONNEL_CORPS);
  const types = (Array.isArray(settings.personnelTypes) && settings.personnelTypes.length ? settings.personnelTypes : PERSONNEL_TYPES);
  const baps = (Array.isArray(settings.bap) && settings.bap.length ? settings.bap : BAP_LIST);
  const gradesMap = (settings.gradesByCorps && typeof settings.gradesByCorps === 'object' ? settings.gradesByCorps : GRADES_BY_CORPS);
  /* Tables « bibliothèque » ajoutées : positions (promotions) et formations. */
  const positions = (Array.isArray(settings.positions) && settings.positions.length ? settings.positions : PERSONNEL_POSITIONS);
  const formationOptions = (Array.isArray(settings.formations) && settings.formations.length ? settings.formations : FORMATION_SUGGESTIONS);

  const [modal, setModal] = useState(null); // null | {mode:'new'} | {mode:'edit', rec}
  const [importOpen, setImportOpen] = useState(false);

  /* Navigation inter-page entrante (ex. Librerie → Personnel pour le porteur
     d’un projet) : la fiche ciblée est mise en évidence dans son tableau. */
  const [focusPersonId, setFocusPersonId] = useState(null);
  useEffect(() => {
    if (!focus || focus.pageId !== 'personnel' || !focus.recordId) return;
    setFocusPersonId(focus.recordId);
    if (typeof clearFocus === 'function') clearFocus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  /* Membre actuel tant que la date du jour n’a pas dépassé la fin du contrat
     (ou, pour un stage, la fin du stage). Passé ce terme, la fiche bascule
     automatiquement dans le tableau « Membres précédents » du bas de page. */
  const today = isoToday();
  const { current, former } = useMemo(() => {
    const cur = [];
    const form = [];
    (list || []).forEach((p) => {
      if (isFormerMember(p, today)) form.push(p);
      else cur.push(p);
    });
    return { current: cur, former: form };
  }, [list, today]);
  /* La fiche ciblée par un lien inter-page est-elle dans « Membres actuels » ? */
  const focusOnCurrent = useMemo(
    () => !!focusPersonId && current.some((p) => p && p.id === focusPersonId),
    [focusPersonId, current]
  );

  /* Code couleur (transparents et légers) : Permanent / Technique en bleu
     clair, Temporaire / non permanent en ambre clair. */
  const rowTint = (p) => (statutLabelOf(p) === 'Permanent' ? 'bg-sky-100/40' : 'bg-amber-100/40');

  /* Lignes d’édition { label, date } → format stocké « Libellé | YYYY-MM »
     (identique à celui des importations Google Sheets : « Formation autoclave | 2024 »). */
  const rowsToEntries = (rows) => (rows || [])
    .map((r) => ({
      label: String((r && r.label) || '').trim(),
      date: String((r && r.date) || '').trim(),
    }))
    .filter((x) => x.label || x.date)
    .map((x) => [x.label, x.date].filter(Boolean).join(' | '));

  const onSave = (patch, existingId) => {
    if (!String(patch.nom || '').trim()) { alert('Merci de saisir le nom.'); return; }
    const promoEntries = rowsToEntries(patch.promoRows);
    // « Dernière promotion » = date de la ligne la plus récente de l’historique.
    const lastDated = [...(patch.promoRows || [])].reverse()
      .find((r) => String((r && r.date) || '').trim());
    const cleaned = {
      nom: String(patch.nom || '').trim(),
      email: String(patch.email || '').trim(),
      type: patch.type || types[0],
      corps: patch.corps || '',
      grade: patch.grade || '',
      bap: patch.bap || '',
      fonction: patch.fonction || '',
      hdr: patch.hdr || '',
      categorie: String(patch.categorie || '').trim(),
      echelon: String(patch.echelon || '').trim(),
      chevron: String(patch.chevron || '').trim(),
      dateEmbauche: String(patch.dateEmbauche || '').trim(),
      dateFinContrat: String(patch.dateFinContrat || '').trim(),
      promotions: promoEntries,
      dernierePromotion: lastDated ? String(lastDated.date).trim() : '',
      dernierRIPEC: String(patch.dernierRIPEC || '').trim(),
      duties: toArray(patch.dutiesText),
      formations: rowsToEntries(patch.formationRows),
      encadrants: (patch.encadrants || []).map((n) => String(n || '').trim()).filter(Boolean),
      recetteId: patch.recetteId || null,
      dateDebutStage: String(patch.dateDebutStage || '').trim(),
      dateFinStage: String(patch.dateFinStage || '').trim(),
      dureeMois: patch.dureeMois === '' || patch.dureeMois === null || patch.dureeMois === undefined ? null : Number(patch.dureeMois),
      documents: (patch.docRows || []).map(cleanAttachment).filter(Boolean),
      entretienPro: cleanAttachment(patch.entretienPro),
      entretienFormation: cleanAttachment(patch.entretienFormation),
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
      key: 'email', label: 'E-mail', filter: 'text',
      /* Colonne volontairement large et lien insécable : chaque e-mail tient
         sur une seule ligne (jamais coupé au milieu de l’adresse). */
      tdClass: 'min-w-[240px]',
      value: (p) => personEmailOf(p),
      display: (p) => {
        const v = personEmailOf(p);
        return v
          ? <a href={`mailto:${v}`} className="text-xs font-medium text-blue-700 whitespace-nowrap hover:underline" title={`Écrire à ${p.nom || ''}`}>{v}</a>
          : <span className="text-[10px] font-bold text-amber-600 whitespace-nowrap" title="Aucun e-mail renseigné — les notifications devis/BC ne peuvent pas être envoyées à cette fiche.">✉ manquant</span>;
      },
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
      key: 'fonction', label: 'Fonction',
      value: (p) => p.fonction || '',
      display: (p) => (
        p.fonction === 'AP'
          ? <span className="inline-block text-[10px] font-black px-2 py-0.5 rounded-full bg-violet-50 border border-violet-200 text-violet-700" title="Agent de prévention — ajoute Dépenses, Budget overview + Hygiène & Sécurité">AP</span>
          : p.fonction === 'Gestionnaire'
            ? <span className="inline-block text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700" title="Gestionnaire — ajoute Dépenses, Budget overview + Questions ouvertes">Gestionnaire</span>
            : p.fonction === 'Achats'
              ? <span className="inline-block text-[10px] font-black px-2 py-0.5 rounded-full bg-cyan-50 border border-cyan-200 text-cyan-700" title="Responsable d'achats — ajoute Dépenses, Budget overview ; reçoit les OM / achats prévus transférés (devis & BC, remboursements)">Resp. achats</span>
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
      key: 'promotion', label: 'Dernière promotion',
      value: (p) => {
        const rows = promoStrings(p);
        if (!rows.length) return '';
        const { label, date } = splitEntry(rows[rows.length - 1]);
        return [label, date].filter(Boolean).join(' ');
      },
      display: (p) => {
        const rows = promoStrings(p);
        if (!rows.length) return <span className="text-slate-300">—</span>;
        const last = splitEntry(rows[rows.length - 1]);
        const history = rows.map((s) => {
          const { label, date } = splitEntry(s);
          return [date, label].filter(Boolean).join(' · ');
        });
        return (
          <span
            className="inline-block text-[10px] font-black px-2 py-0.5 rounded-full bg-violet-50 border border-violet-200 text-violet-700 whitespace-nowrap"
            title={history.length > 1 ? `Historique des promotions : ${history.join(' → ')}` : undefined}
          >
            {[last.date, last.label].filter(Boolean).join(' · ')}
          </span>
        );
      },
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
      key: 'docs', label: 'Documents', filter: 'text',
      value: (p) => personDocsList(p).map((d) => d.name).join(' '),
      display: (p) => {
        const docs = personDocsList(p);
        if (!docs.length) return <span className="text-slate-300">—</span>;
        return (
          <div className="flex flex-wrap gap-1 max-w-[250px]">
            {docs.map((d) => {
              const isImg = /^image\//i.test(d.mime) || /^data:image\//i.test(d.url) || /\.(png|jpe?g|gif|webp|svg|heic|bmp)(\?|$)/i.test(d.url);
              const isDrive = /drive\.google\.com\/|drive\.usercontent\.google\.com|lh3\.googleusercontent\.com/.test(d.url);
              const isLocal = /^data:/i.test(d.url);
              const label = d.kind === 'EP' ? '🧾 EP' : d.kind === 'EF' ? '🧾 EF' : (isImg ? '🖼' : (isDrive ? '📄' : '🔗'));
              const what = d.kind === 'EP' ? 'Entretien professionnel' : d.kind === 'EF' ? 'Entretien de formation' : 'Document / image';
              return (
                <a
                  key={d.key}
                  href={d.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`${what} — ${d.name || ''}${isLocal ? ' (copie locale temporaire)' : ' · ouvrir dans Google Drive'}`}
                  className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${d.kind === 'EP' || d.kind === 'EF' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : isLocal ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-sky-50 border-sky-200 text-sky-700'}`}
                >
                  {label}
                  <span className="max-w-[120px] truncate">{d.name}</span>
                </a>
              );
            })}
          </div>
        );
      },
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
    { key: 'promoF', label: 'Promotion / RIPEC', hidden: true, filter: 'text', value: (p) => promoStrings(p).concat(p.dernierRIPEC || '').filter(Boolean).join(' ') },
    { key: 'ligneF', label: 'Ligne budgétaire du stage', hidden: true, filter: 'text', value: (p) => recetteLigne(p.recetteId) },
    { key: 'datesStageF', label: 'Dates / durée du stage', hidden: true, filter: 'text', value: (p) => [p.dateDebutStage, p.dateFinStage, p.dureeMois && `${p.dureeMois} mois`].filter(Boolean).join(' ') },
    { key: 'commentairesF', label: 'Commentaires', hidden: true, filter: 'text', value: (p) => p.commentaires || '' },
  ];

  return (
    <div className="max-w-full mx-auto flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs font-bold text-slate-400">
          {current.length} membre{current.length > 1 ? 's' : ''} actuel{current.length > 1 ? 's' : ''}
          {former.length > 0 ? ` · ${former.length} dans « Membres précédents »` : ''}
          {' · '}le grade est choisi dans la liste propre au corps sélectionné.
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

      {/* Code couleur Permanent / Non permanent */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-2 bg-slate-100/50 border border-slate-200 rounded-xl text-[11px] font-semibold text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-sky-300 ring-1 ring-sky-400/70" aria-hidden="true" />
          Permanent · Technique
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-amber-300 ring-1 ring-amber-400/70" aria-hidden="true" />
          Temporaire · non permanent
        </span>
        <span className="text-slate-400 font-normal">
          ⏳ Une fin de contrat dépassée déplace automatiquement la fiche dans « Membres précédents » (tableau du bas).
        </span>
      </div>

      {list.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-10 text-center">
          <div className="text-4xl mb-2">👥</div>
          <p className="font-black text-slate-700">Annuaire vide</p>
          <p className="text-sm text-slate-400 mt-1">Ajoutez le personnel permanent, technique ou temporaire de l’équipe.</p>
        </div>
      ) : (
        <>
          {current.length > 0 && (
            <div className="flex flex-col gap-2">
              {former.length > 0 && (
                <div className="flex items-center gap-2 px-1">
                  <h3 className="text-sm font-black text-slate-600">👥 Membres actuels</h3>
                  <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-sky-100 border border-sky-200 text-sky-700">{current.length}</span>
                </div>
              )}
              <SmartTable
                columns={personnelCols}
                rows={current}
                rowClass={rowTint}
                minWidth="1180px"
                focusRowKey={focusOnCurrent ? focusPersonId : null}
                onFocusDone={() => setFocusPersonId(null)}
                searchPlaceholder="Rechercher un nom, un corps, un grade, un BAP…"
                emptyLabel="Annuaire vide"
                noMatchLabel="Aucun membre actuel ne correspond aux filtres."
              />
            </div>
          )}
          {former.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 px-1">
                <h3 className="text-sm font-black text-slate-600">🗂 Membres précédents</h3>
                <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-100 border border-amber-200 text-amber-700">{former.length}</span>
              </div>
              <p className="text-[11px] text-slate-400 px-1 -mt-1">
                Fin de contrat (ou de stage) dépassée — la fiche a été transférée ici automatiquement et reste modifiable.
              </p>
              <SmartTable
                columns={personnelCols}
                rows={former}
                rowClass={rowTint}
                minWidth="1180px"
                focusRowKey={focusPersonId && !focusOnCurrent ? focusPersonId : null}
                onFocusDone={() => setFocusPersonId(null)}
                searchPlaceholder="Rechercher parmi les anciens membres…"
                emptyLabel="Aucun ancien membre"
                noMatchLabel="Aucun ancien membre ne correspond aux filtres."
              />
            </div>
          )}
        </>
      )}

      {importOpen && <AdminImportModal kind="personnel" onClose={() => setImportOpen(false)} />}

      {modal && <PersonnelModal
        modal={modal} corpsOptions={corpsOptions} gradesMap={gradesMap} types={types} baps={baps} recettes={recettes}
        positions={positions} formationOptions={formationOptions} permanents={permanents}
        onCancel={() => setModal(null)} onSave={onSave}
      />}
    </div>
  );
};

