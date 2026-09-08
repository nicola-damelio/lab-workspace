/* =========================================================================
   src/administration/settingsPage.jsx
   Setup d’une base d’administration : Équipe & accès (scientifiques,
   superutilisateur) + options des listes déroulantes (administration.settings).
   ========================================================================= */
import React, { useEffect, useState } from 'react';
import { useAdmin } from './AdminContext';
import { ScientistsOperatorsManager } from '../components/AppModules/definitionsManagers';
import { openDrive, datasetFolderSlug } from '../utils/driveNaming';
import {
  DEFAULT_OPTIONS, DEPENSE_FIELD_CATALOG, DEFAULT_DEPENSE_MANDATORY,
  ADMIN_PAGES, ADMIN_ACCESS_CATEGORIES, ADMIN_ACCESS_CATEGORY_META,
  adminPageIdsForProfile, fonctionsOfPerson, statutLabelOf,
} from './adminSchema';

const OPTION_KEYS = [
  { key: 'recetteTypes', label: 'Types de Recette (Fonct. / Invest.)' },
  { key: 'tranchesStatuses', label: 'Statuts de tranches budgétaires' },
  { key: 'personnelTypes', label: 'Types de personnel' },
  { key: 'corps', label: 'Corps (PR, MCF, DR, CR…) — une par ligne' },
  { key: 'gradesByCorps', label: 'Grades par corps — format Corps = gr1, gr2' },
  { key: 'bap', label: 'BAP (A, B, C…)' },
  { key: 'positions', label: 'Positions / postes (historique des promotions) — une par ligne' },
  { key: 'formations', label: 'Formations (intitulés) — une par ligne' },
  { key: 'dutySuggestions', label: 'Missions suggérées (SST…)' },
  { key: 'depenseNatures', label: 'Natures de dépenses' },
  { key: 'depenseStatuses', label: 'Statuts de dépenses / BC' },
  { key: 'urgences', label: 'Urgences / priorités (H&S : Urgent → Pas urgent)' },
  { key: 'desiderateStatuses', label: 'Décisions Achats prévus / souhaités (Approuvé / En attente / Pas maintenant)' },
  { key: 'omStatuses', label: 'Statuts des OM' },
  { key: 'omCostStatuses', label: 'Coût OM : Estimé / Exact' },
  { key: 'issueStatuses', label: 'Statuts Questions ouvertes / H&S (A faire / En cours / Fait)' },
  { key: 'congesQuotaByType', label: 'Congés : jours / an par profil (Doctorant = 47)' },
];

/* Options stockées comme objet « clé = valeur » (une entrée par ligne). */
const OBJECT_OPTION_KEYS = new Set(['gradesByCorps', 'congesQuotaByType']);

const toText = (key, settings) => {
  const val = settings && settings[key];
  if (OBJECT_OPTION_KEYS.has(key) && val && typeof val === 'object') {
    return Object.entries(val)
      .map(([k, v]) => `${k} = ${Array.isArray(v) ? v.join(', ') : String(v)}`)
      .join('\n');
  }
  return Array.isArray(val) ? val.join('\n') : '';
};

/* ═══════════════════════════════════════════════════════════════════════════
   Accès aux pages — qui voit quelle page (réservé au superutilisateur).
   Règle stockée dans administration.settings.pageAccess :
     { [pageId]: { mode:'custom', roles:[catégories…], include:[ids], exclude:[ids] } }
   Une page sans règle garde la matrice par défaut de la fiche Personnel.
   ═══════════════════════════════════════════════════════════════════════════ */
const personCategoriesOf = (person) => {
  const out = [];
  const statut = statutLabelOf(person) === 'Permanent' ? 'Permanent' : 'Non permanent';
  if (out.indexOf(statut) === -1) out.push(statut);
  fonctionsOfPerson(person).forEach((c) => { if (out.indexOf(c) === -1) out.push(c); });
  if (!fonctionsOfPerson(person).length) out.push('Aucune fonction');
  return out;
};

/** La fiche verrait-elle la page avec la matrice par défaut ? */
const personDefaultCanView = (person, pageId) =>
  adminPageIdsForProfile({
    isSuperuser: false,
    statut: statutLabelOf(person),
    fonctions: fonctionsOfPerson(person),
    person,
  }).has(pageId);

