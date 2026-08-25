// src/components/Calculations.jsx

import React, { useMemo, useState } from 'react';
import { SearchableSelect } from './SearchableSelect';

const inputCls =
  'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 bg-white';

const labelCls = 'block text-[10px] font-bold text-slate-400 uppercase mb-1';

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

const num = (value) => {
  const n = parseFloat(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

const fmt = (value, digits = 4) => {
  if (!Number.isFinite(value)) return '—';
  return Number(value.toFixed(digits)).toLocaleString();
};

const findUnitFactor = (units, value, defaultUnit) => {
  const found = units.find((u) => u.value === value);
  return found ? found.factor : units.find((u) => u.value === defaultUnit)?.factor || 1;
};

function Field({ label, children }) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      {children}
    </div>
  );
}

function UnitSelect({ value, onChange, units }) {
  return (
    <select value={value} onChange={onChange} className={inputCls}>
      {units.map((u) => (
        <option key={u.value} value={u.value}>
          {u.value}
        </option>
      ))}
    </select>
  );
}

function ResultBox({ ok, children }) {
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
}

function HowManyMg({ mw }) {
  const [conc, setConc] = useState('10');
  const [concUnit, setConcUnit] = useState('µM');
  const [volume, setVolume] = useState('1000');
  const [volumeUnit, setVolumeUnit] = useState('µL');

  const concM = num(conc) * findUnitFactor(CONC_UNITS, concUnit, 'µM');
  const volumeL = num(volume) * findUnitFactor(VOLUME_UNITS, volumeUnit, 'µL');

  const moles = concM * volumeL;
  const mg = mw ? moles * mw * 1000 : null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
      <div className="md:col-span-3">
        <Field label="Required concentration">
          <input
            type="number"
            value={conc}
            onChange={(e) => setConc(e.target.value)}
            className={inputCls}
          />
        </Field>
      </div>

      <div className="md:col-span-2">
        <Field label="Concentration unit">
          <UnitSelect value={concUnit} onChange={(e) => setConcUnit(e.target.value)} units={CONC_UNITS} />
        </Field>
      </div>

      <div className="md:col-span-3">
        <Field label="Final volume">
          <input
            type="number"
            value={volume}
            onChange={(e) => setVolume(e.target.value)}
            className={inputCls}
          />
        </Field>
      </div>

      <div className="md:col-span-2">
        <Field label="Volume unit">
          <UnitSelect
            value={volumeUnit}
            onChange={(e) => setVolumeUnit(e.target.value)}
            units={VOLUME_UNITS}
          />
        </Field>
      </div>

      <div className="md:col-span-2 flex items-end">
        <div className="w-full border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 text-sm font-bold text-slate-700">
          {mw ? `${fmt(mg)} mg` : 'MW required'}
        </div>
      </div>

      <div className="md:col-span-12">
        <ResultBox ok={!!mw}>
          {mw
            ? `Amount = ${fmt(mg)} mg. Formula: C × V × MW.`
            : 'Select a compound with known MW or enter a manual MW override.'}
        </ResultBox>
      </div>
    </div>
  );
}

function HowManyUl({ mw }) {
  const [mass, setMass] = useState('1');
  const [massUnit, setMassUnit] = useState('mg');
  const [conc, setConc] = useState('10');
  const [concUnit, setConcUnit] = useState('µM');

  const massG = num(mass) * findUnitFactor(MASS_UNITS, massUnit, 'mg');
  const concM = num(conc) * findUnitFactor(CONC_UNITS, concUnit, 'µM');

  const moles = mw ? massG / mw : 0;
  const volumeL = mw && concM > 0 ? moles / concM : 0;
  const ul = volumeL * 1e6;

  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
      <div className="md:col-span-3">
        <Field label="Amount of compound">
          <input
            type="number"
            value={mass}
            onChange={(e) => setMass(e.target.value)}
            className={inputCls}
          />
        </Field>
      </div>

      <div className="md:col-span-2">
        <Field label="Mass unit">
          <UnitSelect value={massUnit} onChange={(e) => setMassUnit(e.target.value)} units={MASS_UNITS} />
        </Field>
      </div>

      <div className="md:col-span-3">
        <Field label="Desired concentration">
          <input
            type="number"
            value={conc}
            onChange={(e) => setConc(e.target.value)}
            className={inputCls}
          />
        </Field>
      </div>

      <div className="md:col-span-2">
        <Field label="Concentration unit">
          <UnitSelect value={concUnit} onChange={(e) => setConcUnit(e.target.value)} units={CONC_UNITS} />
        </Field>
      </div>

      <div className="md:col-span-2 flex items-end">
        <div className="w-full border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 text-sm font-bold text-slate-700">
          {mw && concM > 0 ? `${fmt(ul)} µL` : 'MW required'}
        </div>
      </div>

      <div className="md:col-span-12">
        <ResultBox ok={!!mw && concM > 0}>
          {mw && concM > 0
            ? `Solvent/sample volume needed = ${fmt(ul)} µL.`
            : 'Enter MW and a non-zero concentration.'}
        </ResultBox>
      </div>
    </div>
  );
}

