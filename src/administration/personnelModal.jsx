/* =========================================================================
   src/administration/personnelModal.jsx
   Fenêtre d’ajout / édition d’une personne. Corps → Grade est hiérarchique :
   les grades proposés dépendent du corps (GRADES_BY_CORPS) ; le corps
   « Stagiaire » active le bloc stage lié à une Recette.

   Depuis la demande « tables supplémentaires dans la bibliothèque » :
     • Promotions = historique de lignes « Position atteinte | YYYY-MM » ; la
       position se choisit dans Paramètres › Positions (table de référence),
       la ligne la plus récente fait foi comme « dernière promotion ».
     • Formations = lignes « Intitulé | YYYY-MM », l’intitulé se choisit dans
       Paramètres › Formations.
     • Encadrants = menu déroulant à choix multiple alimenté par les membres
       permanents / techniques de l’annuaire Personnel.
     • Pièces jointes : documents & images (lien collé ou fichier téléversé)
       rangés sur Google Drive dans le dossier du dataset › personnel/<nom>/ ;
       pour le personnel de type « Technique », un « Entretien professionnel »
       et un « Entretien de formation » dans personnel/<nom>/entretiens/.
   Les valeurs déjà saisies dans les fiches restent proposées même si elles
   ne figurent plus dans les listes de référence (aucune donnée perdue).
   ========================================================================= */
import React, { useRef, useState } from 'react';
import {
  cloudBackendAvailable, uploadLocalFile, readFileAsDataURL, withExtension,
} from '../utils/driveUpload';
import { sanitizeSlug, suggestDriveFileName } from '../utils/driveNaming';

/* ── Pièces jointes d’une fiche Personnel ────────────────────────────────────
   Documents / images et entretiens sont téléversés vers Google Drive dans le
   dossier du dataset : personnel/<nom>/… pour les pièces générales et, pour
   les membres de type « Technique », personnel/<nom>/entretiens/. La fiche ne
   stocke que des LIENS (ou une copie locale temporaire si Drive est coupé). */

/** Chemin Drive (sous le dossier du dataset) des pièces générales d’une fiche. */
export const personnelDriveFolder = (nom) => ['personnel', sanitizeSlug(nom) || 'personne'];

/** Chemin Drive (sous le dossier du dataset) des entretiens d’un membre Technique. */
export const personnelEntretiensFolder = (nom) => [...personnelDriveFolder(nom), 'entretiens'];