/** Catégories qui, dans la matrice par défaut, accèdent déjà à cette page. */
const defaultCategoriesForPage = (people, pageId) => {
  const set = new Set();
  people.forEach((p) => {
    if (personDefaultCanView(p, pageId)) personCategoriesOf(p).forEach((c) => set.add(c));
  });
  return [...set];
};

const cleanRoles = (roles) =>
  (Array.isArray(roles) ? roles : []).filter((c) => ADMIN_ACCESS_CATEGORIES.indexOf(c) !== -1);

/** La fiche verra-t-elle la page selon la règle en cours d’édition ? */
const personCanViewRule = (person, pageId, draft) => {
  const rule = draft && draft[pageId];
  if (!rule || String(rule.mode || '').trim() !== 'custom') return personDefaultCanView(person, pageId);
  const roles = cleanRoles(rule.roles);
  const include = Array.isArray(rule.include) ? rule.include.filter(Boolean) : [];
  const exclude = Array.isArray(rule.exclude) ? rule.exclude.filter(Boolean) : [];
  const pid = person.id;
  if (pid && exclude.indexOf(pid) !== -1) return false;
  if (pid && include.indexOf(pid) !== -1) return true;
  return personCategoriesOf(person).some((c) => roles.indexOf(c) !== -1);
};

const PersonChips = ({ ids, byId, tone = 'slate' }) => {
  const list = (ids || []).filter((pid) => byId.has(pid));
  if (!list.length) return null;
  const toneCls = tone === 'green'
    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
    : tone === 'red'
      ? 'bg-red-50 border-red-200 text-red-700'
      : 'bg-slate-50 border-slate-200 text-slate-700';
  return (
    <div className="flex flex-wrap gap-1">
      {list.map((pid) => {
        const p = byId.get(pid);
        const fs = fonctionsOfPerson(p);
        return (
          <span key={pid} className={`inline-flex items-center gap-1 text-[11px] font-bold rounded-full border px-2 py-0.5 ${toneCls}`}>
            {p.nom}
            {fs.length > 0 && <span className="text-[9px] font-black uppercase opacity-70">{fs.join(' · ')}</span>}
          </span>
        );
      })}
    </div>
  );
};

