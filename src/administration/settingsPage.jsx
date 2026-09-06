/* =========================================================================
   src/administration/settingsPage.jsx
   Setup d’une base d’administration : Équipe & accès (scientifiques,
   superutilisateur) + options des listes déroulantes (administration.settings).
   ========================================================================= */
import React, { useState } from 'react';
import { useAdmin } from './AdminContext';
import { ScientistsOperatorsManager } from '../components/AppModules/definitionsManagers';
import { DEFAULT_OPTIONS, DEPENSE_FIELD_CATALOG, DEFAULT_DEPENSE_MANDATORY } from './adminSchema';

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

export const SettingsPage = ({ operators, setOperators, authSettings, setAuthSettings, currentUser }) => {
  const { data, settings, updateSettings } = useAdmin();
  const [optionKey, setOptionKey] = useState('recetteTypes');
  const [text, setText] = useState(() => toText('recetteTypes', settings));

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
              Le statut (Permanent / Non permanent) et la fonction (AP / Gestionnaire) de la fiche déterminent les pages
              visibles — un compte sans fiche liée n’a qu’un accès minimal.
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