const isDataUrl = (s) => /^data:/i.test(String(s || ''));
const isDriveUrl = (s) => /drive\.google\.com\/|drive\.usercontent\.google\.com|lh3\.googleusercontent\.com/.test(String(s || ''));
const isImageMime = (m) => /^image\//i.test(String(m || ''));
const attachDisplay = (x) => String((x && (x.name || x.label)) || '').trim();
const cleanHttpUrl = (s) => {
  const t = String(s || '').trim();
  if (!t) return '';
  if (/^https?:\/\//i.test(t)) return t;
  if (/^data:/i.test(t)) return t;
  return `https://${t.replace(/^\/\//, '')}`;
};
const hostOf = (u) => {
  try { return new URL(u).hostname.replace(/^www\./, '') || 'Lien'; } catch { return 'Lien'; }
};

/** Valeur d’entretien (EP / EF) stockée : { name, url, mime, at } ou null. */
const normalizeEntretien = (x) => {
  if (!x) return null;
  const url = String(x.url || x.dataUrl || '').trim();
  if (!url) return null;
  return {
    name: attachDisplay(x),
    url,
    mime: String(x.mime || '').trim(),
    at: Number(x.at) || Date.now(),
    cloud: Boolean(x.cloud) || !isDataUrl(url),
  };
};

/* ── Petits composants stables (au niveau module : pas de remontage à chaque
   frappe dans le formulaire, contrairement à une fonction définie dans le
   rendu). ──────────────────────────────────────────────────────────────── */
const attachmentIcon = (row) => {
  const url = String((row && row.url) || '').trim();
  const mime = String((row && row.mime) || '').trim();
  if (!url) return '🗎';
  if (isDataUrl(url) || isImageMime(mime) || /\.(png|jpe?g|gif|webp|svg|heic|bmp)$/i.test(url)) return '🖼';
  if (isDriveUrl(url)) return '📄';
  return '🔗';
};

/** Petite puce « pièce » : libellé cliquable (ouvre le document) + retrait. */
const AttachmentChip = ({ label, url, mime, onRemove, removeTitle, tone }) => (
  <span
    className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border ${tone || 'bg-sky-50 border-sky-200 text-sky-800'}`}
  >
    {attachmentIcon({ url, mime })}
    <a href={url} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted underline-offset-2 hover:text-blue-700 max-w-[220px] truncate">
      {label || 'Pièce jointe'}
    </a>
    {onRemove && (
      <button type="button" onClick={onRemove} title={removeTitle || 'Retirer'} className="leading-none opacity-60 hover:opacity-100">✕</button>
    )}
  </span>
);

/** Bloc « entretien » (EP / EF) du personnel technique : fichier ou lien. */
const EntretienSlot = ({
  label, hint, value, cls = {}, busy = false,
  linkDraft, onLinkDraft, onCommitLink, onPickFile, onRemove,
}) => {
  const inputRef = useRef(null);
  const { labelCls = '', inputCls = '' } = cls;
  const dispLabel = (value && (value.name || (isDriveUrl(value.url) ? 'Fichier Drive' : hostOf(value.url)))) || 'Document';
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-2.5 py-2 flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <label className={`${labelCls} mb-0`}>{label}</label>
        {value ? (
          <AttachmentChip
            label={dispLabel}
            url={value.url}
            mime={value.mime}
            tone="bg-emerald-50 border-emerald-200 text-emerald-800"
            onRemove={onRemove}
            removeTitle="Retirer ce document"
          />
        ) : (
          <span className="text-[10px] text-slate-300 font-bold">aucun</span>
        )}
      </div>
      <p className="text-[10px] text-slate-400 -mt-0.5">{hint}</p>
      <div className="flex items-center gap-1.5 flex-wrap">
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept=".pdf,.doc,.docx,.odt,.jpg,.jpeg,.png,.txt"
          onChange={(e) => {
            const f = e.target.files && e.target.files[0];
            if (e.target) e.target.value = '';
            if (f) onPickFile(f);
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => { if (inputRef.current) inputRef.current.click(); }}
          className="text-[10px] font-black px-2 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 disabled:opacity-50"
        >
          {busy ? '⏳ Téléversement…' : '⬆ Déposer le fichier'}
        </button>
        <input
          className={`${inputCls} flex-1 min-w-[150px]`}
          placeholder="… ou coller un lien (Drive, intranet…)"
          value={linkDraft || ''}
          onChange={(e) => onLinkDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onCommitLink(); }}
        />
        {String(linkDraft || '').trim() && (
          <button
            type="button"
            onClick={onCommitLink}
            className="text-[11px] font-black px-2 py-1 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
          >
            + Lien
          </button>
        )}
      </div>
    </div>
  );
};

/* Identifiants stables des lignes d’édition (promotions / formations). */
let rowSeq = 0;
const newRowId = () => `pr-${++rowSeq}-${Math.random().toString(36).slice(2, 7)}`;

/* « PR2 | 2024-09 » → { label: 'PR2', date: '2024-09' } (dernier « | »).
   Une valeur sans « | » qui ressemble à une date (2024 ou 2024-09, cas des
   anciennes fiches « Dernière promotion ») est traitée comme une date. */
const splitEntry = (s) => {
  const t = String(s || '').trim();
  const i = t.lastIndexOf('|');
  if (i >= 0) return { label: t.slice(0, i).trim(), date: t.slice(i + 1).trim() };
  if (/^\d{4}(-\d{1,2})?$/.test(t)) return { label: '', date: t };
  return { label: t, date: '' };
};

/* Valeurs stockées (tableau, ou simple chaîne) → lignes d’édition. */
const entriesToRows = (entries) => {
  const arr = Array.isArray(entries) ? entries.filter(Boolean) : (entries ? [entries] : []);
  return arr.map((e) => {
    const { label, date } = splitEntry(e);
    return { _k: newRowId(), label, date };
  });
};

const D0 = () => ({
  nom: '', type: '', corps: '', grade: '', bap: '',
  email: '',
  fonction: '',
  hdr: '', categorie: '', echelon: '', chevron: '',
  dateEmbauche: '', dateFinContrat: '', dernierRIPEC: '',
  dutiesText: '', recetteId: '',
  promoRows: [], formationRows: [], encadrants: [],
  dateDebutStage: '', dateFinStage: '', dureeMois: '',
  docRows: [], entretienPro: null, entretienFormation: null,
  commentaires: '',
});

export const PersonnelModal = ({
  modal, corpsOptions, gradesMap, types, baps, recettes,
  positions, formationOptions, permanents,
  onCancel, onSave,
}) => {
  const editing = modal.mode === 'edit';
  const [draft, setDraft] = useState(() => {
    const r = editing && modal.rec ? modal.rec : null;
    if (!r) return D0();
    // Anciennes fiches : dernierePromotion ne portait que la date → on l’affiche
    // en ligne « position à préciser » pour ne rien perdre.
    const legacyPromo = String(r.dernierePromotion || '').trim();
    const promos = (Array.isArray(r.promotions) && r.promotions.length)
      ? r.promotions
      : (legacyPromo ? [legacyPromo] : []);
    const legacyEnc = Array.isArray(r.encadrants)
      ? r.encadrants
      : (typeof r.encadrants === 'string' && r.encadrants)
        ? String(r.encadrants).split(/[\n,;]+/)
        : (typeof r.encadrantsText === 'string' && r.encadrantsText)
          ? String(r.encadrantsText).split(/[\n,;]+/)
          : [];
    return {
      nom: r.nom || '', type: r.type || types[0], corps: r.corps || '', grade: r.grade || '', bap: r.bap || '',
      email: r.email || '',
      fonction: r.fonction || '',
      hdr: r.hdr || '', categorie: r.categorie || '', echelon: r.echelon || '', chevron: r.chevron || '',
      dateEmbauche: r.dateEmbauche || '', dateFinContrat: r.dateFinContrat || '',
      dernierRIPEC: r.dernierRIPEC || '',
      dutiesText: Array.isArray(r.duties) ? r.duties.join(', ') : (r.duties || ''),
      promoRows: entriesToRows(promos),
      formationRows: entriesToRows(r.formations),
      encadrants: legacyEnc.map((n) => String(n || '').trim()).filter(Boolean),
      recetteId: r.recetteId || '', dateDebutStage: r.dateDebutStage || '',
      dateFinStage: r.dateFinStage || '',
      dureeMois: r.dureeMois === null || r.dureeMois === undefined ? '' : String(r.dureeMois),
      docRows: (Array.isArray(r.documents) ? r.documents : []).map((d) => ({
        _k: newRowId(),
        name: attachDisplay(d),
        url: String((d && (d.url || d.dataUrl)) || '').trim(),
        mime: String((d && d.mime) || '').trim(),
        at: Number((d && d.at)) || Date.now(),
        cloud: Boolean((d && (d.cloud || !isDataUrl(d.url || d.dataUrl)))),
      })),
      entretienPro: normalizeEntretien(r.entretienPro),
      entretienFormation: normalizeEntretien(r.entretienFormation),
      commentaires: r.commentaires || '',
    };
  });

  const set = (k) => (ev) => setDraft((d) => ({ ...d, [k]: ev.target.value }));
  const grades = (gradesMap[draft.corps] || []);
  const showStage = draft.corps === 'Stagiaire' || (draft.type === 'Temporaire' && !draft.corps);
  const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500';
  const rowInputCls = 'w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-500 bg-white';
  const labelCls = 'block text-[10px] font-black uppercase text-slate-400 tracking-wide mb-1';

  /* Éditeurs de lignes « valeur | date » (promotions / formations). */
  const patchRow = (key, rowId, patch) =>
    setDraft((d) => ({ ...d, [key]: (d[key] || []).map((row) => (row._k === rowId ? { ...row, ...patch } : row)) }));
  const addRow = (key) => setDraft((d) => ({ ...d, [key]: [...(d[key] || []), { _k: newRowId(), label: '', date: '' }] }));
  const removeRow = (key, rowId) =>
    setDraft((d) => ({ ...d, [key]: (d[key] || []).filter((row) => row._k !== rowId) }));

  /* Liste de référence + valeurs déjà présentes dans la fiche (jamais perdues). */
  const withStoredExtras = (libraryList, rows) => {
    const uniq = new Set((libraryList || []).map((o) => String(o).trim()).filter(Boolean));
    (rows || []).forEach((row) => {
      const v = String((row && row.label) || '').trim();
      if (v && !uniq.has(v)) uniq.add(v);
    });
    return Array.from(uniq);
  };
  const positionOptions = withStoredExtras(positions, draft.promoRows);
  const formationOptionsAll = withStoredExtras(formationOptions, draft.formationRows);

  /* Encadrants : menu déroulant multi-choix (membres permanents / techniques). */
  const [encOpen, setEncOpen] = useState(false);
  const toggleEncadrant = (name) =>
    setDraft((d) => {
      const cur = d.encadrants || [];
      return { ...d, encadrants: cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name] };
    });
  const encOptions = withStoredExtras(permanents, (draft.encadrants || []).map((n) => ({ label: n })));
  const nEnc = (draft.encadrants || []).length;

  /* ── Documents & images, entretiens (Drive › personnel/<nom>[/entretiens]) ─ */
  const docsDrivePath = personnelDriveFolder(draft.nom);
  const entretiensDrivePath = personnelEntretiensFolder(draft.nom);
  const [busyFiles, setBusyFiles] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');
  const [docNameDraft, setDocNameDraft] = useState('');
  const [docUrlDraft, setDocUrlDraft] = useState('');
  const [epLinkDraft, setEpLinkDraft] = useState('');
  const [efLinkDraft, setEfLinkDraft] = useState('');
  const multiFileRef = useRef(null);

  const addDocRow = (entry) =>
    setDraft((d) => ({ ...d, docRows: [...(d.docRows || []), { _k: newRowId(), name: '', url: '', mime: '', at: Date.now(), cloud: true, ...entry }] }));
  const patchDocRow = (rowId, patch) =>
    setDraft((d) => ({ ...d, docRows: (d.docRows || []).map((r) => (r._k === rowId ? { ...r, ...patch } : r)) }));
  const dropDocRow = (rowId) =>
    setDraft((d) => ({ ...d, docRows: (d.docRows || []).filter((r) => r._k !== rowId) }));

  const submitDocLink = () => {
    const url = cleanHttpUrl(docUrlDraft);
    if (!url) return;
    addDocRow({ name: docNameDraft.trim() || hostOf(url), url, mime: '', at: Date.now(), cloud: true });
    setDocNameDraft('');
    setDocUrlDraft('');
  };

  const setEntretienVal = (key, val) => setDraft((d) => ({ ...d, [key]: val }));
  const commitEntretienLink = (key) => {
    const url = cleanHttpUrl(key === 'entretienPro' ? epLinkDraft : efLinkDraft);
    if (!url) return;
    setEntretienVal(key, { name: '', url, mime: '', at: Date.now(), cloud: true });
    if (key === 'entretienPro') setEpLinkDraft(''); else setEfLinkDraft('');
  };

  /* Entretien EP / EF : un seul fichier, Drive d’abord, copie locale ≤ 400 Ko
     en dernier recours (le payload d’admin ne doit jamais gonfler). */
  const [entNote, setEntNote] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const uploadEntretien = async (key, file) => {
    if (!file) return;
    setBusyFiles(true);
    setBusyKey(key);
    setEntNote('');
    try {
      const base = String(file.name || 'fichier').replace(/\.[^/.]+$/, '');
      const name = withExtension(`${sanitizeSlug(base) || 'entretien'}_${key === 'entretienPro' ? 'EP' : 'EF'}`, file.name || base);
      const mimeType = file.type || 'application/octet-stream';
      if (cloudBackendAvailable()) {
        try {
          const drive = await uploadLocalFile({ name, mimeType, file, path: entretiensDrivePath });
          if (drive && drive.driveUrl) {
            setEntretienVal(key, { name, url: drive.driveUrl, mime: mimeType, at: Date.now(), cloud: true });
            setEntNote(`✓ Déposé sur Google Drive › …/${entretiensDrivePath.join('/')}`);
            return;
          }
        } catch { /* repli local ci-dessous */ }
      }
      if (file.size <= 400 * 1024) {
        const dataUrl = await readFileAsDataURL(file);
        setEntretienVal(key, { name, url: dataUrl, mime: mimeType, at: Date.now(), cloud: false });
        setEntNote('⚠ Copie locale temporaire — connectez Google Drive pour archiver ce document sur Drive.');
      } else {
        setEntNote(`Échec : fichier de ${Math.round(file.size / 1024)} Ko sans Drive — connectez Google Drive puis réessayez.`);
      }
    } catch (err) {
      setEntNote(`Échec : ${(err && err.message) || 'inconnu'}`);
    } finally {
      setBusyFiles(false);
      setBusyKey('');
    }
  };

  /* Téléversement multi-fichiers → Drive › personnel/<nom> (ou repli local). */
  const uploadMany = async (files) => {
    const list = Array.from(files || []).filter((f) => f && f.size !== undefined);
    if (!list.length) return;
    setBusyFiles(true);
    setUploadMsg('');
    let ok = 0;
    let local = 0;
    const errs = [];
    for (const file of list) {
      try {
        const base = String(file.name || 'fichier').replace(/\.[^/.]+$/, '');
        const name = withExtension(suggestDriveFileName({ title: base }), file.name || base);
        const mimeType = file.type || 'application/octet-stream';
        if (cloudBackendAvailable()) {
          try {
            const drive = await uploadLocalFile({ name, mimeType, file, path: docsDrivePath });
            if (drive && drive.driveUrl) {
              addDocRow({ name, url: drive.driveUrl, mime: mimeType, at: Date.now(), cloud: true });
              ok++;
              continue;
            }
          } catch { /* repli local ci-dessous */ }
        }
        if (file.size > 400 * 1024) {
          errs.push(`${base} : ${Math.round(file.size / 1024)} Ko — Google Drive n’est pas disponible ; connectez-le puis réessayez (les fichiers > 400 Ko ne sont jamais stockés dans la fiche).`);
          continue;
        }
        const dataUrl = await readFileAsDataURL(file);
        addDocRow({ name, url: dataUrl, mime: mimeType, at: Date.now(), cloud: false });
        ok++;
        local++;
      } catch (err) {
        errs.push(`${file.name || 'Fichier'} : ${(err && err.message) || 'échec'}`);
      }
    }
    setBusyFiles(false);
    const note = [];
    if (ok > 0) note.push(`${ok} fichier${ok > 1 ? 's' : ''} ajouté${ok > 1 ? 's' : ''}${local > 0 ? ` (${local} copie locale temporaire)` : ''} → Drive › …/${docsDrivePath.join('/')}`);
    if (errs.length) note.push(errs.length === 1 ? `Échec : ${errs[0]}` : `${errs.length} fichier(s) en échec.`);
    setUploadMsg(note.join(' · '));
  };
  const onMultiFiles = (e) => {
    const files = e.target.files;
    if (files && files.length) uploadMany(files);
    if (e.target) e.target.value = '';
  };


  /* Petite ligne d’édition « sélecteur | mois » réutilisée par les promotions
     et les formations. */
  const EntryRow = ({ row, options, onPatch, onRemove, optionPlaceholder, removeTitle }) => (
    <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_150px_auto] gap-1.5 items-center">
      <select
        className={rowInputCls}
        value={row.label}
        onChange={(e) => onPatch({ label: e.target.value })}
        title={optionPlaceholder}
      >
        <option value="">{optionPlaceholder}</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      <input
        type="month"
        className={rowInputCls}
        value={row.date}
        onChange={(e) => onPatch({ date: e.target.value })}
        title="Date (mois) — par ex. 2024-09"
      />
      <button
        type="button"
        title={removeTitle}
        onClick={onRemove}
        className="w-6 h-6 rounded-md border border-slate-200 text-slate-400 hover:bg-red-50 hover:text-red-600 text-sm leading-none"
      >
        ✕
      </button>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(3px)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden max-h-[94vh] flex flex-col">
        <div className="px-6 py-4 bg-gradient-to-br from-blue-600 to-indigo-700 text-white">
          <h2 className="text-lg font-black">{editing ? 'Modifier la personne' : 'Ajouter une personne'}</h2>
          <p className="text-blue-100 text-xs">
            Le grade est une sous-classification du corps (ex. PR → PR2, PR1, CE2, CE1) ; les positions des promotions et les formations se choisissent dans les listes de Setup.
          </p>
        </div>
        <div className="p-6 overflow-y-auto custom-scrollbar grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className={labelCls}>Nom complet</label>
            <input className={inputCls} value={draft.nom} onChange={set('nom')} placeholder="Nom Prénom" />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>E-mail (notifications devis/BC, approbations)</label>
            <input type="email" className={inputCls} value={draft.email} onChange={set('email')} placeholder="prenom.nom@u-picardie.fr" />
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
            <label className={labelCls}>Fonction (accès admin)</label>
            <select className={inputCls} value={draft.fonction} onChange={set('fonction')}>
              <option value="">— Aucune —</option>
              <option value="AP">AP — Dépenses, Budget overview + Hygiène & Sécurité</option>
              <option value="Gestionnaire">Gestionnaire — Dépenses, Budget overview + Questions ouvertes</option>
            </select>
          </div>
          {!showStage && (
            <>
              <div>
                <label className={labelCls}>HDR</label>
                <select className={inputCls} value={draft.hdr} onChange={set('hdr')}>
                  <option value="">—</option>
                  <option value="Oui">Oui</option>
                  <option value="Non">Non</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Catégorie</label>
                <input className={inputCls} value={draft.categorie} onChange={set('categorie')} placeholder="A, B, C…" />
              </div>
              <div>
                <label className={labelCls}>Échelon</label>
                <input className={inputCls} value={draft.echelon} onChange={set('echelon')} placeholder="ex. 8" />
              </div>
              <div>
                <label className={labelCls}>Chevron</label>
                <input className={inputCls} value={draft.chevron} onChange={set('chevron')} placeholder="ex. 3" />
              </div>
            </>
          )}
          <div>
            <label className={labelCls}>Arrivée / embauche</label>
            <input className={inputCls} type="date" value={draft.dateEmbauche} onChange={set('dateEmbauche')} />
          </div>
          <div>
            <label className={labelCls}>Fin de contrat</label>
            <input className={inputCls} type="date" value={draft.dateFinContrat} onChange={set('dateFinContrat')} />
          </div>

          {/* Historique des promotions — la ligne la plus récente = dernière promotion */}
          <div className="sm:col-span-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <label className={labelCls}>Promotions (historique · la plus récente = dernière promotion)</label>
              <button
                type="button"
                onClick={() => addRow('promoRows')}
                className="text-[11px] font-black text-blue-600 hover:text-blue-700 hover:bg-blue-50 px-2 py-0.5 rounded-md transition-colors"
              >
                + Position atteinte
              </button>
            </div>
            <div className="border border-slate-200 rounded-xl px-2 py-1.5 bg-slate-50/60 flex flex-col gap-1.5">
              {(draft.promoRows || []).length === 0 ? (
                <p className="text-[11px] text-slate-400 px-1 py-1.5">
                  Aucune promotion pour l’instant — ajoutez la position atteinte (choisie dans Setup › Positions) et sa date.
                </p>
              ) : (
                (draft.promoRows || []).map((row) => (
                  <EntryRow
                    key={row._k}
                    row={row}
                    options={positionOptions}
                    optionPlaceholder="— Choisir la position atteinte —"
                    removeTitle="Retirer cette promotion"
                    onPatch={(patch) => patchRow('promoRows', row._k, patch)}
                    onRemove={() => removeRow('promoRows', row._k)}
                  />
                ))
              )}
            </div>
            <p className="text-[10px] text-slate-400 mt-1">
              La ligne la plus récente s’affiche comme « Dernière promotion » dans l’annuaire ; la position précédente se lit dans les lignes au-dessus.
            </p>
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>Missions (SST, radioprotection…)</label>
            <input className={inputCls} value={draft.dutiesText} onChange={set('dutiesText')} placeholder="SST, ASV, Radioprotection" />
          </div>

          {/* Formations — intitulé choisi dans la liste Paramètres › Formations */}
          <div className="sm:col-span-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <label className={labelCls}>Formations (une par ligne : intitulé | date)</label>
              <button
                type="button"
                onClick={() => addRow('formationRows')}
                className="text-[11px] font-black text-blue-600 hover:text-blue-700 hover:bg-blue-50 px-2 py-0.5 rounded-md transition-colors"
              >
                + Formation
              </button>
            </div>
            <div className="border border-slate-200 rounded-xl px-2 py-1.5 bg-slate-50/60 flex flex-col gap-1.5">
              {(draft.formationRows || []).length === 0 ? (
                <p className="text-[11px] text-slate-400 px-1 py-1.5">
                  Aucune formation pour l’instant — ajoutez un intitulé choisi dans Setup › Formations et sa date.
                </p>
              ) : (
                (draft.formationRows || []).map((row) => (
                  <EntryRow
                    key={row._k}
                    row={row}
                    options={formationOptionsAll}
                    optionPlaceholder="— Choisir une formation —"
                    removeTitle="Retirer cette formation"
                    onPatch={(patch) => patchRow('formationRows', row._k, patch)}
                    onRemove={() => removeRow('formationRows', row._k)}
                  />
                ))
              )}
            </div>
            <p className="text-[10px] text-slate-400 mt-1">
              Une formation déjà inscrite hors liste reste proposée et conservée.
            </p>
          </div>

          {/* Entretiens annuels — uniquement pour le personnel de type Technique */}
          {draft.type === 'Technique' && (
            <div className="sm:col-span-2">
              <label className={labelCls}>Entretiens annuels (personnel technique)</label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <EntretienSlot
                  label="Entretien professionnel"
                  hint="Déposez le fichier signé (PDF) — stocké sur Drive › …/entretiens/"
                  value={draft.entretienPro}
                  cls={{ labelCls, inputCls: rowInputCls }}
                  busy={busyFiles && busyKey === 'entretienPro'}
                  linkDraft={epLinkDraft}
                  onLinkDraft={setEpLinkDraft}
                  onCommitLink={() => commitEntretienLink('entretienPro')}
                  onPickFile={(file) => uploadEntretien('entretienPro', file)}
                  onRemove={() => setEntretienVal('entretienPro', null)}
                />
                <EntretienSlot
                  label="Entretien de formation"
                  hint="Déposez le fichier signé (PDF) — stocké sur Drive › …/entretiens/"
                  value={draft.entretienFormation}
                  cls={{ labelCls, inputCls: rowInputCls }}
                  busy={busyFiles && busyKey === 'entretienFormation'}
                  linkDraft={efLinkDraft}
                  onLinkDraft={setEfLinkDraft}
                  onCommitLink={() => commitEntretienLink('entretienFormation')}
                  onPickFile={(file) => uploadEntretien('entretienFormation', file)}
                  onRemove={() => setEntretienVal('entretienFormation', null)}
                />
              </div>
              {entNote && (
                <p className={`text-[10px] mt-1 ${entNote.includes('Échec') ? 'text-red-600' : 'text-emerald-700'}`}>{entNote}</p>
              )}
              <p className="text-[10px] text-slate-400 mt-1">
                Ces documents sont rangés dans le dossier Google Drive « Lab_administration » › personnel/&lt;nom de la personne&gt;/entretiens/.
              </p>
            </div>
          )}
          {showStage && (
            <>
              {/* Encadrants : menu déroulant multi-choix alimenté par les permanents */}
              <div className="sm:col-span-2">
                <label className={labelCls}>Encadrants (choix multiple — membres permanents)</label>
                <button
                  type="button"
                  onClick={() => setEncOpen((o) => !o)}
                  className={`${inputCls} text-left flex items-center justify-between gap-2`}
                >
                  <span className={nEnc ? 'text-slate-700' : 'text-slate-400'}>
                    {nEnc
                      ? `${nEnc} encadrant${nEnc > 1 ? 's' : ''} sélectionné${nEnc > 1 ? 's' : ''}`
                      : '— Choisir un ou plusieurs permanents —'}
                  </span>
                  <span className="text-slate-400 text-[10px] shrink-0">{encOpen ? '▲' : '▼'}</span>
                </button>
                {encOpen && (
                  <div className="mt-1.5 border border-slate-200 rounded-xl bg-white shadow-lg max-h-44 overflow-y-auto custom-scrollbar p-1">
                    {encOptions.length === 0 ? (
                      <p className="text-xs text-slate-400 px-2 py-2">
                        Aucun membre permanent / technique dans l’annuaire — ajoutez-les d’abord (Type Permanent ou Technique).
                      </p>
                    ) : (
                      encOptions.map((name) => (
                        <label
                          key={name}
                          className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-100 cursor-pointer text-sm"
                        >
                          <input
                            type="checkbox"
                            className="accent-blue-600"
                            checked={(draft.encadrants || []).includes(name)}
                            onChange={() => toggleEncadrant(name)}
                          />
                          <span className="truncate">{name}</span>
                        </label>
                      ))
                    )}
                  </div>
                )}
                {nEnc > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {(draft.encadrants || []).map((name) => (
                      <span
                        key={name}
                        className="inline-flex items-center gap-1 text-[11px] font-bold text-sky-800 bg-sky-100 border border-sky-200 px-2 py-0.5 rounded-full"
                      >
                        {name}
                        <button
                          type="button"
                          title={`Retirer ${name}`}
                          onClick={() => toggleEncadrant(name)}
                          className="text-sky-400 hover:text-sky-700 leading-none"
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                )}
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

          {/* Documents & images — Drive › personnel/<nom>/ */}
          <div className="sm:col-span-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <label className={labelCls}>
                Documents & images
                {String(draft.nom || '').trim()
                  ? <span className="normal-case font-semibold">(Drive › …/{docsDrivePath.join('/')})</span>
                  : null}
              </label>
              <button
                type="button"
                disabled={busyFiles || !String(draft.nom || '').trim()}
                onClick={() => { if (multiFileRef.current) multiFileRef.current.click(); }}
                className="text-[11px] font-black px-2.5 py-1 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                title={String(draft.nom || '').trim()
                  ? 'Téléverser un ou plusieurs fichiers / images vers Google Drive (dossier personnel/<nom>)'
                  : 'Saisissez d’abord le « Nom complet » pour créer le dossier Drive de la personne'}
              >
                {busyFiles ? '⏳ Téléversement…' : '⬆ Ajouter fichier(s) / image(s)'}
              </button>
              <input
                ref={multiFileRef}
                type="file"
                multiple
                className="hidden"
                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.txt,.csv,.zip,.rtf"
                onChange={onMultiFiles}
              />
            </div>
            <div className="border border-slate-200 rounded-xl px-2 py-2 bg-slate-50/60 flex flex-col gap-1.5">
              {(draft.docRows || []).length === 0 ? (
                <p className="text-[11px] text-slate-400 px-1 py-1">
                  Aucune pièce pour l’instant. Collez un lien (contrat, CV, rapport, arrêté…)
                  ou téléversez un ou plusieurs documents / images — stockés sur Google Drive
                  sous …/{docsDrivePath.join('/')}.
                </p>
              ) : (
                (draft.docRows || []).map((row) => (
                  <div key={row._k} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2 border border-slate-200 rounded-lg bg-white px-2 py-1.5">
                    <span
                      className="text-sm shrink-0"
                      title={!row.url ? 'Nouvelle pièce' : (isImageMime(row.mime) || isDataUrl(row.url) ? 'Image' : (isDriveUrl(row.url) ? 'Document sur Drive' : 'Lien'))}
                    >
                      {attachmentIcon(row)}
                    </span>
                    <input
                      className={`${rowInputCls} sm:w-44`}
                      value={row.name}
                      placeholder="Nom / titre"
                      onChange={(e) => patchDocRow(row._k, { name: e.target.value })}
                    />
                    <input
                      className={`${rowInputCls} flex-1 min-w-0`}
                      value={row.url}
                      placeholder="https://… (lien) — un fichier téléversé remplit ce champ automatiquement"
                      onChange={(e) => patchDocRow(row._k, { url: e.target.value, cloud: !isDataUrl(e.target.value) })}
                    />
                    {row.url ? (
                      <span className="flex items-center gap-1 shrink-0">
                        <a href={row.url} target="_blank" rel="noopener noreferrer" title="Ouvrir dans un nouvel onglet" className="text-[10px] font-black text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded-md hover:bg-blue-100">Ouvrir ↗</a>
                        {isDataUrl(row.url) && !row.cloud && <span title="Stocké localement (temporaire) — connectez Google Drive pour le sauvegarder sur Drive">⚠️</span>}
                        <button type="button" title="Retirer cette pièce" onClick={() => dropDocRow(row._k)} className="w-6 h-6 rounded-md border border-slate-200 text-slate-400 hover:bg-red-50 hover:text-red-600 text-sm leading-none">✕</button>
                      </span>
                    ) : (
                      <button type="button" title="Retirer" onClick={() => dropDocRow(row._k)} className="w-6 h-6 shrink-0 rounded-md border border-slate-200 text-slate-400 hover:bg-red-50 hover:text-red-600 text-sm leading-none">✕</button>
                    )}
                  </div>
                ))
              )}
              <div className="flex flex-col gap-1.5 border-t border-slate-200/70 pt-1.5 sm:flex-row sm:items-center sm:gap-2">
                <input
                  className={`${rowInputCls} sm:w-48`}
                  placeholder="Nom du lien (facultatif)"
                  value={docNameDraft}
                  onChange={(e) => setDocNameDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') submitDocLink(); }}
                />
                <input
                  className={`${rowInputCls} flex-1 min-w-0`}
                  placeholder="URL du document à lier — ex. https://drive.google.com/…"
                  value={docUrlDraft}
                  onChange={(e) => setDocUrlDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') submitDocLink(); }}
                />
                <button
                  type="button"
                  onClick={submitDocLink}
                  disabled={!String(docUrlDraft || '').trim()}
                  className="text-[11px] font-black px-2.5 py-1.5 rounded-lg bg-slate-700 text-white hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  + Ajouter le lien
                </button>
              </div>
            </div>
            {uploadMsg && (
              <p className={`text-[10px] mt-1 ${uploadMsg.includes('Échec') ? 'text-red-600' : 'text-emerald-700'}`}>{uploadMsg}</p>
            )}
            <p className="text-[10px] text-slate-400 mt-1">
              Dossier Google Drive : « Lab_administration » › personnel/&lt;nom de la personne&gt;. Le dossier suit
              le champ « Nom complet » saisi au moment du téléversement.
            </p>
          </div>

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
