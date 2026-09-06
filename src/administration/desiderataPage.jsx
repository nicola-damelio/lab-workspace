/* =========================================================================
   src/administration/desiderataPage.jsx
   Page « Achats prévus / souhaités » (souhaits d’achat, collection desiderate).
   CRUD complet en remplacement de la liste générique :

     · bouton « ＋ Ajouter un achat prévu / souhaité » : le demandeur déclare
       l’article, le fournisseur, la ligne budgétaire suggérée, le COÛT
       estimé et les FRAIS DE PORT ;
     · la PREMIÈRE colonne contient la décision du superutilisateur
       (Approuvé / En attente / Pas maintenant — personnalisable dans
       Setup › Options des listes déroulantes) ; les autres membres ne
       peuvent pas modifier cette décision ;
     · colonnes cliquables : fournisseur → Librerie, ligne budgétaire →
       Librerie (onglet Lignes budgétaires), demandeur → fiche Personnel.

   Modèle stocké (mêmes clés que l’import Google Sheets « Souhaités ») :
     { description, urgence / priorite, demandeur, categorie,
       recetteSuggereeId, ligneBudgetaire, montantEstime, fraisPort,
       dateDemande, fournisseur, contact, numDevis, numDevisUrl, devis2,
       devis3, codeProduit, commentaires, statut, statutChangedBy?,
       statutChangedAt? }
     + enveloppe d’audit posée par upsert() (createdAt/By, updatedAt/By).
   ========================================================================= */
import React, { useEffect, useMemo, useState } from 'react';
import { useAdmin } from './AdminContext';
import { SmartTable } from './smartTable';
import { AdminImportModal } from './adminImportModal';
import {
  ADMIN_PAGES, RECETTE_TYPES, URGENCES, DESIDERATE_STATUSES,
  desiderataDecisionOf, isDesiderataApproved,
} from './adminSchema';
import { parseEuroAmount, extractNumeroFromDoc } from './importUtils';
import { findRecetteTwin, sameCatType } from './recetteLink';
import {
  sendAdminMail, personnelEmailsMatching, superuserEmailsOf, mergeEmails,
  summarizeMail, mailBodyText,
} from './emailNotify';

/* ── Petites aides ──────────────────────────────────────────────────────── */
const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const txt = (v) => (v === null || v === undefined ? '' : String(v).trim());
const pick = (rec, keys) => {
  for (const k of keys) {
    const v = rec && rec[k];
    if (txt(v)) return v;
  }
  return '';
};
const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const numOf = (v) => (v === null || v === undefined || v === '' ? null : toNum(v));
const numToInput = (v) => {
  const n = numOf(v);
  return n === null ? '' : String(n).replace('.', ',');
};
const parseNum = (v) => {
  const n = parseEuroAmount(v);
  return n === null ? null : Math.round(n * 100) / 100;
};
const isoOf = (v) => {
  const s = txt(v);
  return s ? s.slice(0, 10) : '';
};
const norm = (s) => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const demandeurOf = (r) => pick(r, ['demandeur', 'porteur', 'nom', 'name']);
const devisUrlOf = (r) => txt(pick(r, ['numDevisUrl', 'devisUrl', 'urlDevis', 'lienDevis', 'devisLink']));
const addScheme = (u) => (/^(https?:|mailto:|tel:)/i.test(u) ? u : `https://${u}`);

/* Code « devis » avec lien Google Drive facultatif vers le document. */
const DevisLink = ({ code, url }) => {
  const v = txt(code);
  const u = txt(url);
  if (!v && !u) return <span className="text-slate-300">—</span>;
  const label = v || 'document';
  return (
    <span className="inline-flex items-center gap-1 min-w-0 max-w-full">
      {u ? (
        <a
          href={addScheme(u)} target="_blank" rel="noreferrer"
          onClick={(e) => e.stopPropagation()} title={u}
          className="min-w-0 truncate font-mono text-[11px] font-semibold text-blue-700 hover:text-blue-900 underline decoration-blue-300 underline-offset-2 transition-colors"
        >{label}</a>
      ) : (
        <span className="font-mono text-[11px] font-semibold text-slate-600 truncate" title={v}>{label}</span>
      )}
      {u ? (
        <a
          href={addScheme(u)} target="_blank" rel="noreferrer"
          onClick={(e) => e.stopPropagation()} title={u}
          className="shrink-0 text-[10px] leading-4 font-black text-blue-600 hover:text-blue-800 border border-blue-200 hover:bg-blue-50 rounded px-1"
        >↗</a>
      ) : null}
    </span>
  );
};

/* Petits éléments d’affichage (mêmes classes que les autres pages d’admin). */
const TONES = {
  slate: 'bg-slate-100 border-slate-200 text-slate-600',
  blue: 'bg-blue-50 border-blue-200 text-blue-700',
  indigo: 'bg-indigo-50 border-indigo-200 text-indigo-700',
  emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  amber: 'bg-amber-50 border-amber-200 text-amber-700',
  orange: 'bg-orange-50 border-orange-200 text-orange-700',
  red: 'bg-red-50 border-red-200 text-red-600',
  violet: 'bg-violet-50 border-violet-200 text-violet-700',
  teal: 'bg-teal-50 border-teal-200 text-teal-700',
};
const Badge = ({ tone = 'slate', children }) => (
  <span className={`inline-block text-[10px] font-black uppercase px-2 py-0.5 rounded-full border ${TONES[tone] || TONES.slate}`}>
    {children}
  </span>
);

/* Pastille de DÉCISION (superutilisateur) à partir de la valeur stockée.
   « Approved » / « Pending » / « Rejected / Pas maintenant » (anciens imports)
   sont automatiquement affichés dans leur équivalent français. */
