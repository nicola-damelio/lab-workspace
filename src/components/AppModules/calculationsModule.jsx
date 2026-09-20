/* =========================================================================
   src/components/AppModules/calculationsModule.jsx
   Molecular weight / concentration calculator UI (extracted from App.jsx).
   ========================================================================= */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { SearchableSelect } from '../SearchableSelect';
import { CALC_INPUT_CLS, CALC_LABEL_CLS } from '../../utils/styles';
/* Le tri, le filtrage et l'inventaire des calculs vivent dans un module pur :
   une identité inconnue ne cache jamais une donnée, et ce qui est masqué est
   TOUJOURS compté pour être annoncé (voir utils/calculationEntries.js). */
import {
  CALC_FILTER_ALL,
  CALC_FILTER_MINE,
  CALC_FILTER_UNKNOWN,
  calcEntryOperator,
  calcInventory,
  countCalcEntries,
  defaultCalcFilter,
  describeHiddenCalc,
  isCalcUnattributed,
  lastCalcCompound,
  selectCalcEntries
} from '../../utils/calculationEntries';

/* =========================================================
   CALCULATION UI COMPONENTS
========================================================= */

const CONC_UNITS = [
  { value: 'nM', factor: 1e-9 },
  { value: 'µM', factor: 1e-6 },
  { value: 'mM', factor: 1e-3 },
  { value: 'M', factor: 1 }
];

const VOLUME_UNITS = [
  { value: 'nL', factor: 1e-9 },
  { value: 'µL', factor: 1e-6 },
  { value: 'mL', factor: 1e-3 },
  { value: 'L', factor: 1 }
];

const MASS_UNITS = [
  { value: 'µg', factor: 1e-6 },
  { value: 'mg', factor: 1e-3 },
  { value: 'g', factor: 1 }
];

