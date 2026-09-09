/* =========================================================================
   src/administration/libreriePage.jsx
   Page « Librerie » — catalogue des fournisseurs (CRUD complet).

   Chaque fiche peut contenir :
     fournisseur (nom) · contact · adresse · email · téléphone ·
     referenceSifac (référence / n° de tiers dans SIFAC) · categories ·
     siteWeb · commentaires.

   Le catalogue se remplit manuellement (« + Ajouter un fournisseur ») ou
   depuis les noms saisis dans la colonne « Fournisseur » des Dépenses
   (« ↻ Créer depuis les Dépenses », bouton de synchronisation) — l’assistant
   d’import des Dépenses ajoute d’ailleurs automatiquement les fournisseurs
   manquants lors de chaque import.
   ========================================================================= */
import React, { useEffect, useMemo, useState } from 'react';
import { useAdmin } from './AdminContext';
import { SmartTable } from './smartTable';
import { toFrDate } from './congesDates';
import { buildMissingFournisseurs, normalizeKey } from './importUtils';
import { RECETTE_TYPES } from './adminSchema';
import { LineModal } from './recettesPage';

/* ── Petites aides ─────────────────────────────────────────────────────── */
const txt = (v) => (v === null || v === undefined ? '' : String(v).trim());
const pick = (rec, keys) => {
  for (const k of keys) {
    const v = rec && rec[k];
    if (txt(v)) return v;
  }
  return '';
};
const supplierNameOf = (r) => pick(r, ['fournisseur', 'nomFournisseur', 'fournisseurNom', 'nom', 'name']);
const joinList = (v) => (Array.isArray(v) ? v.map(txt).filter(Boolean).join(', ') : txt(v));

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

/* ── Formulaires (champs de la fiche fournisseur) ──────────────────────── */
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
   Fenêtre d’ajout / édition d’un fournisseur
   ═════════════════════════════════════════════════════════════════════════ */