function HowManyMgNeeded({ mw }) {
  const [volumePerExperiment, setVolumePerExperiment] = useState('20');
  const [volumeUnit, setVolumeUnit] = useState('µL');
  const [conc, setConc] = useState('10');
  const [concUnit, setConcUnit] = useState('µM');
  const [repetitions, setRepetitions] = useState('3');
  const [experiments, setExperiments] = useState('1');

  const volFactor = findUnitFactor(VOLUME_UNITS, volumeUnit, 'µL');
  const concM = num(conc) * findUnitFactor(CONC_UNITS, concUnit, 'µM');

  const totalVolumeL =
    num(volumePerExperiment) * volFactor * num(repetitions) * num(experiments);

  const totalMg = mw ? totalVolumeL * concM * mw * 1000 : null;
  const totalUl = totalVolumeL * 1e6;

  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
      <div className="md:col-span-2">
        <Field label="µL per experiment">
          <input
            type="number"
            value={volumePerExperiment}
            onChange={(e) => setVolumePerExperiment(e.target.value)}
            className={inputCls}
          />
        </Field>
      </div>

      <div className="md:col-span-2">
        <Field label="Volume unit">
          <UnitSelect
            value={volumeUnit}
            onChange={(e) => setVolumeUnit(e.target.value)}
            units={VOLUME_UNITS}
          />
        </Field>
      </div>

      <div className="md:col-span-2">
        <Field label="Concentration">
          <input
            type="number"
            value={conc}
            onChange={(e) => setConc(e.target.value)}
            className={inputCls}
          />
        </Field>
      </div>

      <div className="md:col-span-2">
        <Field label="Conc. unit">
          <UnitSelect value={concUnit} onChange={(e) => setConcUnit(e.target.value)} units={CONC_UNITS} />
        </Field>
      </div>

      <div className="md:col-span-2">
        <Field label="Repetitions">
          <input
            type="number"
            value={repetitions}
            onChange={(e) => setRepetitions(e.target.value)}
            className={inputCls}
          />
        </Field>
      </div>

      <div className="md:col-span-2">
        <Field label="Experiments">
          <input
            type="number"
            value={experiments}
            onChange={(e) => setExperiments(e.target.value)}
            className={inputCls}
          />
        </Field>
      </div>

      <div className="md:col-span-12">
        <ResultBox ok={!!mw}>
          {mw
            ? `Total volume = ${fmt(totalUl)} µL. Total compound required = ${fmt(totalMg)} mg.`
            : 'Select a compound with known MW or enter a manual MW override.'}
        </ResultBox>
      </div>
    </div>
  );
}