const PageAccessEditor = ({ personnel, pageAccess, onSave }) => {
  const people = (Array.isArray(personnel) ? personnel : []).filter((p) => p && p.id);
  const saved = (pageAccess && typeof pageAccess === 'object') ? pageAccess : {};
  const [draft, setDraft] = useState(() => JSON.parse(JSON.stringify(saved)));
  useEffect(() => {
    setDraft(JSON.parse(JSON.stringify((pageAccess && typeof pageAccess === 'object') ? pageAccess : {})));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageAccess]);

  const [pageId, setPageId] = useState('depenses');
  const page = ADMIN_PAGES.find((p) => p.id === pageId) || ADMIN_PAGES[0];
  const rule = draft[page.id] || null;
  const isCustom = !!rule && String(rule.mode || '').trim() === 'custom';
  const roles = isCustom ? cleanRoles(rule.roles) : [];
  const includeIds = isCustom && Array.isArray(rule.include) ? rule.include.filter(Boolean) : [];
  const excludeIds = isCustom && Array.isArray(rule.exclude) ? rule.exclude.filter(Boolean) : [];

  const setRule = (patch) => setDraft((prev) => ({
    ...prev,
    [page.id]: { mode: 'custom', roles: [], include: [], exclude: [], ...(prev[page.id] || {}), ...patch },
  }));
  const removeRule = () => setDraft((prev) => {
    const cp = { ...prev };
    delete cp[page.id];
    return cp;
  });
  const toggleRole = (cat) => setRule({ roles: roles.indexOf(cat) !== -1 ? roles.filter((c) => c !== cat) : [...roles, cat] });
  const toggleIncluded = (pid) => setRule({
    include: includeIds.indexOf(pid) !== -1 ? includeIds.filter((x) => x !== pid) : [...includeIds, pid],
    exclude: excludeIds.filter((x) => x !== pid),
  });
  const toggleExcluded = (pid) => setRule({
    include: includeIds.filter((x) => x !== pid),
    exclude: excludeIds.indexOf(pid) !== -1 ? excludeIds.filter((x) => x !== pid) : [...excludeIds, pid],
  });
  const enableCustom = () => setRule({ roles: defaultCategoriesForPage(people, page.id) });

  const byId = new Map(people.map((p) => [p.id, p]));
  const allowedPreview = people.filter((p) => personCanViewRule(p, page.id, draft));
  const labelCls = 'block text-[10px] font-black uppercase text-slate-400 tracking-wide mb-1';

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-slate-400 leading-relaxed">
        Choisissez une page puis réglez <b>qui peut la voir</b>. Par défaut, chaque page suit la matrice
        des fiches Personnel (statut + fonctions — AP, Gestionnaire, Responsable d'achats ; une personne
        peut cumuler plusieurs fonctions). En mode <b>Personnalisé</b>, la matrice est remplacée pour
        cette page : catégories autorisées, inclusions et exclusions par personne. Le superutilisateur
        garde toujours accès à toutes les pages.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {ADMIN_PAGES.map((p) => {
          const hasRule = !!draft[p.id] && String(draft[p.id].mode || '').trim() === 'custom';
          const n = people.filter((per) => personCanViewRule(per, p.id, draft)).length;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setPageId(p.id)}
              title={`${p.label} — ${n} personne(s) sur ${people.length} verront cette page`}
              className={`rounded-full px-2.5 py-1 text-[11px] font-black border transition-colors ${p.id === pageId
                ? 'bg-indigo-600 text-white border-indigo-600'
                : hasRule
                  ? 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:border-indigo-300'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}
            >
              {p.icon} {p.label}{hasRule ? ' ⚙' : ''}
            </button>
          );
        })}
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-base">{page.icon}</span>
              <h3 className="font-black text-slate-700">{page.label}</h3>
              <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${isCustom
                ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                : 'bg-white border-slate-200 text-slate-500'}`}>
                {isCustom ? '⚙ Règle personnalisée' : 'Matrice par défaut'}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">{page.blurb}</p>
          </div>
          {!isCustom ? (
            <button
              type="button"
              onClick={enableCustom}
              className="shrink-0 text-xs font-bold text-indigo-600 hover:text-indigo-800 border border-indigo-200 bg-white rounded-lg px-3 py-1.5"
            >
              ✏️ Personnaliser cette page
            </button>
          ) : (
            <button
              type="button"
              onClick={() => removeRule()}
              className="shrink-0 text-xs font-bold text-slate-500 hover:text-slate-700 border border-slate-200 bg-white rounded-lg px-3 py-1.5"
              title="Revenir à la matrice par défaut pour cette page"
            >
              ↩ Matrice par défaut
            </button>
          )}
        </div>

        {isCustom && (
          <>
            <div>
              <label className={labelCls}>Catégories autorisées (une coche = toute personne de ce profil voit la page)</label>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {ADMIN_ACCESS_CATEGORIES.map((cat) => {
                  const meta = ADMIN_ACCESS_CATEGORY_META[cat];
                  const on = roles.indexOf(cat) !== -1;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => toggleRole(cat)}
                      title={meta ? meta.hint : cat}
                      className={`rounded-full px-3 py-1.5 text-[11px] font-bold border transition-colors ${on
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'}`}
                    >
                      {meta ? `${meta.icon} ${meta.label}` : cat}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Inclure toujours ces personnes (même hors catégories)</label>
                <div className="border border-slate-200 rounded-xl bg-white p-1 max-h-44 overflow-y-auto custom-scrollbar mt-1">
                  {people.length === 0 && <p className="text-[11px] text-slate-400 px-2 py-2">Aucune fiche Personnel dans l’annuaire.</p>}
                  {people.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-emerald-50 cursor-pointer">
                      <input type="checkbox" className="accent-emerald-600" checked={includeIds.indexOf(p.id) !== -1} onChange={() => toggleIncluded(p.id)} />
                      <span className="text-xs text-slate-700 truncate">{p.nom}</span>
                    </label>
                  ))}
                </div>
                <div className="mt-1"><PersonChips ids={includeIds} byId={byId} tone="green" /></div>
              </div>
              <div>
                <label className={labelCls}>Exclure ces personnes (même si leur catégorie est autorisée)</label>
                <div className="border border-slate-200 rounded-xl bg-white p-1 max-h-44 overflow-y-auto custom-scrollbar mt-1">
                  {people.length === 0 && <p className="text-[11px] text-slate-400 px-2 py-2">Aucune fiche Personnel dans l’annuaire.</p>}
                  {people.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-red-50 cursor-pointer">
                      <input type="checkbox" className="accent-red-600" checked={excludeIds.indexOf(p.id) !== -1} onChange={() => toggleExcluded(p.id)} />
                      <span className="text-xs text-slate-700 truncate">{p.nom}</span>
                    </label>
                  ))}
                </div>
                <div className="mt-1"><PersonChips ids={excludeIds} byId={byId} tone="red" /></div>
              </div>
            </div>

            {roles.length === 0 && includeIds.length === 0 && (
              <p className="text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                ⚠️ Aucune catégorie ni personne sélectionnée : seuls les superutilisateurs verront cette page.
              </p>
            )}
          </>
        )}

        {!isCustom && (
          <p className="text-[11px] text-slate-400 bg-white border border-slate-200 rounded-lg px-3 py-2">
            Les fiches Personnel (statut + fonctions cumulées) définissent qui voit cette page.
            Cliquez sur « Personnaliser cette page » pour adapter l’accès.
          </p>
        )}

        <div className="pt-3 border-t border-slate-200 flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <span className="text-xs font-bold text-slate-600">👁 Aperçu — personnes autorisées sur « {page.label} » :</span>
            {allowedPreview.length === 0 ? (
              <p className="text-[11px] text-slate-400 italic">Aucune fiche ne verra cette page (hors superutilisateur).</p>
            ) : (
              <div className="mt-1 flex flex-wrap items-center gap-1">
                <PersonChips ids={allowedPreview.slice(0, 12).map((p) => p.id)} byId={byId} />
                {allowedPreview.length > 12 && (
                  <span className="text-[11px] font-bold text-slate-400 px-1">+{allowedPreview.length - 12} autre(s)…</span>
                )}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => onSave(draft)}
            className="shrink-0 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-4 py-2 rounded-xl shadow-sm transition-colors"
          >
            💾 Enregistrer les permissions
          </button>
        </div>
      </div>
    </div>
  );
};
/* ── Section « Données & Google Drive » (superutilisateur) ─────────────── */
const DriveDataPanel = ({ datasetTitle }) => {
  const folder = datasetFolderSlug(datasetTitle || 'Base administration');
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-slate-500 leading-relaxed">
        Les données d’administration sont enregistrées dans la base (sauvegarde automatique + sauvegarde
        hebdomadaire <b>&lt;dataset&gt;/backups/</b> sur Google Drive) et les documents déposés sont classés
        automatiquement dans le dossier Google Drive <b>« Lab Workspace › {folder} »</b> :
      </p>
      <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-[11px] font-mono text-slate-600 leading-relaxed">
        {folder}/Budget_labo/&lt;année&gt;/Devis · BC · BL · Factures · OM<br />
        {folder}/personnel/&lt;nom de la personne&gt;[/entretiens]<br />
        {folder}/backups/ (sauvegardes HTML hebdomadaires de toute la base)
      </div>
      <div className="flex items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3">
        <span className="text-xs text-slate-500">
          Ouvre le dossier Google Drive actuellement utilisé par l’application (racine « Lab Workspace »,
          dossiers des bases et sauvegardes) dans un nouvel onglet.
        </span>
        <button
          type="button"
          onClick={openDrive}
          className="shrink-0 text-xs font-bold text-blue-600 hover:text-blue-800 underline whitespace-nowrap"
        >
          Ouvrir sur Google Drive ↗
        </button>
      </div>
      <p className="text-[10px] text-slate-400">
        Raccourci équivalent à la section « Google Drive folder » des réglages des bases scientifiques.
      </p>
    </div>
  );
};
export const SettingsPage = ({ operators, setOperators, authSettings, setAuthSettings, currentUser, datasetTitle }) => {
  const { data, settings, updateSettings, access } = useAdmin();
  const personnelList = (Array.isArray(data && data.personnel) ? data.personnel : []).filter((p) => p && p.id);
  const isSuper = !!(access && access.isSuperuser);
  const [optionKey, setOptionKey] = useState('recetteTypes');
  const [text, setText] = useState(() => toText('recetteTypes', settings));

  /* Règles « Accès aux pages » : sauvegarde / rétablissement global. */
  const savePageAccess = (draft) => {
    const clean = {};
    (draft && typeof draft === 'object' ? Object.keys(draft) : []).forEach((pid) => {
      const rule = draft[pid];
      if (!rule || String(rule.mode || '').trim() !== 'custom') return;
      clean[pid] = {
        mode: 'custom',
        roles: Array.isArray(rule.roles) ? rule.roles.filter((c) => ADMIN_ACCESS_CATEGORIES.indexOf(c) !== -1) : [],
        include: Array.isArray(rule.include) ? rule.include.filter(Boolean) : [],
        exclude: Array.isArray(rule.exclude) ? rule.exclude.filter(Boolean) : [],
      };
    });
    updateSettings({ pageAccess: clean });
  };
  const resetPageAccess = () => updateSettings({ pageAccess: {} });

  const switchOption = (key) => {
    setOptionKey(key);
    setText(toText(key, settings));
  };

  const saveOption = () => {
    let value;
    if (OBJECT_OPTION_KEYS.has(optionKey)) {
      const obj = {};
      text.split('\n').map((l) => l.trim()).filter(Boolean).forEach((l) => {
        const eq = l.indexOf('=');
        const key = (eq > 0 ? l.slice(0, eq) : l).trim();
        if (!key) return;
        if (optionKey === 'gradesByCorps') {
          const grades = (eq > 0 ? l.slice(eq + 1) : '').split(',').map((g) => g.trim()).filter(Boolean);
          if (grades.length) obj[key] = grades;
        } else if (optionKey === 'congesQuotaByType') {
          const n = Number(eq > 0 ? l.slice(eq + 1) : '');
          if (eq > 0 && Number.isFinite(n) && n >= 0) obj[key] = n;
        }
      });
      value = obj;
    } else {
      value = text.split('\n').map((l) => l.trim()).filter(Boolean);
    }
    updateSettings({ [optionKey]: value });
  };

  const resetDefaults = () => {
    const def = JSON.parse(JSON.stringify(DEFAULT_OPTIONS[optionKey]));
    updateSettings({ [optionKey]: def });
    setText(toText(optionKey, { ...settings, [optionKey]: def }));
  };

  /* ── Champs obligatoires des Dépenses ────────────────────────────────────
     Même principe que les « mandatory fields » des pages de type scientifique :
     une ligne de la page Dépenses à laquelle manque un champ coché passe
     entièrement en rouge. Clé stockée : administration.settings.depenseMandatoryFields. */
  const [mandatoryKeys, setMandatoryKeys] = useState(() => {
    const stored = settings && Array.isArray(settings.depenseMandatoryFields)
      ? settings.depenseMandatoryFields
      : DEFAULT_DEPENSE_MANDATORY;
    return [...stored];
  });
  const toggleMandatory = (key) => {
    setMandatoryKeys((prev) => (prev.includes(key)
      ? prev.filter((k) => k !== key)
      : [...prev, key]));
  };
  const saveMandatory = () => updateSettings({ depenseMandatoryFields: [...mandatoryKeys] });
  const resetMandatory = () => {
    setMandatoryKeys([...DEFAULT_DEPENSE_MANDATORY]);
    updateSettings({ depenseMandatoryFields: [...DEFAULT_DEPENSE_MANDATORY] });
  };

  const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500';
  const labelCls = 'block text-[10px] font-black uppercase text-slate-400 tracking-wide mb-1';

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-4">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
          <span className="text-2xl" aria-hidden="true">👑</span>
          <div>
            <h2 className="text-lg font-black text-slate-800">Équipe &amp; accès</h2>
            <p className="text-xs text-slate-400">
              Scientifiques et superutilisateur. Sans superutilisateur défini, les rôles restent modifiables (bootstrap) :
              créez un compte superutilisateur avec mot de passe, puis connectez-vous avec le bouton Login de la barre latérale.
            </p>
            <p className="text-xs text-slate-400 mt-1">
              Accès aux pages d’administration : liez chaque compte à sa fiche Personnel (menu « Linked personnel record »).
              Le statut (Permanent / Non permanent) et la ou les fonctions (AP / Gestionnaire / Responsable d'achats — une personne
              peut en cumuler plusieurs) de la fiche déterminent les pages visibles — un compte sans fiche liée n’a qu’un accès minimal.
              En dessous, le panneau « Accès aux pages » permet au superutilisateur de personnaliser chaque page.
            </p>
          </div>
        </div>
        <ScientistsOperatorsManager
          operators={operators} setOperators={setOperators}
          authSettings={authSettings} setAuthSettings={setAuthSettings}
          currentUser={currentUser}
          personnel={data && data.personnel}
        />
      </div>

      {isSuper && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3 flex-wrap">
            <span className="text-2xl">🔐</span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-black text-slate-800">Accès aux pages — qui voit quoi</h2>
              <p className="text-xs text-slate-400">
                Définissez, page par page, les types d’utilisateurs (Permanent / Non permanent / AP / Gestionnaire /
                Responsable d'achats) et les personnes qui peuvent la voir, avec inclusions et exclusions précises.
                Les règles s’appliquent immédiatement dans toute la base.
              </p>
            </div>
            <button
              type="button"
              onClick={resetPageAccess}
              className="shrink-0 text-xs font-bold text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg px-3 py-1.5 bg-white"
              title="Rétablir la matrice par défaut pour TOUTES les pages (toutes les règles personnalisées sont supprimées)"
            >
              ↩ Matrice par défaut partout
            </button>
          </div>
          <div className="p-5">
            <PageAccessEditor personnel={personnelList} pageAccess={settings.pageAccess || {}} onSave={savePageAccess} />
          </div>
        </div>
      )}

      {isSuper && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
            <span className="text-2xl">📁</span>
            <div>
              <h2 className="text-lg font-black text-slate-800">Données & Google Drive</h2>
              <p className="text-xs text-slate-400">
                Dossier de cette base d’administration sur Google Drive — documents classés, dossier budget et sauvegardes.
              </p>
            </div>
          </div>
          <div className="p-5">
            <DriveDataPanel datasetTitle={datasetTitle} />
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
        <h2 className="text-lg font-black text-slate-800">Champs obligatoires — Dépenses</h2>
        <p className="text-xs text-slate-400 mb-4">
          Une ligne de la page <b>Dépenses</b> passe entièrement en rouge dès qu’un de ces champs manque
          (l’enregistrement est aussi bloqué tant qu’il manque) — comme les « mandatory fields » des pages de type
          scientifique. <b>Nom du fournisseur</b> est coché par défaut ; « PI » = prestation interne (facturée sans BC,
          comptée comme dépense engagée dans la page Recettes).<br />
          Exception : pour une prestation interne (fournisseur « PI »), <b>N° BC</b> et <b>N° SIFAC</b> ne sont
          <b>jamais exigés</b> — un service interne est facturé sans bon de commande.
        </p>
        <div className="flex flex-wrap gap-2">
          {DEPENSE_FIELD_CATALOG.map((f) => {
            const on = mandatoryKeys.includes(f.key);
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => toggleMandatory(f.key)}
                title={on ? `« ${f.label} » est obligatoire — cliquer pour retirer` : `Cliquer pour rendre « ${f.label} » obligatoire`}
                className={`rounded-full px-3 py-1.5 text-[11px] font-bold border transition-colors ${on
                  ? 'bg-red-600 text-white border-red-600 hover:bg-red-700'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-red-300 hover:bg-red-50/40'}`}
              >
                {on ? '✓ ' : '+ '}{f.label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2 mt-4">
          <button
            onClick={saveMandatory}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm px-4 py-2 rounded-xl shadow-sm transition-colors"
          >Enregistrer les champs obligatoires</button>
          <button
            onClick={resetMandatory}
            className="px-4 py-2 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-100 border border-slate-200"
          >Rétablir le défaut (fournisseur)</button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
        <h2 className="text-lg font-black text-slate-800">Options des listes déroulantes</h2>
        <p className="text-xs text-slate-400 mb-4">Une valeur par ligne — enregistrées dans la base d’administration elle-même.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Liste à modifier</label>
            <select className={inputCls} value={optionKey} onChange={(e) => switchOption(e.target.value)}>
              {OPTION_KEYS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
            <p className="text-[10px] text-slate-400 mt-2">
              {optionKey === 'gradesByCorps'
                ? 'Format attendu : PR = PR2, PR1, CE2, CE1 (un corps par ligne).'
                : optionKey === 'congesQuotaByType'
                  ? 'Format attendu : Doctorant = 47 (une ligne par corps ou type ; « Par défaut » s’applique aux fiches sans correspondance).'
                  : 'Une valeur par ligne. Vide = aucune valeur.'}
            </p>
          </div>
          <div>
            <label className={labelCls}>Valeurs</label>
            <textarea
              className={`${inputCls} min-h-[180px] font-mono text-xs leading-relaxed`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck="false"
            />
          </div>
        </div>
        <div className="flex items-center gap-2 mt-4">
          <button onClick={saveOption} className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm px-4 py-2 rounded-xl shadow-sm transition-colors">Enregistrer cette liste</button>
          <button onClick={resetDefaults} className="px-4 py-2 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-100 border border-slate-200">Rétablir les valeurs par défaut</button>
        </div>
      </div>
    </div>
  );
};