const FournisseurModal = ({ rec, suggestions, existingNames, onCancel, onSave }) => {
  const editing = !!rec;
  const [draft, setDraft] = useState(() => ({
    fournisseur: txt(rec && supplierNameOf(rec)),
    contact: txt(rec && pick(rec, ['contact', 'contactFournisseur'])),
    email: txt(rec && pick(rec, ['email', 'mail'])),
    telephone: txt(rec && pick(rec, ['telephone', 'tel', 'phone'])),
    adresse: txt(rec && pick(rec, ['adresse', 'address'])),
    referenceSifac: txt(rec && pick(rec, ['referenceSifac', 'refSifac', 'sifacTiers', 'siret'])),
    categories: txt(rec && joinList(rec.categories)),
    siteWeb: txt(rec && pick(rec, ['siteWeb', 'site', 'website', 'url'])),
    commentaires: txt(rec && pick(rec, ['commentaires', 'notes', 'note'])),
  }));
  const set = (key) => (e) => setDraft((d) => ({ ...d, [key]: e.target.value }));
  const [error, setError] = useState('');

  const submit = () => {
    const fournisseur = txt(draft.fournisseur);
    if (!fournisseur) {
      setError('Le nom du fournisseur est obligatoire.');
      return;
    }
    const nameKey = normalizeKey(fournisseur);
    const dup = (existingNames || []).find(
      (r) => r.id !== (rec && rec.id) && normalizeKey(supplierNameOf(r)) === nameKey
    );
    if (dup) {
      setError(`« ${supplierNameOf(dup)} » existe déjà dans le catalogue. Choisissez un autre nom ou modifiez la fiche existante.`);
      return;
    }
    onSave({
      fournisseur,
      contact: txt(draft.contact),
      email: txt(draft.email),
      telephone: txt(draft.telephone),
      adresse: txt(draft.adresse),
      referenceSifac: txt(draft.referenceSifac),
      categories: txt(draft.categories),
      siteWeb: txt(draft.siteWeb),
      commentaires: txt(draft.commentaires),
    }, rec && rec.id);
  };

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(3px)' }}>
      <div className="bg-slate-50 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden max-h-[94vh] flex flex-col">
        <div className="px-6 py-4 bg-gradient-to-br from-indigo-700 to-blue-700 text-white flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-black flex items-center gap-2">
              <span className="text-xl" aria-hidden="true">📇</span>
              {editing ? 'Modifier le fournisseur' : 'Ajouter un fournisseur'}
            </h2>
            <p className="text-indigo-100 text-xs">Fiche du catalogue utilisé par les Dépenses (BC) et les achats prévus / souhaités.</p>
          </div>
          <button type="button" onClick={onCancel} className="shrink-0 w-8 h-8 rounded-lg bg-white/15 hover:bg-white/30 text-white font-bold" title="Fermer">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-5 flex flex-col gap-3">
          <Section icon="🏢" title="Identité">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Nom du fournisseur" required>
                <input
                  className={MODAL_INPUT} value={draft.fournisseur} onChange={set('fournisseur')} list="librerie-fournisseurs"
                  placeholder="ex. Fournitures Laposte / Amazon Marketplace…" autoFocus
                />
                <datalist id="librerie-fournisseurs">
                  {(suggestions || []).map((n) => <option key={n} value={n} />)}
                </datalist>
              </Field>
              <Field label="Contact">
                <input className={MODAL_INPUT} value={draft.contact} onChange={set('contact')} placeholder="ex. Mme Dupont (service commercial)" />
              </Field>
            </div>
          </Section>

          <Section icon="✉️" title="Coordonnées">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Email">
                <input className={MODAL_INPUT} type="email" value={draft.email} onChange={set('email')} placeholder="ex. contact@fournisseur.fr" />
              </Field>
              <Field label="Téléphone">
                <input className={MODAL_INPUT} type="tel" value={draft.telephone} onChange={set('telephone')} placeholder="ex. 01 23 45 67 89" />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Adresse">
                  <textarea
                    className={`${MODAL_INPUT} min-h-[60px]`} value={draft.adresse} onChange={set('adresse')}
                    placeholder="Rue, code postal, ville…"
                  />
                </Field>
              </div>
            </div>
          </Section>


          <Section icon="🔖" title="Références">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field
                label="Référence SIFAC"
                hint="Référence / n° de tiers du fournisseur dans SIFAC (à ne pas confondre avec le n° SIFAC d’une commande)."
              >
                <input
                  className={`${MODAL_INPUT} font-mono text-xs`} value={draft.referenceSifac} onChange={set('referenceSifac')}
                  placeholder="ex. 0000123456"
                />
              </Field>
              <Field label="Site web">
                <input className={MODAL_INPUT} value={draft.siteWeb} onChange={set('siteWeb')} placeholder="ex. https://www.fournisseur.fr" />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Catégories associées" hint="Facultatif : séparez les catégories par des virgules.">
                  <input className={MODAL_INPUT} value={draft.categories} onChange={set('categories')} placeholder="ex. Consommables, Instrumentation" />
                </Field>
              </div>
            </div>
          </Section>

          <Section icon="📝" title="Commentaires">
            <textarea
              className={`${MODAL_INPUT} min-h-[72px]`} value={draft.commentaires} onChange={set('commentaires')}
              placeholder="Notes internes sur ce fournisseur (délais, conditions, interlocuteurs…)."
            />
          </Section>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-semibold text-red-600">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 bg-white border-t border-slate-200">
          <button type="button" onClick={onCancel} className="px-4 py-2 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-200 bg-slate-100">
            Annuler
          </button>
          <button
            type="button" onClick={submit}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm px-5 py-2 rounded-xl shadow-sm transition-colors"
          >
            💾 {editing ? 'Enregistrer les modifications' : 'Ajouter au catalogue'}
          </button>
        </div>
      </div>
    </div>
  );
};


/* ═════════════════════════════════════════════════════════════════════════
   Page Librerie
   ═════════════════════════════════════════════════════════════════════════ */