function HowManyUlNeeded({ mw }) {
  const [volumePerExperiment, setVolumePerExperiment] = useState('20');
  const [volumeUnit, setVolumeUnit] = useState('µL');
  const [repetitions, setRepetitions] = useState('3');
  const [experiments, setExperiments] = useState('1');
  const [conc, setConc] = useState('10');
  const [concUnit, setConcUnit] = useState('µM');

  const volFactor = findUnitFactor(VOLUME_UNITS, volumeUnit, 'µL');
  const concM = num(conc) * findUnitFactor(CONC_UNITS, concUnit, 'µM');

  const totalSelectedUnits =
    num(volumePerExperiment) * num(repetitions) * num(experiments);

  const totalL = totalSelectedUnits * volFactor;
  const totalUl = totalL * 1e6;

  const totalMg = mw ? totalL * concM * mw * 1000 : null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
      <div className="md:col-span-2">
        <Field label="Volume per experiment">
          <input
            type="number"
            value={volumePerExperiment}
            onChange={(e) => setVolumePerExperiment(e.target.value)}
            className={inputCls}
          />
        </Field>
      </div>

      <div className="md:col-span-2">
        <Field label="Volume unit">
          <UnitSelect
            value={volumeUnit}
            onChange={(e) => setVolumeUnit(e.target.value)}
            units={VOLUME_UNITS}
          />
        </Field>
      </div>

      <div className="md:col-span-2">
        <Field label="Repetitions">
          <input
            type="number"
            value={repetitions}
            onChange={(e) => setRepetitions(e.target.value)}
            className={inputCls}
          />
        </Field>
      </div>

      <div className="md:col-span-2">
        <Field label="Experiments">
          <input
            type="number"
            value={experiments}
            onChange={(e) => setExperiments(e.target.value)}
            className={inputCls}
          />
        </Field>
      </div>

      <div className="md:col-span-2">
        <Field label="Concentration, optional">
          <input
            type="number"
            value={conc}
            onChange={(e) => setConc(e.target.value)}
            className={inputCls}
          />
        </Field>
      </div>

      <div className="md:col-span-2">
        <Field label="Conc. unit">
          <UnitSelect value={concUnit} onChange={(e) => setConcUnit(e.target.value)} units={CONC_UNITS} />
        </Field>
      </div>

      <div className="md:col-span-12">
        <ResultBox ok={true}>
          Total sample volume = {fmt(totalUl)} µL
          {totalMg ? `. At the selected concentration, compound needed = ${fmt(totalMg)} mg.` : '.'}
        </ResultBox>
      </div>
    </div>
  );
}

export function Calculations({ compoundOptions = [], compoundMeta = {} }) {
  const options = useMemo(() => {
    return [...new Set(compoundOptions.filter(Boolean))];
  }, [compoundOptions]);

  const [selectedCompound, setSelectedCompound] = useState(options[0] || '');
  const [manualMw, setManualMw] = useState('');
  const [tab, setTab] = useState('mg');

  const selectedMeta = compoundMeta[selectedCompound] || {};

  const effectiveMw = useMemo(() => {
    const manual = parseFloat(manualMw);

    if (Number.isFinite(manual) && manual > 0) {
      return manual;
    }

    if (selectedMeta?.molecularWeight) {
      return Number(selectedMeta.molecularWeight);
    }

    return null;
  }, [manualMw, selectedMeta]);

  const tabs = [
    { id: 'mg', label: 'How many mg?' },
    { id: 'ul-from-mg', label: 'How many µL?' },
    { id: 'mg-needed', label: 'How many mg do I need?' },
    { id: 'ul-needed', label: 'How many µL do I need?' }
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
        <h2 className="text-lg font-black text-slate-800 mb-1">Calculations</h2>
        <p className="text-sm text-slate-500 mb-4">
          Mass and volume calculators using molecular weight from compound definitions.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-4">
            <label className={labelCls}>Compound</label>
            <SearchableSelect
              value={selectedCompound}
              onChange={(v) => setSelectedCompound(v)}
              options={options}
              placeholder="Manual only — type to search"
              onClear={() => setSelectedCompound('')}
            />
          </div>

          <div className="md:col-span-3">
            <label className={labelCls}>Manual MW override, Da</label>
            <input
              type="number"
              value={manualMw}
              onChange={(e) => setManualMw(e.target.value)}
              placeholder="Optional"
              className={inputCls}
            />
          </div>

          <div className="md:col-span-3">
            <label className={labelCls}>Active MW</label>
            <div className="w-full border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 text-sm font-bold text-slate-700">
              {effectiveMw ? `${Number(effectiveMw).toLocaleString()} Da` : 'Not set'}
            </div>
          </div>

          <div className="md:col-span-2">
            <label className={labelCls}>Source</label>
            <div className="w-full border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 text-sm font-bold text-slate-700">
              {manualMw ? 'Manual' : selectedMeta?.molecularWeight ? 'Definition' : 'None'}
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

        {tab === 'mg' && <HowManyMg mw={effectiveMw} />}
        {tab === 'ul-from-mg' && <HowManyUl mw={effectiveMw} />}
        {tab === 'mg-needed' && <HowManyMgNeeded mw={effectiveMw} />}
        {tab === 'ul-needed' && <HowManyUlNeeded mw={effectiveMw} />}
      </div>
    </div>
  );
}