const DECISION_TONES = {
  [desiderataDecisionOf('Approved')]: 'emerald',
  [desiderataDecisionOf('Pending')]: 'amber',
  [desiderataDecisionOf('Rejected / Pas maintenant')]: 'red',
};
const decisionTone = (raw) => DECISION_TONES[desiderataDecisionOf(raw)] || 'slate';
const DecisionBadge = ({ raw }) =>
  txt(raw)
    ? <Badge tone={decisionTone(raw)}>{desiderataDecisionOf(raw)}</Badge>
    : <Badge tone="slate">En attente</Badge>;

/* ── Fenêtre d’ajout / édition d’un achat prévu / souhaité ─────────────── */
const MODAL_INPUT = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500';
const MODAL_URL_INPUT = `${MODAL_INPUT} font-mono text-xs text-blue-700 placeholder:text-slate-300 placeholder:font-sans`;
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


/* Le formulaire complet : le demandeur décrit le souhait, son coût et ses
   frais de port ; la décision n’est modifiable que par un superutilisateur. */
const DesiderataModal = ({
  rec, recettes, demandeurNames, fournisseurNames,
  types, urgenceOptions, decisionOptions, canDecide, currentUser, onApproved, onCancel, onSave,
}) => {
  const editing = !!rec;
  const [draft, setDraft] = useState(() => {
    const r = rec || {};
    return {
      description: txt(r && r.description),
      demandeur: txt(demandeurOf(r)),
      categorie: txt(r && r.categorie),
      urgence: txt(pick(r, ['priorite', 'urgence'])),
      recetteSuggereeId: (r && r.recetteSuggereeId) || '',
      ligneBudgetaire: txt(r && r.ligneBudgetaire),
      montantEstime: numToInput(r && r.montantEstime),
      fraisPort: numToInput(r && r.fraisPort),
      fournisseur: txt(pick(r, ['fournisseur', 'nomFournisseur'])),
      contact: txt(r && r.contact),
      numDevis: txt(pick(r, ['numDevis', 'devisNo'])),
      numDevisUrl: devisUrlOf(r),
      devis2: txt(r && r.devis2),
      devis3: txt(r && r.devis3),
      codeProduit: txt(r && r.codeProduit),
      dateDemande: isoOf(r && r.dateDemande),
      commentaires: txt(r && r.commentaires),
      statut: txt(r && r.statut) || 'En attente',
    };
  });
  const [error, setError] = useState('');
  const set = (key) => (e) => setDraft((d) => ({ ...d, [key]: e.target.value }));

  const setRecette = (e) => {
    const id = e.target.value;
    const found = recettes.find((x) => x.id === id);
    setDraft((d) => ({ ...d, recetteSuggereeId: id, ligneBudgetaire: found ? txt(found.ligne) : '' }));
  };

  /* Lien du devis : si aucun N° n’est saisi, on le pré-remplit depuis le nom
     du fichier porté par l’adresse (ex. « Devis_2026-015_Fournisseur.pdf »). */
  const setNumDevisUrl = (e) => {
    const u = e.target.value;
    setDraft((d) => ({
      ...d,
      numDevisUrl: u,
      numDevis: d.numDevis || extractNumeroFromDoc(u),
    }));
  };

  const submit = () => {
    const description = txt(draft.description);
    if (!description) {
      setError('Merci de décrire le souhait d’achat (obligatoire).');
      return;
    }
    const patch = {
      description,
      demandeur: txt(draft.demandeur),
      categorie: txt(draft.categorie),
      priorite: txt(draft.urgence),
      urgence: txt(draft.urgence),
      recetteSuggereeId: draft.recetteSuggereeId || null,
      ligneBudgetaire: txt(draft.ligneBudgetaire),
      montantEstime: parseNum(draft.montantEstime),
      fraisPort: parseNum(draft.fraisPort),
      fournisseur: txt(draft.fournisseur),
      contact: txt(draft.contact),
      numDevis: txt(draft.numDevis),
      numDevisUrl: txt(draft.numDevisUrl),
      devis2: txt(draft.devis2),
      devis3: txt(draft.devis3),
      codeProduit: txt(draft.codeProduit),
      dateDemande: isoOf(draft.dateDemande),
      commentaires: txt(draft.commentaires),
    };
    let approvalNow = false;
    if (canDecide) {
      const decided = desiderataDecisionOf(draft.statut) || 'En attente';
      const previous = desiderataDecisionOf(rec && rec.statut);
      patch.statut = decided;
      if (decided !== previous) {
        patch.statutChangedBy = (currentUser && currentUser.name) || '';
        patch.statutChangedAt = Date.now();
      }
      approvalNow = isDesiderataApproved(decided) && !isDesiderataApproved(previous);
    } else if (!editing) {
      patch.statut = 'En attente'; // nouveau souhait soumis → en attente de décision
    }
    onSave(patch, editing && rec.id);
    /* Une fois le souhait approuvé, un e-mail prévient le superutilisateur et
       le(s) gestionnaire(s). */
    if (approvalNow && typeof onApproved === 'function') onApproved(patch, editing && rec.id);
  };


  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(3px)' }}>
      <div className="bg-slate-50 rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden max-h-[94vh] flex flex-col">
        <div className="px-6 py-4 bg-gradient-to-br from-teal-600 to-cyan-700 text-white flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-black flex items-center gap-2">
              <span className="text-xl" aria-hidden="true">🛒</span>
              {editing ? 'Modifier l’achat prévu / souhaité' : 'Nouvel achat prévu / souhaité'}
            </h2>
            <p className="text-teal-100 text-xs">
              Souhait d’achat de l’équipe : décrivez l’article, son coût estimé et les frais de port — la décision
              (Approuvé / En attente / Pas maintenant) reste réservée au superutilisateur.
            </p>
          </div>
          <button type="button" onClick={onCancel} className="shrink-0 w-8 h-8 rounded-lg bg-white/15 hover:bg-white/30 text-white font-bold" title="Fermer">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-5 flex flex-col gap-3">
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-semibold text-red-600">
              {error}
            </div>
          )}

          <Section icon="📦" title="Article souhaité">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <Field label="Description / article" required>
                  <input
                    className={MODAL_INPUT} value={draft.description} onChange={set('description')}
                    placeholder="ex. Balance de précision 0,1 mg avec certificat d’étalonnage" autoFocus
                  />
                </Field>
              </div>
              <Field label="Urgence">
                <select className={MODAL_INPUT} value={draft.urgence} onChange={set('urgence')}>
                  <option value="">— Aucune —</option>
                  {(urgenceOptions || []).map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </Field>
              <Field label="Catégorie (Fonct. / Invest.)">
                <select className={MODAL_INPUT} value={draft.categorie} onChange={set('categorie')}>
                  <option value="">— Aucune —</option>
                  {(types || []).map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
            </div>
          </Section>

          <Section icon="👤" title="Demandeur & ligne budgétaire suggérée">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Demandeur">
                <input
                  className={MODAL_INPUT} value={draft.demandeur} onChange={set('demandeur')}
                  list="desiderata-demandeurs" placeholder="ex. Marie Curie"
                />
                <datalist id="desiderata-demandeurs">
                  {(demandeurNames || []).map((n) => <option key={n} value={n} />)}
                </datalist>
              </Field>
              <Field label="Ligne budgétaire suggérée" hint="La recette sur laquelle ce souhait serait imputé s’il est approuvé.">
                <select className={MODAL_INPUT} value={draft.recetteSuggereeId} onChange={setRecette}>
                  <option value="">— Aucune ligne suggérée —</option>
                  {recettes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {txt(r.ligne) || txt(r.name) || r.id}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </Section>

          <Section icon="💶" title="Coût estimé">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Coût estimé (€ HT)">
                <input
                  className={MODAL_INPUT} inputMode="decimal" value={draft.montantEstime} onChange={set('montantEstime')}
                  placeholder="ex. 1 250,00"
                />
              </Field>
              <Field label="Frais de port (€)" hint="Livraison si elle est facturée à part.">
                <input
                  className={MODAL_INPUT} inputMode="decimal" value={draft.fraisPort} onChange={set('fraisPort')}
                  placeholder="ex. 24,90"
                />
              </Field>
            </div>
          </Section>

          <Section icon="🏬" title="Fournisseur">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Nom du fournisseur">
                <input
                  className={MODAL_INPUT} value={draft.fournisseur} onChange={set('fournisseur')}
                  list="desiderata-fournisseurs" placeholder="ex. VWR International"
                />
                <datalist id="desiderata-fournisseurs">
                  {(fournisseurNames || []).map((n) => <option key={n} value={n} />)}
                </datalist>
              </Field>
              <Field label="Contact fournisseur">
                <input className={MODAL_INPUT} value={draft.contact} onChange={set('contact')} placeholder="ex. Jean Dupont" />
              </Field>
            </div>
          </Section>


          <Section icon="🧾" title="Devis & code produit">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="N° devis">
                <input className={MODAL_INPUT} value={draft.numDevis} onChange={set('numDevis')} placeholder="ex. 2025-012345" />
              </Field>
              <Field label="Devis 2">
                <input className={MODAL_INPUT} value={draft.devis2} onChange={set('devis2')} placeholder="devis concurrent" />
              </Field>
              <Field label="Devis 3">
                <input className={MODAL_INPUT} value={draft.devis3} onChange={set('devis3')} placeholder="devis concurrent" />
              </Field>
              <Field label="Code produit / référence" className="sm:col-span-3">
                <input className={MODAL_INPUT} value={draft.codeProduit} onChange={set('codeProduit')} placeholder="ex. 89501-432" />
              </Field>
            </div>
            <div className="mt-3">
              <Field
                label="Lien du devis ↗ (Google Drive, facultatif)"
                hint="Collez l’adresse du devis (PDF…) déjà déposé sur Google Drive : elle est conservée sur le souhait et le N° devis devient un lien cliquable dans le tableau. Si le N° est vide, il est pré-rempli depuis le nom du fichier (ex. « Devis_2026-015_Fournisseur.pdf » → 2026-015)."
              >
                <input
                  className={MODAL_URL_INPUT} value={draft.numDevisUrl} onChange={setNumDevisUrl}
                  placeholder="https://drive.google.com/…"
                />
              </Field>
            </div>
          </Section>

          <Section icon="⚖️" title="Décision du superutilisateur">
            {canDecide ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Décision" hint="La décision est enregistrée avec votre nom et l’horodatage.">
                  <select className={MODAL_INPUT} value={draft.statut} onChange={set('statut')}>
                    {(decisionOptions || []).map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </Field>
                <Field label="Date de la demande">
                  <input type="date" className={MODAL_INPUT} value={draft.dateDemande} onChange={set('dateDemande')} />
                </Field>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                <p className="text-xs text-slate-500 leading-relaxed">
                  La décision est prise par le superutilisateur
                  {editing
                    ? ' — elle reste inchangée à l’enregistrement.'
                    : ' — votre demande partira en « En attente ».'}
                </p>
                <Field label="Date de la demande">
                  <input type="date" className={MODAL_INPUT} value={draft.dateDemande} onChange={set('dateDemande')} />
                </Field>
              </div>
            )}
          </Section>

          <Section icon="💬" title="Commentaires">
            <textarea
              className={`${MODAL_INPUT} min-h-[70px]`} value={draft.commentaires} onChange={set('commentaires')}
              placeholder="Contexte, justificatifs, remarques…"
            />
          </Section>
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 bg-white border-t border-slate-200">
          <button type="button" onClick={onCancel} className="px-4 py-2 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-200 bg-slate-100">
            Annuler
          </button>
          <button type="button" onClick={submit} className="bg-teal-600 hover:bg-teal-700 text-white font-bold text-sm px-5 py-2 rounded-xl shadow-sm transition-colors">
            💾 {editing ? 'Enregistrer les modifications' : 'Ajouter l’achat prévu / souhaité'}
          </button>
        </div>
      </div>
    </div>
  );
};


/* ═════════════════════════════════════════════════════════════════════════
   Page « Achats prévus / souhaités »
   ═════════════════════════════════════════════════════════════════════════ */
export const DesiderataPage = () => {
  const {
    data, settings, upsert, remove, currentUser,
    access, navigate, focus, clearFocus, operators,
  } = useAdmin();
  const list = useMemo(() => (Array.isArray(data.desiderate) ? data.desiderate : []), [data.desiderate]);
  const depenses = useMemo(() => (Array.isArray(data.depenses) ? data.depenses : []), [data.depenses]);
  const recettes = useMemo(() => (Array.isArray(data.recettes) ? data.recettes : []), [data.recettes]);
  const personnel = useMemo(() => (Array.isArray(data.personnel) ? data.personnel : []), [data.personnel]);
  const librerie = useMemo(() => (Array.isArray(data.librerie) ? data.librerie : []), [data.librerie]);

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

  const [modal, setModal] = useState(null); // null | { mode:'new' } | { mode:'edit', rec }
  const [importOpen, setImportOpen] = useState(false);
  const [notice, setNotice] = useState(null);
  /* Souhait « cible » d’une navigation inter-page (page Recettes › survol d’un
     achat prévu) : on surligne le souhait correspondant dans le tableau. */
  const [focusRow, setFocusRow] = useState(null);

  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    if (!focus || focus.pageId !== 'desiderate') return;
    const rid = focus.recordId;
    if (rid && list.some((d) => d.id === rid)) setFocusRow(rid);
    if (typeof clearFocus === 'function') clearFocus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  /* La décision est réservée au superutilisateur. */
  const canDecide = !!access.canChangeWishlistStatus;

  /* Pages cibles des liens « vers la bibliothèque » (Librerie / Personnel). */
  const canViewLibrerie = useMemo(
    () => !!ADMIN_PAGES.find((p) => p.id === 'librerie' && access.canViewPage(p)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [access]
  );
  const canViewPersonnel = useMemo(
    () => !!ADMIN_PAGES.find((p) => p.id === 'personnel' && access.canViewPage(p)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [access]
  );
  const goToLibrerie = (kind, recordId) => {
    if (!canViewLibrerie || !recordId) return;
    if (typeof navigate === 'function') navigate('librerie', { kind, recordId });
  };
  const goToPersonnel = (personId) => {
    if (!canViewPersonnel || !personId) return;
    if (typeof navigate === 'function') navigate('personnel', { kind: 'person', recordId: personId });
  };

  /* Options de formulaires (réglages + valeurs déjà présentes dans la liste). */
  const types = Array.isArray(settings.recetteTypes) && settings.recetteTypes.length
    ? settings.recetteTypes : RECETTE_TYPES;
  const urgencyOptions = Array.isArray(settings.urgences) && settings.urgences.length
    ? settings.urgences : URGENCES;
  const decisionOptions = useMemo(() => {
    const base = (Array.isArray(settings.desiderateStatuses) && settings.desiderateStatuses.length)
      ? settings.desiderateStatuses : DESIDERATE_STATUSES;
    const set = base.map(desiderataDecisionOf);
    list.forEach((r) => set.push(desiderataDecisionOf(r && r.statut)));
    return [...new Set(set.filter(Boolean))];
  }, [settings, list]);

  /* Suggestions de listes. */
  const demandeurNames = useMemo(() => {
    const set = new Set();
    personnel.forEach((p) => {
      ['nom', 'prenom', 'name'].forEach((k) => { const n = txt(p && p[k]); if (n) set.add(n); });
    });
    list.forEach((r) => { const d = demandeurOf(r); if (d) set.add(d); });
    if (currentUser && txt(currentUser.name)) set.add(txt(currentUser.name));
    return [...set].sort((a, b) => a.localeCompare(b, 'fr'));
  }, [personnel, list, currentUser]);

  const fournisseurNames = useMemo(() => {
    const set = new Set();
    librerie.forEach((l) => {
      const n = pick(l, ['fournisseur', 'nomFournisseur', 'nom', 'name']);
      if (n) set.add(n);
    });
    list.forEach((r) => {
      const n = pick(r, ['fournisseur', 'nomFournisseur']);
      if (n) set.add(n);
    });
    return [...set].sort((a, b) => a.localeCompare(b, 'fr'));
  }, [librerie, list]);

  /* Index de recherche pour les liens (Librerie / Personnel). */
  const librerieById = useMemo(() => new Map(librerie.map((l) => [l.id, l])), [librerie]);
  const recettesById = useMemo(() => new Map(recettes.map((r) => [r.id, r])), [recettes]);
  const fournisseurByKey = useMemo(() => {
    const map = new Map();
    librerie.forEach((l) => {
      const k = norm(pick(l, ['fournisseur', 'nomFournisseur', 'nom', 'name']));
      if (k) map.set(k, l);
    });
    return map;
  }, [librerie]);
  const personnelByKey = useMemo(() => {
    const map = new Map();
    personnel.forEach((p) => {
      ['nom', 'prenom', 'name'].forEach((k) => {
        const key = norm(p && p[k]);
        if (key && !map.has(key)) map.set(key, p);
      });
    });
    return map;
  }, [personnel]);
  const ligneLabelOf = (r) => {
    const found = r && r.recetteSuggereeId ? (recettesById.get(r.recetteSuggereeId) || null) : null;
    return found ? (found.ligne || '') : txt(r && r.ligneBudgetaire);
  };
  const recetteOf = (r) => (r && r.recetteSuggereeId ? (recettesById.get(r.recetteSuggereeId) || null) : null);
  const fournisseurEntryOf = (r) => {
    if (!r) return null;
    const direct = r.fournisseurId ? librerieById.get(r.fournisseurId) : null;
    if (direct) return direct;
    const k = norm(pick(r, ['fournisseur', 'nomFournisseur']));
    return k ? (fournisseurByKey.get(k) || null) : null;
  };
  const personEntryOf = (r) => {
    const k = norm(demandeurOf(r));
    return k ? (personnelByKey.get(k) || null) : null;
  };

  /* Les plus récentes d’abord (date de demande, sinon création). */
  const sorted = useMemo(() => [...list].sort((a, b) => {
    const da = isoOf(a.dateDemande) || '';
    const db = isoOf(b.dateDemande) || '';
    if (!da && !db) return (b.createdAt || 0) - (a.createdAt || 0);
    if (!da) return 1;
    if (!db) return -1;
    return db.localeCompare(da);
  }), [list]);


  const onSave = (patch, existingId) => {
    const label = txt(patch.description) || 'souhait';
    upsert('desiderate', patch, existingId);
    setModal(null);
    setNotice({
      tone: 'ok',
      text: existingId
        ? `Achat prévu / souhaité « ${label} » enregistré.`
        : `Achat prévu / souhaité « ${label} » ajouté.`,
    });
  };

  const onRemove = (rec) => {
    if (!rec || !rec.id) return;
    const label = txt(rec.description) || rec.id;
    if (!window.confirm(`Supprimer l’achat prévu / souhaité « ${label} » ?\nCette action est définitive.`)) return;
    remove('desiderate', rec.id);
    setNotice({ tone: 'ok', text: `Achat prévu / souhaité « ${label} » supprimé.` });
  };

  /* E-mail au superutilisateur (et au(x) gestionnaire(s)) quand un souhait passe « Approuvé ». */
  const notifyApproved = async (patch) => {
    const label = txt(patch && patch.description) || 'achat prévu / souhaité';
    const subject = `[Lab Workspace] Achat prévu / souhaité approuvé — ${label}`;
    const lines = [
      'L’achat prévu / souhaité suivant a été approuvé :',
      `  ${label}`,
      `Demandeur : ${txt(patch && patch.demandeur) || '—'}`,
      (patch && patch.montantEstime !== undefined && patch.montantEstime !== null && patch.montantEstime !== '')
        ? `Coût estimé : ${euro.format(Number(patch.montantEstime))}`
        : '',
      (patch && patch.fraisPort !== undefined && patch.fraisPort !== null && patch.fraisPort !== '')
        ? `Frais de port : ${euro.format(Number(patch.fraisPort))}`
        : '',
      txt(patch && patch.fournisseur) ? `Fournisseur : ${txt(patch.fournisseur)}` : '',
      txt(patch && patch.ligneBudgetaire) ? `Ligne budgétaire suggérée : ${txt(patch.ligneBudgetaire)}` : '',
      txt(patch && patch.codeProduit) ? `Code produit : ${txt(patch.codeProduit)}` : '',
      `Décision prise par : ${(currentUser && currentUser.name) || 'superutilisateur'}`,
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

  /* Changement rapide de décision (colonne 1) — réservé au superutilisateur. */
  const quickDecide = (r, rawValue) => {
    const value = desiderataDecisionOf(rawValue);
    if (!value) return;
    const previous = desiderataDecisionOf(r && r.statut);
    if (value === previous) return;
    upsert('desiderate', {
      statut: value,
      statutChangedBy: (currentUser && currentUser.name) || '',
      statutChangedAt: Date.now(),
    }, r.id);
    /* Passage à « Approuvé » → notification au(x) gestionnaire(s). */
    if (isDesiderataApproved(value) && !isDesiderataApproved(previous)) {
      notifyApproved({ ...r, statut: value }, r.id);
    }
  };

  /* ── Transfert d’un achat « Approuvé » vers la page Dépenses › Achats ──
     Le transfert crée une ligne DANS la collection depenses : elle devient un
     enregistrement indépendant (édition, cycle devis → BC → facture,
     déplacement entre Achats / PI / OM). La collection desiderate — les
     souhaits « prévus / souhaités » — n’est pas touchée. */
  const isSuper = !!access.isSuperuser;
  const linkedDepenseOf = (rec) =>
    (Array.isArray(depenses) ? depenses : []).find((d) => d && d.desiderataId && d.desiderataId === rec.id) || null;

  const transferWishToDepenses = (rec) => {
    if (!rec || !rec.id) return;
    if (linkedDepenseOf(rec)) {
      setNotice({ tone: 'info', text: `L’achat prévu / souhaité « ${txt(rec.description) || rec.id} » est déjà transféré dans Dépenses › Achats.` });
      return;
    }
    if (!isSuper) return;
    const label = txt(rec.description) || rec.id;
    let recetteObj = recetteOf(rec);
    let recetteId = recetteObj ? recetteObj.id : '';
    /* Catégorie (Fonct. / Invest.) de la nouvelle dépense : celle du souhait,
       ou — si absente — le type de la ligne imputée. Si l’un des deux ne
       correspond pas à la fiche visée mais qu’une fiche homonyme du bon type
       existe, la nouvelle dépense y est réimputée (cohérence Recettes). */
    let categorie = txt(rec.categorie);
    if (!categorie && recetteObj) categorie = txt(recetteObj.type);
    if (recetteObj && categorie && !sameCatType(categorie, recetteObj.type)) {
      const twin = findRecetteTwin(recettes, recetteObj, categorie);
      if (twin) {
        recetteObj = twin;
        recetteId = twin.id;
      }
    }
    const patch = {
      desiderataId: rec.id,
      description: label,
      demandeur: txt(demandeurOf(rec)),
      categorie: categorie || 'Fonctionnement',
      classification: '',
      ligneBudgetaire: recetteObj
        ? txt(recetteObj.ligne)
        : txt(rec && rec.ligneBudgetaire),
      recetteId,
      montant: parseNum(rec.montantEstime),
      fraisPort: parseNum(rec.fraisPort),
      dateDemande: isoOf(rec.dateDemande),
      fournisseur: txt(pick(rec, ['fournisseur', 'nomFournisseur'])),
      contact: txt(rec.contact),
      numDevis: txt(pick(rec, ['numDevis', 'devisNo'])),
      numDevisUrl: devisUrlOf(rec),
      numSIFAC: '', dateBC: '', numBC: '', numBCUrl: '',
      dateSignature: '', dateSignatureDevis: '', dateApprobFournisseur: '',
      numFacture: '', numFactureUrl: '',
      suivi: '', statut: '',
      nonComptabiliseEnt: false,
      ent: '',
      livraisonComplete: '',
      livraisons: [],
      commentaires: txt(pick(rec, ['commentaires', 'notes'])),
    };
    const created = upsert('depenses', patch, null);
    upsert('desiderate', { depenseId: created && created.id }, rec.id);
    setNotice({
      tone: 'ok',
      text: `Achat prévu / souhaité « ${label} » transféré dans Dépenses › Achats (ligne indépendante). Vous pouvez la déplacer vers PI / OM si besoin.`,
    });
    if (created && created.id && typeof navigate === 'function') {
      navigate('depenses', { kind: 'depense', recordId: created.id });
    }
  };

  const DECISION_SELECT_TONE = (value) => {
    if (value === 'Approuvé') return 'bg-emerald-50 border-emerald-200 text-emerald-700';
    if (value === 'Pas maintenant') return 'bg-red-50 border-red-200 text-red-600';
    return 'bg-amber-50 border-amber-200 text-amber-700';
  };

  /* ── Colonnes (la DÉCISION du superutilisateur est la première) ───────── */
  const columns = [
    {
      key: 'statut', label: 'Décision', filter: 'facet',
      value: (r) => desiderataDecisionOf(r && r.statut) || 'En attente',
      display: (r) => {
        const value = desiderataDecisionOf(r && r.statut) || 'En attente';
        if (!canDecide) {
          return (
            <span title="Décision réservée au superutilisateur">
              <DecisionBadge raw={r.statut} />
            </span>
          );
        }
        return (
          <select
            value={value}
            onChange={(e) => quickDecide(r, e.target.value)}
            title="Décision du superutilisateur (Approuvé / En attente / Pas maintenant)"
            className={`inline-block max-w-[170px] text-[10px] font-black uppercase rounded-full border pl-2 pr-1 py-0.5 outline-none cursor-pointer ${DECISION_SELECT_TONE(value)}`}
          >
            {decisionOptions.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        );
      },
    },
    {
      key: 'description', label: 'Souhait d’achat', filter: 'text',
      value: (r) => [r.description, r.codeProduit, r.numDevis].filter(Boolean).join(' '),
      display: (r) => (
        <div className="min-w-[220px] max-w-[300px]">
          <div className="font-bold text-slate-800 leading-snug line-clamp-2" title={txt(r.description)}>
            {r.description || r.ligneBudgetaire || r.id}
          </div>
          {r.codeProduit && <div className="text-[10px] font-mono text-slate-400 mt-0.5">Réf. {r.codeProduit}</div>}
        </div>
      ),
    },
    {
      key: 'urgence', label: 'Urgence',
      value: (r) => pick(r, ['priorite', 'urgence']),
      display: (r) => {
        const v = pick(r, ['priorite', 'urgence']);
        return v ? <Badge tone={v.toLowerCase() === 'urgent' ? 'red' : 'amber'}>{v}</Badge> : <span className="text-slate-300">—</span>;
      },
    },
    {
      key: 'demandeur', label: 'Demandeur', filter: 'facet',
      value: (r) => demandeurOf(r),
      display: (r) => {
        const name = demandeurOf(r);
        if (!name) return <span className="text-slate-300">—</span>;
        const person = personEntryOf(r);
        if (person && canViewPersonnel) {
          return (
            <button
              type="button"
              onClick={() => goToPersonnel(person.id)}
              title={`Ouvrir la fiche de ${name} dans Personnel`}
              className="whitespace-nowrap text-xs font-semibold text-slate-600 underline decoration-slate-300 underline-offset-2 hover:text-blue-700 hover:decoration-blue-300 transition-colors"
            >{name}</button>
          );
        }
        return (
          <span
            className="whitespace-nowrap text-xs font-semibold text-slate-600"
            title={person && !canViewPersonnel ? 'Page Personnel réservée au superutilisateur' : name}
          >{name}</span>
        );
      },
    },
    {
      key: 'categorie', label: 'Catégorie', filter: 'facet',
      value: (r) => txt(r.categorie),
      display: (r) => {
        const v = txt(r.categorie);
        return v ? <Badge tone={txt(v).toLowerCase() === 'investissement' ? 'indigo' : 'emerald'}>{v}</Badge> : <span className="text-slate-300">—</span>;
      },
    },

    {
      key: 'fournisseur', label: 'Fournisseur', filter: 'facet',
      value: (r) => pick(r, ['fournisseur', 'nomFournisseur']),
      display: (r) => {
        const name = pick(r, ['fournisseur', 'nomFournisseur']);
        if (!name) return <span className="text-slate-300">—</span>;
        const entry = fournisseurEntryOf(r);
        if (entry && canViewLibrerie) {
          return (
            <button
              type="button"
              onClick={() => goToLibrerie('fournisseur', entry.id)}
              title={`Ouvrir la fiche « ${name} » dans la Librairie`}
              className="whitespace-nowrap text-xs font-bold text-slate-700 underline decoration-slate-300 underline-offset-2 hover:text-blue-700 hover:decoration-blue-300 transition-colors"
            >{name}</button>
          );
        }
        return (
          <span
            className="whitespace-nowrap text-xs font-bold text-slate-700"
            title={entry ? 'Fiche dans la Librairie (page réservée à certains profils)' : `${name} — pas de fiche au catalogue de la Librairie`}
          >{name}</span>
        );
      },
    },
    {
      key: 'ligne', label: 'Ligne budgétaire suggérée', filter: 'facet',
      value: (r) => ligneLabelOf(r),
      display: (r) => {
        const v = ligneLabelOf(r);
        if (!v) return <span className="text-slate-300">—</span>;
        const rec = recetteOf(r);
        if (rec && canViewLibrerie) {
          return (
            <button
              type="button"
              onClick={() => goToLibrerie('recette', rec.id)}
              title="Ouvrir la fiche de cette ligne budgétaire dans la Librairie"
              className="text-left max-w-[240px] font-mono text-[11px] font-bold text-indigo-700 underline decoration-indigo-300 underline-offset-2 hover:text-indigo-900 break-words leading-tight transition-colors"
            >{v}</button>
          );
        }
        return (
          <div className="max-w-[240px]">
            <div
              className="font-mono text-[11px] font-bold text-indigo-700 leading-tight break-words"
              title={rec ? v : `${v} — pas de ligne correspondante au catalogue`}
            >{v}</div>
          </div>
        );
      },
    },
    {
      key: 'montantEstime', label: 'Coût estimé', dataType: 'number', align: 'right', nowrap: true,
      value: (r) => numOf(r.montantEstime),
      display: (r) => {
        const n = numOf(r.montantEstime);
        return n === null
          ? <span className="text-slate-300">non chiffré</span>
          : <span className="whitespace-nowrap text-xs font-black text-slate-700 tabular-nums">{euro.format(n)}</span>;
      },
    },
    {
      key: 'fraisPort', label: 'Frais de port', dataType: 'number', align: 'right', nowrap: true,
      value: (r) => numOf(r.fraisPort),
      display: (r) => {
        const n = numOf(r.fraisPort);
        return n === null
          ? <span className="text-slate-300">—</span>
          : <span className="whitespace-nowrap text-xs font-semibold text-slate-500 tabular-nums">{euro.format(n)}</span>;
      },
    },
    {
      key: 'devis', label: 'Devis / code produit', filter: 'text',
      value: (r) => [pick(r, ['numDevis', 'devisNo']), devisUrlOf(r), r.devis2, r.devis3, r.codeProduit].filter(Boolean).join(' '),
      display: (r) => {
        const mainCode = pick(r, ['numDevis', 'devisNo']);
        const mainUrl = devisUrlOf(r);
        const rows = [
          (mainCode || mainUrl) && { label: 'Devis', code: mainCode, url: mainUrl },
          txt(r.devis2) && { label: 'Devis 2', code: txt(r.devis2) },
          txt(r.devis3) && { label: 'Devis 3', code: txt(r.devis3) },
        ].filter(Boolean);
        return rows.length
          ? <div className="whitespace-nowrap flex flex-col gap-0.5">
              {rows.map((row) => (
                <div key={row.label} className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold uppercase text-slate-400">{row.label}</span>
                  <DevisLink code={row.code} url={row.url} />
                </div>
              ))}
            </div>
          : <span className="text-slate-300">—</span>;
      },
    },
    {
      key: 'dateDemande', label: 'Date de demande', filter: 'text',
      value: (r) => isoOf(r.dateDemande),
      display: (r) => (isoOf(r.dateDemande) ? <span className="text-xs text-slate-600 whitespace-nowrap">{isoOf(r.dateDemande)}</span> : <span className="text-slate-300">—</span>),
    },
    {
      key: 'commentaires', label: 'Commentaires', hidden: true, filter: 'text',
      value: (r) => pick(r, ['commentaires']),
    },
    {
      key: 'actions', label: '', sortable: false, filter: 'none', filterable: false,
      align: 'right', nowrap: true,
      value: () => '',
      display: (r) => {
        const approved = isDesiderataApproved(r && r.statut);
        const linked = linkedDepenseOf(r);
        return (
          <div className="flex items-center gap-1 justify-end">
            {approved ? (
              linked ? (
                <button
                  type="button"
                  title="Déjà transféré dans Dépenses › Achats — ouvrir la ligne"
                  onClick={() => {
                    if (typeof navigate === 'function') navigate('depenses', { kind: 'depense', recordId: linked.id });
                  }}
                  className="text-[11px] font-black px-2 py-1 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
                >✓ Dans Dépenses</button>
              ) : isSuper ? (
                <button
                  type="button"
                  title="Créer la dépense liée dans la page Dépenses › onglet Achats (ligne indépendante de ce tableau)"
                  onClick={() => transferWishToDepenses(r)}
                  className="text-[11px] font-black px-2 py-1 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-colors"
                >→ Dépenses</button>
              ) : null
            ) : (
              <span title="Le souhait doit être « Approuvé » avant de pouvoir être transféré en dépense" className="text-[10px] text-slate-300">↦ après approbation</span>
            )}
            <button
              type="button"
              onClick={() => setModal({ mode: 'edit', rec: r })}
              title="Modifier l’achat prévu / souhaité"
              className="text-[11px] font-black px-2 py-1 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
            >✏️ Modifier</button>
          <button
            type="button"
            onClick={() => onRemove(r)}
            title="Supprimer l’achat prévu / souhaité"
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
          {sorted.length} achat{sorted.length > 1 ? 's' : ''} prévu{sorted.length > 1 ? 's' : ''} / souhaité{sorted.length > 1 ? 's' : ''} ·
          les colonnes sont triables (en-têtes) et filtrables (bouton « Filtres »).
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            title="Importer des souhaits depuis la feuille Google Sheets (feuille « Decision / Code produit »)"
            className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-bold text-sm px-4 py-2 rounded-xl shadow-sm transition-colors flex items-center gap-1.5"
          >
            <span className="text-base leading-none">📥</span> Importer
          </button>
          <button
            type="button"
            onClick={() => setModal({ mode: 'new' })}
            title="Saisir un nouvel achat prévu / souhaité à la main (coût estimé + frais de port)"
            className="bg-teal-600 hover:bg-teal-700 text-white font-bold text-sm px-4 py-2 rounded-xl shadow-sm transition-colors flex items-center gap-1.5"
          >
            <span className="text-base leading-none">＋</span> Ajouter un achat prévu / souhaité
          </button>
        </div>
      </div>

      {notice && (
        <div className={`rounded-xl border px-4 py-2.5 text-xs font-semibold flex items-center justify-between gap-3 ${notice.tone === 'warn'
          ? 'border-amber-200 bg-amber-50 text-amber-700'
          : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}
        >
          <span className="min-w-0">{notice.text}</span>
          <span className="flex items-center gap-3 shrink-0">
            {notice.mailto && (
              <a href={notice.mailto} className="font-black text-blue-700 underline whitespace-nowrap" title="Ouvrir votre messagerie pour envoyer l’e-mail">✉ Ouvrir ma messagerie</a>
            )}
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="shrink-0 font-black opacity-60 hover:opacity-100" title="Masquer"
            >✕</button>
          </span>
        </div>
      )}

      <div className="rounded-xl border border-teal-100 bg-teal-50/60 px-4 py-2.5 text-[11px] text-slate-600 leading-relaxed">
        <b>Achats prévus / souhaités :</b> chaque membre déclare les achats souhaités de l’équipe (description, coût estimé et frais de port,
        fournisseur, ligne budgétaire suggérée…). La <b>première colonne « Décision »</b> affiche la décision du
        superutilisateur : <b>Approuvé / En attente / Pas maintenant</b> (personnalisable dans Setup › Options des listes
        déroulantes). Une fois un souhait <b>Approuvé</b>, son bouton <b>« → Dépenses »</b> crée la ligne réelle dans la
        page Dépenses › onglet Achats (ligne indépendante de ce tableau, déplaçable vers PI / OM). Le
        <b>fournisseur</b>, la <b>ligne budgétaire</b> et le <b>demandeur</b> sont des liens vers la
        Librerie et les fiches Personnel lorsque le profil y a accès.
      </div>

      {sorted.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-10 text-center">
          <div className="text-4xl mb-2">🛒</div>
          <p className="font-black text-slate-700">Aucun achat prévu / souhaité pour le moment</p>
          <p className="text-sm text-slate-400 mt-1 mb-4">
            Utilisez « ＋ Ajouter un achat prévu / souhaité » pour déclarer un article (coût et frais de port), ou « 📥 Importer »
            pour rejouer l’onglet « Souhaités » de la feuille Google Sheets.
          </p>
          <button
            type="button"
            onClick={() => setModal({ mode: 'new' })}
            className="bg-teal-600 hover:bg-teal-700 text-white font-bold text-sm px-5 py-2.5 rounded-xl shadow-sm transition-colors"
          >
            <span className="text-base leading-none">＋</span> Ajouter un achat prévu / souhaité
          </button>
        </div>
      ) : (
        <SmartTable
          columns={columns}
          rows={sorted}
          focusRowKey={focusRow}
          onFocusDone={() => setFocusRow(null)}
          minWidth="1680px"
          searchPlaceholder="Rechercher article, demandeur, fournisseur, ligne, code produit…"
          emptyLabel="Aucun achat prévu / souhaité pour le moment"
          noMatchLabel="Aucun achat prévu / souhaité ne correspond aux filtres."
        />
      )}

      {importOpen && <AdminImportModal kind="desiderate" onClose={() => setImportOpen(false)} />}

      {modal && (
        <DesiderataModal
          rec={modal.mode === 'edit' ? modal.rec : null}
          recettes={recettes}
          demandeurNames={demandeurNames}
          fournisseurNames={fournisseurNames}
          types={types}
          urgenceOptions={urgencyOptions}
          decisionOptions={decisionOptions}
          canDecide={canDecide}
          currentUser={currentUser}
          onApproved={notifyApproved}
          onCancel={() => setModal(null)}
          onSave={onSave}
        />
      )}
    </div>
  );
};