const calcNum = (value) => {
  const n = parseFloat(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

const calcFmt = (value, digits = 4) => {
  if (!Number.isFinite(value)) return '—';
  return Number(value.toFixed(digits)).toLocaleString();
};

const findUnitFactor = (units, value, defaultUnit) => {
  const found = units.find((u) => u.value === value);
  return found ? found.factor : units.find((u) => u.value === defaultUnit)?.factor || 1;
};

const CalcField = ({ label, children }) => {
  return (
    <div>
      <label className={CALC_LABEL_CLS}>{label}</label>
      {children}
    </div>
  );
};

const CalcUnitSelect = ({ value, onChange, units }) => {
  return (
    <select value={value} onChange={onChange} className={CALC_INPUT_CLS}>
      {units.map((u) => (
        <option key={u.value} value={u.value}>
          {u.value}
        </option>
      ))}
    </select>
  );
};

const CalcResultBox = ({ ok, children }) => {
  return (
    <div
      className={`rounded-xl border p-4 text-sm font-bold ${
        ok
          ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
          : 'bg-amber-50 border-amber-200 text-amber-800'
      }`}
    >
      {children}
    </div>
  );
};

// "Formula & procedure" info block shown at the top of every calculator:
// the exact formula used (math notation) plus a short step-by-step procedure.
const CalcInfo = ({ lines = [], steps = [] }) => (
  <div className="md:col-span-12 rounded-lg bg-indigo-50 border border-indigo-200 px-3 py-2.5">
    <p className="text-[10px] font-bold text-indigo-700 uppercase tracking-wide mb-1">Formula &amp; procedure</p>
    {lines.map((l, i) => (
      <p key={i} className="text-xs font-mono text-indigo-900 bg-white/70 border border-indigo-100 rounded px-2 py-1 mb-1">
        {l}
      </p>
    ))}
    {steps.length > 0 && (
      <ol className="text-[11px] text-indigo-800 leading-relaxed list-decimal list-inside space-y-0.5">
        {steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
    )}
  </div>
);

const DEFAULT_MG_CALC = {
  conc: '10',
  concUnit: 'µM',
  volume: '1000',
  volumeUnit: 'µL'
};

const DEFAULT_UL_CALC = {
  mass: '1',
  massUnit: 'mg',
  conc: '10',
  concUnit: 'µM'
};

const DEFAULT_UL_ALL_CALC = {
  volumePerExperiment: '20',
  volumeUnit: 'µL',
  repetitions: '3',
  experiments: '1',
  conc: '10',
  concUnit: 'µM'
};

const HowManyMg = ({ mw, data, onChange }) => {
  const concM = calcNum(data.conc) * findUnitFactor(CONC_UNITS, data.concUnit, 'µM');
  const volumeL = calcNum(data.volume) * findUnitFactor(VOLUME_UNITS, data.volumeUnit, 'µL');

  const moles = concM * volumeL;
  const mg = mw ? moles * mw * 1000 : null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
      <CalcInfo
        lines={[
          'moles = concentration (M) × volume (L)',
          'mass (mg) = moles × molecular weight (g/mol) × 1000'
        ]}
        steps={[
          'Enter the required concentration and the final volume.',
          'The app converts to M and L, computes the moles (C × V) and multiplies by the MW to give the amount of compound to weigh, in mg.'
        ]}
      />
      <div className="md:col-span-3">
        <CalcField label="Required concentration">
          <input
            type="number"
            value={data.conc}
            onChange={(e) => onChange({ conc: e.target.value })}
            className={CALC_INPUT_CLS}
          />
        </CalcField>
      </div>

      <div className="md:col-span-2">
        <CalcField label="Concentration unit">
          <CalcUnitSelect
            value={data.concUnit}
            onChange={(e) => onChange({ concUnit: e.target.value })}
            units={CONC_UNITS}
          />
        </CalcField>
      </div>

      <div className="md:col-span-3">
        <CalcField label="Final volume">
          <input
            type="number"
            value={data.volume}
            onChange={(e) => onChange({ volume: e.target.value })}
            className={CALC_INPUT_CLS}
          />
        </CalcField>
      </div>

      <div className="md:col-span-2">
        <CalcField label="Volume unit">
          <CalcUnitSelect
            value={data.volumeUnit}
            onChange={(e) => onChange({ volumeUnit: e.target.value })}
            units={VOLUME_UNITS}
          />
        </CalcField>
      </div>

      <div className="md:col-span-2 flex items-end">
        <div className="w-full border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 text-sm font-bold text-slate-700">
          {mw ? `${calcFmt(mg)} mg` : 'MW required'}
        </div>
      </div>

      <div className="md:col-span-12">
        <CalcResultBox ok={!!mw}>
          {mw
            ? `Amount = ${calcFmt(mg)} mg. Formula: C × V × MW.`
            : 'Select a compound with known MW or enter a manual MW override.'}
        </CalcResultBox>
      </div>
    </div>
  );
};

const HowManyUl = ({ mw, data, onChange }) => {
  const massG = calcNum(data.mass) * findUnitFactor(MASS_UNITS, data.massUnit, 'mg');
  const concM = calcNum(data.conc) * findUnitFactor(CONC_UNITS, data.concUnit, 'µM');

  const moles = mw ? massG / mw : 0;
  const volumeL = mw && concM > 0 ? moles / concM : 0;
  const ul = volumeL * 1e6;

  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
      <CalcInfo
        lines={[
          'moles = mass (g) ÷ molecular weight (g/mol)',
          'volume (L) = moles ÷ concentration (M)',
          'volume (µL) = volume (L) × 10⁶'
        ]}
        steps={[
          'Enter the weighed amount of compound and the desired concentration.',
          'The app computes the moles (mass ÷ MW), then the volume of solvent that brings them to the target concentration.'
        ]}
      />
      <div className="md:col-span-3">
        <CalcField label="Amount of compound">
          <input
            type="number"
            value={data.mass}
            onChange={(e) => onChange({ mass: e.target.value })}
            className={CALC_INPUT_CLS}
          />
        </CalcField>
      </div>

      <div className="md:col-span-2">
        <CalcField label="Mass unit">
          <CalcUnitSelect
            value={data.massUnit}
            onChange={(e) => onChange({ massUnit: e.target.value })}
            units={MASS_UNITS}
          />
        </CalcField>
      </div>

      <div className="md:col-span-3">
        <CalcField label="Desired concentration">
          <input
            type="number"
            value={data.conc}
            onChange={(e) => onChange({ conc: e.target.value })}
            className={CALC_INPUT_CLS}
          />
        </CalcField>
      </div>

      <div className="md:col-span-2">
        <CalcField label="Concentration unit">
          <CalcUnitSelect
            value={data.concUnit}
            onChange={(e) => onChange({ concUnit: e.target.value })}
            units={CONC_UNITS}
          />
        </CalcField>
      </div>

      <div className="md:col-span-2 flex items-end">
        <div className="w-full border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 text-sm font-bold text-slate-700">
          {mw && concM > 0 ? `${calcFmt(ul)} µL` : 'MW required'}
        </div>
      </div>

      <div className="md:col-span-12">
        <CalcResultBox ok={!!mw && concM > 0}>
          {mw && concM > 0
            ? `Solvent/sample volume needed = ${calcFmt(ul)} µL.`
            : 'Enter MW and a non-zero concentration.'}
        </CalcResultBox>
      </div>
    </div>
  );
};

const HowManyUlForAllExperiments = ({ mw, data, onChange }) => {
  const volFactor = findUnitFactor(VOLUME_UNITS, data.volumeUnit, 'µL');
  const concM = calcNum(data.conc) * findUnitFactor(CONC_UNITS, data.concUnit, 'µM');

  const totalSelectedUnits =
    calcNum(data.volumePerExperiment) * calcNum(data.repetitions) * calcNum(data.experiments);

  const totalL = totalSelectedUnits * volFactor;
  const totalUl = totalL * 1e6;

  const totalMg = mw ? totalL * concM * mw * 1000 : null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
      <CalcInfo
        lines={[
          'total volume = volume per experiment × repetitions × experiments',
          'mass (mg) = total volume (L) × concentration (M) × MW × 1000   (optional)'
        ]}
        steps={[
          'Enter the volume needed for one experiment, the repetitions and the total number of experiments.',
          'The app multiplies them to get the total stock-solution volume to prepare — and, when a concentration is given, the total mass of compound required.'
        ]}
      />
      <div className="md:col-span-2">
        <CalcField label="Volume per experiment">
          <input
            type="number"
            value={data.volumePerExperiment}
            onChange={(e) => onChange({ volumePerExperiment: e.target.value })}
            className={CALC_INPUT_CLS}
          />
        </CalcField>
      </div>

      <div className="md:col-span-2">
        <CalcField label="Volume unit">
          <CalcUnitSelect
            value={data.volumeUnit}
            onChange={(e) => onChange({ volumeUnit: e.target.value })}
            units={VOLUME_UNITS}
          />
        </CalcField>
      </div>

      <div className="md:col-span-2">
        <CalcField label="Repetitions">
          <input
            type="number"
            value={data.repetitions}
            onChange={(e) => onChange({ repetitions: e.target.value })}
            className={CALC_INPUT_CLS}
          />
        </CalcField>
      </div>

      <div className="md:col-span-2">
        <CalcField label="Experiments">
          <input
            type="number"
            value={data.experiments}
            onChange={(e) => onChange({ experiments: e.target.value })}
            className={CALC_INPUT_CLS}
          />
        </CalcField>
      </div>

      <div className="md:col-span-2">
        <CalcField label="Concentration, optional">
          <input
            type="number"
            value={data.conc}
            onChange={(e) => onChange({ conc: e.target.value })}
            className={CALC_INPUT_CLS}
          />
        </CalcField>
      </div>

      <div className="md:col-span-2">
        <CalcField label="Conc. unit">
          <CalcUnitSelect
            value={data.concUnit}
            onChange={(e) => onChange({ concUnit: e.target.value })}
            units={CONC_UNITS}
          />
        </CalcField>
      </div>

      <div className="md:col-span-6 flex items-end mt-2">
        <div className="w-full">
          <CalcField label="Total Volume Needed">
            <div className="w-full border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 text-sm font-bold text-slate-700">
              {calcFmt(totalUl)} µL
            </div>
          </CalcField>
        </div>
      </div>

      <div className="md:col-span-6 flex items-end mt-2">
        <div className="w-full">
          <CalcField label="Total Compound Needed">
            <div className="w-full border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 text-sm font-bold text-slate-700">
              {totalMg ? `${calcFmt(totalMg)} mg` : 'MW required'}
            </div>
          </CalcField>
        </div>
      </div>

      <div className="md:col-span-12">
        <CalcResultBox ok={true}>
          Total sample volume = {calcFmt(totalUl)} µL
          {totalMg
            ? `. At the selected concentration, compound needed = ${calcFmt(totalMg)} mg.`
            : '. Provide MW and concentration to calculate milligrams.'}
        </CalcResultBox>
      </div>
    </div>
  );
};