export const LibreriePage = () => {
  const {
    data, upsert, remove, importMany,
    access, navigate, focus, clearFocus,
    settings,
  } = useAdmin();
  const librerie = useMemo(() => (Array.isArray(data.librerie) ? data.librerie : []), [data.librerie]);
  const depenses = useMemo(() => (Array.isArray(data.depenses) ? data.depenses : []), [data.depenses]);
  const recettes = useMemo(() => (Array.isArray(data.recettes) ? data.recettes : []), [data.recettes]);
  const personnel = useMemo(() => (Array.isArray(data.personnel) ? data.personnel : []), [data.personnel]);
  const om = useMemo(() => (Array.isArray(data.om) ? data.om : []), [data.om]);
  const desiderate = useMemo(() => (Array.isArray(data.desiderate) ? data.desiderate : []), [data.desiderate]);

  /* Gestion des lignes budgétaires depuis cette sous-table : mêmes droits que
     la page « Recettes » (matrice d’accès par défaut + règles personnalisées). */
  const canEditRecettes = !!access.canViewPage({ id: 'recettes' });
  const types = Array.isArray(settings && settings.recetteTypes) && settings.recetteTypes.length
    ? settings.recetteTypes
    : RECETTE_TYPES;

  /* Deux sous-tables dans la Librerie : le catalogue fournisseurs (fiches de la
     collection `librerie`) et les lignes budgétaires (mêmes fiches que la page
     « Recettes », vues ici comme catalogue : montant total, porteur, échéance…). */
  const [tab, setTab] = useState('fournisseurs'); // 'fournisseurs' | 'lignes'
  const [focusRow, setFocusRow] = useState(null);
  const canViewPersonnel = !!access.canViewPage({ id: 'personnel' });

  const [modal, setModal] = useState(null); // null | { mode:'new' } | { mode:'edit', rec }
  const [lineModal, setLineModal] = useState(null); // lignes budgétaires : { mode:'new' } | { mode:'edit'|'link', rec }
  const [notice, setNotice] = useState(null); // { tone, text }

  /* Navigation inter-page entrante (ex. Dépenses → Librerie) : ouvre la bonne
     sous-table et met en évidence la fiche ciblée (fournisseur ou ligne). */
  useEffect(() => {
    if (!focus || !focus.recordId) return;
    if (focus.pageId !== 'librerie') return;
    if (focus.kind === 'recette') setTab('lignes');
    else setTab('fournisseurs');
    setFocusRow(focus.recordId);
    if (typeof clearFocus === 'function') clearFocus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  /* Noms distincts de fournisseurs saisis dans les Dépenses (colonne
     « Fournisseur ») — une fiche catalogue manquante = un nom à créer. */
  const depenseNames = useMemo(() => {
    const map = new Map(); // normalizeKey -> premier libellé rencontré
    depenses.forEach((d) => {
      const name = txt(pick(d, ['fournisseur', 'nomFournisseur', 'fournisseurNom', 'nom', 'name']));
      if (!name) return;
      const k = normalizeKey(name);
      if (!map.has(k)) map.set(k, name);
    });
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], 'fr')).map(([key, label]) => ({ key, label }));
  }, [depenses]);

  const existingKeys = useMemo(() => {
    const set = new Set();
    librerie.forEach((r) => {
      const k = normalizeKey(supplierNameOf(r));
      if (k) set.add(k);
    });
    return set;
  }, [librerie]);

  const missingCount = useMemo(
    () => depenseNames.filter((d) => !existingKeys.has(d.key)).length,
    [depenseNames, existingKeys]
  );

  const suggestions = useMemo(() => {
    const set = new Set();
    depenseNames.forEach((d) => set.add(d.label));
    librerie.forEach((r) => {
      const n = supplierNameOf(r);
      if (n) set.add(n);
    });
    return [...set].sort((a, b) => a.localeCompare(b, 'fr'));
  }, [depenseNames, librerie]);

  const rows = useMemo(
    () => [...librerie].sort((a, b) => supplierNameOf(a).localeCompare(supplierNameOf(b), 'fr')),
    [librerie]
  );

  /* ── Sous-table « Lignes budgétaires » (mêmes fiches que la page Recettes) ── */
  const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const personLabel = (p) => {
    const n = txt(p && p.nom);
    const pr = txt(p && p.prenom);
    if (pr && n && !n.startsWith(pr)) return `${pr} ${n}`;
    return n || pr || '';
  };
  const lineAcronym = (r) => {
    const direct = txt(pick(r, ['acronyme', 'acronym', 'code']));
    if (direct) return direct;
    const s = txt(r && r.ligne);
    if (!s) return '';
    const m = s.match(/^[^\s(—–-]+/);
    return m ? m[0].replace(/[:.–]+$/, '') : '';
  };
  const personOf = (r) => {
    if (r && r.porteurId) {
      const direct = personnel.find((x) => x && x.id === r.porteurId);
      if (direct) return direct;
    }
    const label = txt(r && pick(r, ['porteur', 'porteurNom']));
    if (!label) return null;
    const key = normalizeKey(label);
    if (!key) return null;
    return personnel.find((x) => normalizeKey(personLabel(x)) === key) || null;
  };
  const goToPersonnel = (personId) => {
    if (!canViewPersonnel || !personId) return;
    if (typeof navigate === 'function') navigate('personnel', { kind: 'person', recordId: personId });
  };
  const recetteRows = useMemo(
    () => [...recettes].sort((a, b) => txt(a.ligne).localeCompare(txt(b.ligne), 'fr')),
    [recettes]
  );
  const recetteCols = [
    {
      key: 'ligne', label: 'Ligne budgétaire', filter: 'facet',
      value: (r) => txt(r.ligne),
      display: (r) => (
        <div className="min-w-[180px] max-w-[260px]">
          <div className="font-mono text-[11px] font-bold text-indigo-700 leading-snug break-words" title={r.ligne}>{txt(r.ligne) || <span className="text-slate-300">—</span>}</div>
        </div>
      ),
    },
    {
      key: 'acronyme', label: 'Acronyme', filter: 'facet',
      value: (r) => lineAcronym(r),
      display: (r) => {
        const a = lineAcronym(r);
        return a
          ? <span className="inline-block font-mono text-[10px] font-black px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-slate-600">{a}</span>
          : <span className="text-slate-300">—</span>;
      },
    },
    {
      key: 'type', label: 'Type', filter: 'facet',
      value: (r) => txt(r.type),
      display: (r) => {
        const t = txt(r.type);
        if (!t) return <span className="text-slate-300">—</span>;
        const tLow = t.toLowerCase();
        const tone = tLow === 'investissement'
          ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
          : (tLow === 'salaire' || tLow === 'salaires' || tLow === 'autres')
            ? 'bg-amber-50 border-amber-200 text-amber-700'
            : 'bg-emerald-50 border-emerald-200 text-emerald-700';
        return <span className={`inline-block text-[10px] font-black uppercase px-2 py-0.5 rounded-full border ${tone}`}>{t}</span>;
      },
    },
    {
      key: 'porteur', label: 'Porteur du projet', filter: 'facet',
      value: (r) => {
        const p = personOf(r);
        return (p ? personLabel(p) : txt(pick(r, ['porteur', 'porteurNom']))) || '';
      },
      display: (r) => {
        const p = personOf(r);
        const raw = txt(pick(r, ['porteur', 'porteurNom']));
        const shown = (p ? personLabel(p) : raw) || '';
        if (!shown) return <span className="text-slate-300">—</span>;
        if (p && canViewPersonnel) {
          return (
            <button
              type="button"
              onClick={() => goToPersonnel(p.id)}
              className="text-xs font-semibold text-slate-700 underline decoration-slate-300 underline-offset-2 hover:text-blue-700 hover:decoration-blue-300 whitespace-nowrap"
              title={`Ouvrir la fiche de ${shown} dans Personnel`}
            >{shown}</button>
          );
        }
        return (
          <span
            className="text-xs font-semibold text-slate-600 whitespace-nowrap"
            title={p && !canViewPersonnel
              ? 'Page Personnel réservée au superutilisateur'
              : (p ? shown : `${raw || shown} — pas de fiche Personnel correspondante`)}
          >{shown}</span>
        );
      },
    },
    {
      key: 'budgetTotal', label: 'Budget total', numeric: true, dataType: 'number', filter: 'auto',
      value: (r) => num(r.budgetTotal),
      display: (r) => {
        const n = num(r.budgetTotal);
        return n === null
          ? <span className="text-slate-300">—</span>
          : <span className="whitespace-nowrap text-xs font-black text-slate-700 tabular-nums">{euro.format(n)}</span>;
      },
    },
    {
      key: 'misADispo', label: 'Mis à dispo (université)', numeric: true, dataType: 'number', filter: 'auto',
      value: (r) => num(r.budgetRenduDispo),
      display: (r) => {
        const n = num(r.budgetRenduDispo);
        return n === null
          ? <span className="text-slate-300">—</span>
          : <span className="whitespace-nowrap text-xs font-semibold text-slate-600 tabular-nums">{euro.format(n)}</span>;
      },
    },
    {
      key: 'periode', label: 'Période',
      header: <span title="Dates de début / de fin de la période couverte par la ligne — la « fin d’engagement » des crédits reste dans sa propre colonne">Période</span>,
      filter: 'text',
      value: (r) => [String(r.dateDebut || ''), String(r.dateFin || '')].filter(Boolean).join(' '),
      display: (r) => {
        const d = txt(r.dateDebut);
        const f = txt(r.dateFin);
        if (!d && !f) return <span className="text-slate-300">—</span>;
        return (
          <span className="whitespace-nowrap text-xs font-semibold text-slate-600">
            <span>{toFrDate(d) || '…'}</span>
            <span className="mx-1 text-slate-300">→</span>
            <span>{toFrDate(f) || '…'}</span>
          </span>
        );
      },
    },
    {
      key: 'dateFin', label: 'Date de fin d’engagement', filter: 'text',
      value: (r) => String(r.dateFinEngagement || '').trim().slice(0, 10),
      display: (r) => {
        const iso = String(r.dateFinEngagement || '').trim().slice(0, 10);
        const fr = toFrDate(iso);
        return fr
          ? <span className="whitespace-nowrap text-xs font-semibold text-slate-600">{fr}</span>
          : <span className="text-slate-300">—</span>;
      },
    },
    {
      key: 'commentairesLigne', label: 'Commentaires', filter: 'text',
      value: (r) => pick(r, ['notes', 'commentaires', 'commentaire']),
      display: (r) => {
        const v = txt(pick(r, ['notes', 'commentaires', 'commentaire']));
        return v
          ? <div className="text-[11px] text-slate-500 max-w-[240px] leading-snug line-clamp-2" title={v}>{v}</div>
          : <span className="text-slate-300">—</span>;
      },
    },
    ...(canEditRecettes ? [{
      key: 'ligneActions', label: '', sortable: false, filterable: false, align: 'right', nowrap: true,
      value: () => '',
      display: (r) => (
        <div className="flex items-center gap-1 justify-end">
          <button onClick={() => setLineModal({ mode: 'link', rec: r })} title="Lier dépenses / OM / achats prévus"
            className="w-7 h-7 rounded-lg border border-slate-200 text-slate-400 hover:bg-blue-50 hover:text-blue-600 text-xs">🔗</button>
          <button onClick={() => setLineModal({ mode: 'edit', rec: r })} title="Modifier"
            className="w-7 h-7 rounded-lg border border-slate-200 text-slate-400 hover:bg-blue-50 hover:text-blue-600 text-xs">✎</button>
          <button onClick={() => onRemoveLine(r)} title="Supprimer"
            className="w-7 h-7 rounded-lg border border-slate-200 text-slate-400 hover:bg-red-50 hover:text-red-600 text-xs">🗑</button>
        </div>
      ),
    }] : []),
  ];

  const onSave = (cleaned, existingId) => {
    upsert('librerie', cleaned, existingId);
    setModal(null);
    setNotice({
      tone: 'ok',
      text: existingId
        ? `Fiche « ${cleaned.fournisseur} » enregistrée.`
        : `Fournisseur « ${cleaned.fournisseur} » ajouté au catalogue.`,
    });
    return true;
  };

  const onRemove = (rec) => {
    if (!rec || !rec.id) return;
    const label = supplierNameOf(rec) || rec.id;
    if (!window.confirm(
      `Retirer le fournisseur « ${label} » du catalogue ?\nLes Dépenses et souhaits déjà saisis conservent leur libellé texte.`
    )) return;
    remove('librerie', rec.id);
    setNotice({ tone: 'ok', text: `Fournisseur « ${label} » retiré du catalogue.` });
  };

  const onSaveLine = (patch, existingId) => {
    if (!String(patch.ligne || '').trim()) { alert('Merci de donner un intitulé à la ligne budgétaire.'); return; }
    const cleaned = {
      ...patch,
      ligne: String(patch.ligne || '').trim(),
      type: patch.type || (types && types[0]) || 'Fonctionnement',
      porteur: String(patch.porteur || '').trim(),
      budgetTotal: (patch.budgetTotal === '' || patch.budgetTotal === null || patch.budgetTotal === undefined) ? null : Number(patch.budgetTotal),
      budgetRenduDispo: (patch.budgetRenduDispo === '' || patch.budgetRenduDispo === null || patch.budgetRenduDispo === undefined) ? null : Number(patch.budgetRenduDispo),
      dateDebut: String(patch.dateDebut || '').trim().slice(0, 10),
      dateFin: String(patch.dateFin || '').trim().slice(0, 10),
      dateFinEngagement: String(patch.dateFinEngagement || '').trim().slice(0, 10),
      notes: String(patch.notes || ''),
    };
    if (cleaned.budgetTotal !== null && !Number.isFinite(cleaned.budgetTotal)) cleaned.budgetTotal = null;
    if (cleaned.budgetRenduDispo !== null && !Number.isFinite(cleaned.budgetRenduDispo)) cleaned.budgetRenduDispo = null;
    upsert('recettes', cleaned, existingId);
    setLineModal(null);
    setNotice({
      tone: 'ok',
      text: existingId
        ? `Ligne budgétaire « ${cleaned.ligne} » enregistrée.`
        : `Ligne budgétaire « ${cleaned.ligne} » créée — retrouvez-la aussi dans la page « Recettes ».`,
    });
    return true;
  };

  const onRemoveLine = (rec) => {
    if (!rec || !rec.id) return;
    const label = txt(rec.ligne) || rec.id;
    if (!window.confirm(`Supprimer la ligne budgétaire « ${label} » ?\nLes dépenses, OM et achats prévus déjà saisis conserveront leur intitulé texte.`)) return;
    remove('recettes', rec.id);
    setNotice({ tone: 'ok', text: `Ligne budgétaire « ${label} » supprimée.` });
  };

  const syncFromDepenses = () => {
    const missing = buildMissingFournisseurs(depenses, librerie);
    if (!missing.length) {
      setNotice({ tone: 'info', text: 'Catalogue à jour : chaque fournisseur présent dans les Dépenses a déjà sa fiche.' });
      return;
    }
    const { added } = importMany('librerie', missing);
    const plural = added > 1 ? 's' : '';
    setNotice({
      tone: 'ok',
      text: `${added} fiche${plural} fournisseur${plural} créée${plural} depuis la colonne « Fournisseur » des Dépenses.`,
    });
  };


  const columns = [
    {
      key: 'fournisseur', label: 'Fournisseur', filter: 'text',
      value: (r) => supplierNameOf(r),
      display: (r) => {
        const v = supplierNameOf(r);
        return v ? <div className="font-bold text-slate-800 min-w-[180px] leading-snug">{v}</div> : <span className="text-slate-300">{r.id || '—'}</span>;
      },
    },
    {
      key: 'contact', label: 'Contact', filter: 'text',
      value: (r) => pick(r, ['contact', 'contactFournisseur']),
      display: (r) => {
        const v = pick(r, ['contact', 'contactFournisseur']);
        return v ? <span className="text-xs text-slate-600">{v}</span> : <span className="text-slate-300">—</span>;
      },
    },
    {
      key: 'email', label: 'Email', filter: 'text',
      value: (r) => pick(r, ['email', 'mail']),
      display: (r) => {
        const v = pick(r, ['email', 'mail']);
        return v
          ? <a href={`mailto:${v}`} className="text-xs text-blue-700 break-all hover:underline">{v}</a>
          : <span className="text-slate-300">—</span>;
      },
    },
    {
      key: 'telephone', label: 'Téléphone', filter: 'text',
      value: (r) => pick(r, ['telephone', 'tel', 'phone']),
      display: (r) => {
        const v = pick(r, ['telephone', 'tel', 'phone']);
        return v ? <span className="text-xs text-slate-600 whitespace-nowrap">{v}</span> : <span className="text-slate-300">—</span>;
      },
    },
    {
      key: 'adresse', label: 'Adresse', filter: 'text',
      value: (r) => pick(r, ['adresse', 'address']),
      display: (r) => {
        const v = pick(r, ['adresse', 'address']);
        return v ? <div className="text-[11px] text-slate-500 max-w-[220px] leading-snug">{v}</div> : <span className="text-slate-300">—</span>;
      },
    },
    {
      key: 'referenceSifac', label: 'Réf. SIFAC', filter: 'text',
      value: (r) => pick(r, ['referenceSifac', 'refSifac', 'sifacTiers', 'siret']),
      display: (r) => {
        const v = pick(r, ['referenceSifac', 'refSifac', 'sifacTiers', 'siret']);
        return v
          ? <span className="text-xs font-mono text-slate-700 whitespace-nowrap" title="Référence / n° de tiers du fournisseur dans SIFAC">{v}</span>
          : <span className="text-slate-300">—</span>;
      },
    },
    {
      key: 'categories', label: 'Catégories', filter: 'text',
      value: (r) => (Array.isArray(r.categories) ? r.categories.join(' ') : pick(r, ['categories', 'categorie'])),
      display: (r) => {
        const cats = Array.isArray(r.categories)
          ? r.categories
          : txt(pick(r, ['categories', 'categorie'])).split(/[,;]+/).map((s) => s.trim()).filter(Boolean);
        return cats.length
          ? <div className="flex flex-wrap gap-1 max-w-[240px]">{cats.map((c) => <span key={c} className="bg-blue-50 border border-blue-200 text-blue-600 rounded-md px-1.5 py-0.5 text-[10px] font-semibold">{c}</span>)}</div>
          : <span className="text-slate-300">—</span>;
      },
    },
    {
      key: 'site', label: 'Site web', filter: 'text',
      value: (r) => pick(r, ['siteWeb', 'site', 'website', 'url', 'lien']),
      display: (r) => {
        const v = pick(r, ['siteWeb', 'site', 'website', 'url', 'lien']);
        return v
          ? <a href={/^https?:/i.test(v) ? v : `https://${v}`} target="_blank" rel="noreferrer" className="text-[11px] text-blue-600 hover:underline break-all max-w-[220px] inline-block">{v}</a>
          : <span className="text-slate-300">—</span>;
      },
    },
    {
      key: 'commentaires', label: 'Commentaires', filter: 'text', hidden: true,
      value: (r) => pick(r, ['commentaires', 'notes', 'note']),
    },
    {
      key: 'actions', label: '', filter: 'none', filterable: false,
      value: () => '',
      display: (r) => (
        <div className="flex items-center gap-1 whitespace-nowrap">
          <button
            type="button"
            title="Modifier la fiche fournisseur"
            onClick={() => setModal({ mode: 'edit', rec: r })}
            className="text-[11px] font-black px-2 py-1 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
          >✏️ Modifier</button>
          <button
            type="button"
            title="Retirer du catalogue"
            onClick={() => onRemove(r)}
            className="text-[11px] font-black px-2 py-1 rounded-lg border border-red-200 bg-red-50 text-red-500 hover:bg-red-100 transition-colors"
          >🗑️</button>
        </div>
      ),
    },
  ];

  return (
    <div className="w-full min-w-0 mx-auto flex flex-col gap-4">
      {/* En-tête */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs font-bold text-slate-400 max-w-2xl">
          {librerie.length} fournisseur{librerie.length > 1 ? 's' : ''} au catalogue · {recettes.length} ligne{recettes.length > 1 ? 's' : ''} budgétaire{recettes.length > 1 ? 's' : ''} —
          depuis la page Dépenses, un fournisseur ou une ligne budgétaire cliquable ouvre la fiche correspondante ici.
        </p>
        {tab === 'fournisseurs' && (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={syncFromDepenses}
              disabled={!depenseNames.length}
              title={depenseNames.length
                ? 'Créer une fiche catalogue pour chaque fournisseur saisi dans la colonne « Fournisseur » des Dépenses et absent du catalogue.'
                : 'Aucune dépense avec un fournisseur renseigné pour le moment.'}
              className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 font-bold text-sm px-4 py-2 rounded-xl shadow-sm transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span className="text-base leading-none">↻</span> Créer depuis les Dépenses
            </button>
            <button
              type="button"
              onClick={() => setModal({ mode: 'new' })}
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm px-4 py-2 rounded-xl shadow-sm transition-colors flex items-center gap-1.5"
            >
              <span className="text-base leading-none">＋</span> Ajouter un fournisseur
            </button>
          </div>
        )}
        {tab === 'lignes' && canEditRecettes && (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setLineModal({ mode: 'new' })}
              title="Créer une nouvelle ligne budgétaire (Fonctionnement / Investissement) — mêmes droits que la page « Recettes »."
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm px-4 py-2 rounded-xl shadow-sm transition-colors flex items-center gap-1.5"
            >
              <span className="text-base leading-none">＋</span> Nouvelle ligne budgétaire
            </button>
          </div>
        )}
      </div>

      {/* Onglets : Fournisseurs · Lignes budgétaires */}
      <div className="flex items-center gap-1.5 bg-slate-200/60 border border-slate-200 rounded-xl p-1 w-fit">
        <button
          type="button"
          onClick={() => setTab('fournisseurs')}
          className={`flex items-center gap-1.5 text-xs font-black px-3 py-1.5 rounded-lg transition-colors ${
            tab === 'fournisseurs'
              ? 'bg-white text-slate-800 shadow-sm border border-slate-200'
              : 'text-slate-500 hover:text-slate-700 border border-transparent'
          }`}
        >
          <span aria-hidden="true">📇</span> Fournisseurs
          <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-500">{librerie.length}</span>
        </button>
        <button
          type="button"
          onClick={() => setTab('lignes')}
          className={`flex items-center gap-1.5 text-xs font-black px-3 py-1.5 rounded-lg transition-colors ${
            tab === 'lignes'
              ? 'bg-white text-slate-800 shadow-sm border border-slate-200'
              : 'text-slate-500 hover:text-slate-700 border border-transparent'
          }`}
        >
          <span aria-hidden="true">📈</span> Lignes budgétaires
          <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-500">{recettes.length}</span>
        </button>
      </div>

      {tab === 'fournisseurs' ? (
        <>
          {notice && <Notice tone={notice.tone} text={notice.text} onClose={() => setNotice(null)} />}

          <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-2.5 text-[11px] text-slate-600 leading-relaxed">
            <b>Fonctionnement :</b> chaque fiche référence un fournisseur avec son contact, son adresse, son email, sa
            <b> référence SIFAC</b> (n° de tiers) et des commentaires. Le bouton <b>« ↻ Créer depuis les Dépenses »</b> ajoute
            automatiquement une fiche pour chaque fournisseur présent dans la colonne « Fournisseur » des Dépenses et encore
            absent du catalogue ; les imports de Dépenses font de même à la volée. « ✏️ Modifier » ouvre la fiche complète.
          </div>

      {librerie.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-10 text-center">
          <div className="text-4xl mb-2">🗂️</div>
          <p className="font-black text-slate-700">Catalogue des fournisseurs vide</p>
          <p className="text-sm text-slate-400 mt-1">
            {missingCount
              ? `Il y a ${missingCount} fournisseur${missingCount > 1 ? 's' : ''} dans les Dépenses sans fiche ici — cliquez sur « ↻ Créer depuis les Dépenses », ou ajoutez-les à la main.`
              : 'Utilisez « ＋ Ajouter un fournisseur » pour créer la première fiche (contact, adresse, email, référence SIFAC…).'}
          </p>
        </div>
      ) : (
        <SmartTable
          columns={columns}
          rows={rows}
          minWidth="1750px"
          focusRowKey={focusRow}
          onFocusDone={() => setFocusRow(null)}
          searchPlaceholder="Rechercher un fournisseur, contact, email, adresse, référence SIFAC…"
          emptyLabel="Catalogue des fournisseurs vide"
          noMatchLabel="Aucun fournisseur ne correspond aux filtres."
        />
      )}
        </>
      ) : (
        <>
          <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-2.5 text-[11px] text-slate-600 leading-relaxed">
            <b>Lignes budgétaires :</b> catalogue des lignes (Fonctionnement / Investissement / Salaire) avec montant total,
            montant mis à disposition par l’université, dates de début / de fin, date de fin d’engagement, porteur du projet et commentaires.
            Les fiches se gèrent dans la page <b>« Recettes »</b> (création, solde, import) ; le <b>porteur</b> est un lien
            vers sa fiche dans la page Personnel{canViewPersonnel ? '' : ' (réservée au superutilisateur)'}.
            {canEditRecettes ? (
              <div className="mt-1 text-blue-700">
                💡 « ＋ Nouvelle ligne budgétaire » (et les actions 🔗 ✎ 🗑 de chaque ligne) crée / modifie les fiches
                ici-même, avec les mêmes droits que la page « Recettes ».
              </div>
            ) : null}
          </div>

          {recetteRows.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-10 text-center">
              <div className="text-4xl mb-2">📈</div>
              <p className="font-black text-slate-700">Aucune ligne budgétaire</p>
              <p className="text-sm text-slate-400 mt-1">
                {canEditRecettes
                  ? 'Cliquez sur « ＋ Nouvelle ligne budgétaire » pour créer la première ligne (Fonctionnement / Investissement / Salaire) ; la page « Recettes » reste disponible pour le suivi complet (solde, import…).'
                  : 'Les lignes budgétaires sont créées dans la page « Recettes » (lignes Fonctionnement / Investissement / Salaire) et apparaissent ici comme catalogue.'}
              </p>
            </div>
          ) : (
            <SmartTable
              columns={recetteCols}
              rows={recetteRows}
              minWidth="1400px"
              focusRowKey={focusRow}
              onFocusDone={() => setFocusRow(null)}
              searchPlaceholder="Rechercher une ligne, un acronyme, un porteur…"
              emptyLabel="Aucune ligne budgétaire"
              noMatchLabel="Aucune ligne ne correspond aux filtres."
            />
          )}
        </>
      )}

      {modal && tab === 'fournisseurs' && (
        <FournisseurModal
          rec={modal.mode === 'edit' ? modal.rec : null}
          suggestions={suggestions}
          existingNames={librerie}
          onCancel={() => setModal(null)}
          onSave={onSave}
        />
      )}

      {lineModal && tab === 'lignes' && canEditRecettes && (
        <LineModal
          modal={lineModal}
          types={types}
          personnel={personnel}
          depenses={depenses}
          om={om}
          desiderate={desiderate}
          onCancel={() => setLineModal(null)}
          onSave={onSaveLine}
        />
      )}
    </div>
  );
};