export const Calculations = ({
  compoundOptions = [],
  compoundMeta = {},
  calculationEntries = {},
  setCalculationEntries,
  currentUser,
  /* Fichier du dataset sur le Drive — affiché pour que « est-ce bien
     enregistré ? » se vérifie de l'œil (voir App.jsx → workspaceDatasetPath). */
  datasetDrivePath = ''
}) => {
  const isSuperuserCalc = currentUser?.role === 'superuser';
  const myName = currentUser?.name || null;
  /* Qui voit quoi : un superutilisateur ouvre sur « tous les scientifiques »,
     un scientifique connecté sur ses calculs, et un poste SANS compte connecté
     sur TOUT — sans nom on ne peut attribuer personne, donc on ne cache rien
     (sinon les calculs sembleraient perdus sur un second poste). */
  const [calcScientistFilter, setCalcScientistFilter] = useState(() =>
    defaultCalcFilter({ isSuperuser: isSuperuserCalc, myName })
  );
  const options = useMemo(() => {
    return [...new Set(compoundOptions.filter(Boolean))];
  }, [compoundOptions]);

  const [selectedCompound, setSelectedCompound] = useState(options[0] || '');

  /* L'INVENTAIRE du dataset (déjà relu du Drive / de Firestore avec lui). */
  const inventory = useMemo(() => calcInventory(calculationEntries), [calculationEntries]);
  const datasetCalcCount = useMemo(() => countCalcEntries(calculationEntries), [calculationEntries]);

  /* Ouvrir le composé du calcul le PLUS RÉCENT : sur un poste neuf, la page ne
     dit plus « aucun calcul » simplement parce qu'elle regardait le premier
     composé de la liste alphabétique. Un choix de l'utilisateur reste maître
     ensuite (le saut n'a lieu qu'une fois par ouverture de page). */
  const jumpedToRecentRef = useRef(false);
  useEffect(() => {
    if (jumpedToRecentRef.current) return;
    const recent = lastCalcCompound(calculationEntries);
    if (!recent) return;
    jumpedToRecentRef.current = true;
    setSelectedCompound(recent);
  }, [calculationEntries]);

  /* Le compte connecté change (connexion / déconnexion) : le filtre suit, pour
     qu'un scientifique voie toujours SES calculs et qu'un poste anonyme ne
     cache rien. */
  useEffect(() => {
    setCalcScientistFilter(defaultCalcFilter({ isSuperuser: isSuperuserCalc, myName }));
  }, [isSuperuserCalc, myName]);
  const [manualMw, setManualMw] = useState('');
  const [tab, setTab] = useState('mg');
  const [saveLabel, setSaveLabel] = useState('');

  const [mgData, setMgData] = useState(DEFAULT_MG_CALC);
  const [ulData, setUlData] = useState(DEFAULT_UL_CALC);
  const [ulAllData, setUlAllData] = useState(DEFAULT_UL_ALL_CALC);

  useEffect(() => {
    if (!selectedCompound && options.length > 0) {
      setSelectedCompound(options[0]);
    }
  }, [options, selectedCompound]);

  const selectedMw = compoundMeta[selectedCompound]?.molecularWeight;

  const effectiveMw = useMemo(() => {
    const manual = parseFloat(manualMw);

    if (Number.isFinite(manual) && manual > 0) {
      return manual;
    }

    if (selectedMw) {
      return Number(selectedMw);
    }

    return null;
  }, [manualMw, selectedMw]);

  const tabs = [
    { id: 'mg', label: 'How many mg?' },
    { id: 'ul-from-mg', label: 'How many µL?' },
    {
      id: 'ul-all',
      label: 'How many µL do I need for all my experiments?'
    }
  ];

  const getTabLabel = (id) => {
    const found = tabs.find((t) => t.id === id);
    return found ? found.label : id;
  };

  const updateMg = (patch) => {
    setMgData((prev) => ({ ...prev, ...patch }));
  };

  const updateUl = (patch) => {
    setUlData((prev) => ({ ...prev, ...patch }));
  };

  const updateUlAll = (patch) => {
    setUlAllData((prev) => ({ ...prev, ...patch }));
  };

  const getCurrentData = () => {
    if (tab === 'mg') return mgData;
    if (tab === 'ul-from-mg') return ulData;
    return ulAllData;
  };

  const saveCurrentCalculation = () => {
    if (!setCalculationEntries) return;

    if (!selectedCompound) {
      alert('Select a compound before saving calculation data.');
      return;
    }

    const now = new Date();

    const entry = {
      id: `calc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      tab,
      label: saveLabel.trim() || `${getTabLabel(tab)} — ${now.toLocaleString()}`,
      data: getCurrentData(),
      mw: effectiveMw ?? null,
      createdAt: Date.now(),
      operator: myName || 'unknown', // associate with the scientist who saved it
    };

    setCalculationEntries((prev) => {
      const existing = prev[selectedCompound] || [];

      return {
        ...prev,
        [selectedCompound]: [...existing, entry]
      };
    });

    setSaveLabel('');
  };

  const removeEntry = (id) => {
    if (!setCalculationEntries || !selectedCompound) return;

    setCalculationEntries((prev) => {
      const existing = prev[selectedCompound] || [];
      const nextEntries = existing.filter((entry) => entry.id !== id);

      const next = { ...prev };

      if (nextEntries.length === 0) {
        delete next[selectedCompound];
      } else {
        next[selectedCompound] = nextEntries;
      }

      return next;
    });
  };

  const clearAllEntries = () => {
    if (!setCalculationEntries || !selectedCompound) return;

    const ok = window.confirm(
      `Remove all saved calculation data for ${selectedCompound}?`
    );

    if (!ok) return;

    setCalculationEntries((prev) => {
      const next = { ...prev };
      delete next[selectedCompound];
      return next;
    });
  };

  const loadEntry = (entry) => {
    const tabToLoad = entry.tab === 'ul-needed' ? 'ul-all' : entry.tab;

    setTab(tabToLoad);

    if (tabToLoad === 'mg') {
      setMgData({ ...DEFAULT_MG_CALC, ...entry.data });
    } else if (tabToLoad === 'ul-from-mg') {
      setUlData({ ...DEFAULT_UL_CALC, ...entry.data });
    } else if (tabToLoad === 'ul-all') {
      setUlAllData({ ...DEFAULT_UL_ALL_CALC, ...entry.data });
    }
  };

  // Les calculs du composé choisi — filtrage ET comptage viennent du module
  // partagé : une identité inconnue ne cache jamais une donnée, et ce qui est
  // masqué est compté (`selection.hiddenCount`) pour être annoncé à l'écran.
  const allEntries = selectedCompound ? calculationEntries[selectedCompound] || [] : [];
  const selection = selectCalcEntries(allEntries, { filter: calcScientistFilter, myName });
  const entries = selection.visible;
  const calcScientists = selection.scientists;
  const hiddenCalc = describeHiddenCalc(selection.hiddenCount);

  const formatEntryData = (data) => {
    return Object.entries(data || {})
      .map(([key, value]) => `${key}: ${value}`)
      .join(' · ');
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
        <h2 className="text-lg font-black text-slate-800 mb-1">Calculations</h2>

        <p className="text-sm text-slate-500 mb-4">
          Mass and volume calculators using molecular weight from compound definitions.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-4">
            <label className={CALC_LABEL_CLS}>Compound</label>

            <SearchableSelect
              value={selectedCompound}
              onChange={(v) => setSelectedCompound(v)}
              options={options}
              placeholder="Manual only — type to search"
              onClear={() => setSelectedCompound('')}
            />
          </div>

          <div className="md:col-span-3">
            <label className={CALC_LABEL_CLS}>Manual MW override, Da</label>

            <input
              type="number"
              value={manualMw}
              onChange={(e) => setManualMw(e.target.value)}
              placeholder="Optional"
              className={CALC_INPUT_CLS}
            />
          </div>

          <div className="md:col-span-3">
            <label className={CALC_LABEL_CLS}>Active MW</label>

            <div className="w-full border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 text-sm font-bold text-slate-700">
              {effectiveMw ? `${Number(effectiveMw).toLocaleString()} Da` : 'Not set'}
            </div>
          </div>

          <div className="md:col-span-2">
            <label className={CALC_LABEL_CLS}>Source</label>

            <div className="w-full border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 text-sm font-bold text-slate-700">
              {manualMw ? 'Manual' : selectedMw ? 'Definition' : 'None'}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
        <div className="flex flex-wrap gap-2 mb-4">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-3 py-2 rounded-lg text-sm font-bold border transition-colors ${
                tab === t.id
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'mg' && <HowManyMg mw={effectiveMw} data={mgData} onChange={updateMg} />}

        {tab === 'ul-from-mg' && (
          <HowManyUl mw={effectiveMw} data={ulData} onChange={updateUl} />
        )}

        {tab === 'ul-all' && (
          <HowManyUlForAllExperiments
            mw={effectiveMw}
            data={ulAllData}
            onChange={updateUlAll}
          />
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
        {/* L'INVENTAIRE DU DATASET — toujours affiché, pour tout le monde.
            Les calculs voyagent avec le dataset (Firestore + copie Drive) :
            c'est ce cadre qui les MONTRE, et qui évite qu'un poste neuf
            conclue « aucun calcul » en regardant le mauvais composé
            (voir utils/calculationEntries.js). */}
        <div className="mb-4 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2.5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wide">
              Saved in this dataset
            </span>
            <span className="text-[10px] text-slate-400">
              {datasetCalcCount} calculation{datasetCalcCount === 1 ? '' : 's'} ·{' '}
              {inventory.length} compound{inventory.length === 1 ? '' : 's'}
            </span>
          </div>

          {inventory.length === 0 ? (
            <p className="text-xs text-slate-400 mt-1.5">
              Nothing saved yet. The first calculation you add is kept with this dataset —
              and therefore on the Drive, for your other PC.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {inventory.map((row) => (
                <button
                  key={row.compound}
                  type="button"
                  onClick={() => setSelectedCompound(row.compound)}
                  title={`${row.total} calculation${row.total === 1 ? '' : 's'}${row.scientists.length ? ` — ${row.scientists.join(', ')}` : ''}${row.unattributed ? ` (+${row.unattributed} without a name)` : ''}`}
                  className={`px-2 py-0.5 rounded-full border text-[11px] font-bold transition-colors ${
                    String(row.compound) === String(selectedCompound)
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {row.compound} · {row.total}
                  {row.unattributed > 0 ? ' ⚠' : ''}
                </button>
              ))}
            </div>
          )}

          {datasetDrivePath ? (
            <p className="text-[10px] text-slate-400 mt-2">
              Kept in <span className="font-mono">{datasetDrivePath}</span> on the Drive — written a few
              seconds after each change, and immediately when you leave the page.
            </p>
          ) : null}
        </div>

        <div className="flex flex-col md:flex-row md:items-end gap-3 mb-4">
          <div className="flex-1">
            <label className={CALC_LABEL_CLS}>Saved calculation label</label>

            <input
              type="text"
              value={saveLabel}
              onChange={(e) => setSaveLabel(e.target.value)}
              placeholder="Optional label for this calculation"
              className={CALC_INPUT_CLS}
            />
          </div>

          <button
            type="button"
            onClick={saveCurrentCalculation}
            disabled={!selectedCompound || !setCalculationEntries}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded-lg text-sm shadow-sm transition-colors"
          >
            + Add calculation data
          </button>

          <button
            type="button"
            onClick={clearAllEntries}
            disabled={!selectedCompound || entries.length === 0 || !setCalculationEntries}
            className="bg-red-50 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed text-red-600 border border-red-200 font-bold py-2 px-4 rounded-lg text-sm shadow-sm transition-colors"
          >
            Clear all for compound
          </button>
        </div>

        {/* Le filtre est disponible pour TOUT LE MONDE (il était réservé aux
            superutilisateurs : un scientifique ne pouvait donc même pas savoir
            qu'un calcul existait mais était masqué). Et ce qui est masqué est
            ANNONCÉ, avec un bouton pour tout revoir. */}
        {(allEntries.length > 0 || inventory.length > 0) && (
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <label className={CALC_LABEL_CLS}>Filter by scientist:</label>
            <select
              value={calcScientistFilter}
              onChange={(e) => setCalcScientistFilter(e.target.value)}
              className={CALC_INPUT_CLS}
            >
              <option value={CALC_FILTER_ALL}>All scientists</option>
              {myName ? <option value={CALC_FILTER_MINE}>My calculations ({myName})</option> : null}
              {calcScientists.map((s) => (<option key={s} value={s}>{s}</option>))}
              {allEntries.some(isCalcUnattributed) ? (
                <option value={CALC_FILTER_UNKNOWN}>Saved without a name</option>
              ) : null}
            </select>
            <span className="text-[10px] text-slate-400">
              {entries.length} of {selection.total} saved calculation(s)
            </span>
            {selection.hiddenCount > 0 && (
              <button
                type="button"
                onClick={() => setCalcScientistFilter(CALC_FILTER_ALL)}
                className="text-[11px] font-bold text-blue-700 underline"
              >
                {hiddenCalc} — show all
              </button>
            )}
          </div>
        )}

        <div className="flex flex-col gap-3">
          {!selectedCompound ? (
            <div className="text-sm text-slate-400 italic bg-slate-50 border border-dashed border-slate-300 rounded-lg p-4">
              Select a compound to save calculation data.
            </div>
          ) : entries.length === 0 ? (
            <div className="text-sm text-slate-400 italic bg-slate-50 border border-dashed border-slate-300 rounded-lg p-4">
              {selection.hiddenCount > 0
                ? `${hiddenCalc} for ${selectedCompound}.`
                : `No saved calculation data for ${selectedCompound}.`}
              {inventory.length > 0
                ? ` This dataset holds: ${inventory.map((row) => `${row.compound} (${row.total})`).join(', ')}.`
                : ''}
            </div>
          ) : (
            entries.map((entry) => (
              <div
                key={entry.id}
                className="border border-slate-200 rounded-lg p-3 bg-slate-50 flex flex-col md:flex-row md:items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-800 truncate">
                    {entry.label}
                  </div>

                  <div className="text-xs text-slate-500 mt-1">
                    {getTabLabel(entry.tab)} · MW:{' '}
                    {entry.mw ? `${Number(entry.mw).toLocaleString()} Da` : 'Not set'}
                    {' · '}
                    {calcEntryOperator(entry) || 'no name'}
                    {entry.createdAt
                      ? ` · ${new Date(Number(entry.createdAt)).toLocaleString()}`
                      : ''}
                  </div>

                  <div className="text-xs text-slate-600 mt-1 font-mono break-words">
                    {formatEntryData(entry.data)}
                  </div>
                </div>

                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => loadEntry(entry)}
                    className="bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 font-bold py-2 px-3 rounded-lg text-xs shadow-sm transition-colors"
                  >
                    Load
                  </button>

                  <button
                    type="button"
                    onClick={() => removeEntry(entry.id)}
                    className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-bold py-2 px-3 rounded-lg text-xs shadow-sm transition-colors"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};


/* =========================================================
   COMPOUND DEFINITION SECTION
========================================================= */

