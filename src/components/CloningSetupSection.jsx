import React from 'react';

import { toNumber, round, uid, INPUT_CLS, INPUT_BAD_CLS } from './cloningUtils';
import { CloningStrategyPlanner } from './CloningStrategyPlanner';

const SectionComment = ({ value, onChange, placeholder = 'Add notes about this section...' }) => (
  <div className="mt-3 pt-3 border-t border-slate-100">
    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
      📝 Notes / Comments
    </label>
    <textarea
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={2}
      className="w-full border border-slate-200 rounded-lg p-2.5 text-xs outline-none focus:border-indigo-400 bg-slate-50 resize-y"
    />
  </div>
);

const STEP_PRESETS = [
  { name: 'Initial Denaturation', temp: '98', timeValue: '30', timeUnit: 's', cycles: '1' },
  { name: 'Denature', temp: '98', timeValue: '10', timeUnit: 's', cycles: '1' },
  { name: 'Annealing', temp: '60', timeValue: '20', timeUnit: 's', cycles: '1' },
  { name: 'Extension', temp: '72', timeValue: '30', timeUnit: 's', cycles: '1' },
  { name: 'Final Extension', temp: '72', timeValue: '5', timeUnit: 'min', cycles: '1' },
  { name: 'Hold', temp: '4', timeValue: '60', timeUnit: 'min', cycles: '1' }
];

const PCR_TEMPLATE = [
  { name: 'Initial Denaturation', temp: '98', timeValue: '30', timeUnit: 's', cycles: '1' },
  { name: 'Denature', temp: '98', timeValue: '10', timeUnit: 's', cycles: '30' },
  { name: 'Annealing', temp: '60', timeValue: '20', timeUnit: 's', cycles: '30' },
  { name: 'Extension', temp: '72', timeValue: '30', timeUnit: 's', cycles: '30' },
  { name: 'Final Extension', temp: '72', timeValue: '5', timeUnit: 'min', cycles: '1' },
  { name: 'Hold', temp: '4', timeValue: '60', timeUnit: 'min', cycles: '1' }
];

const validateProgram = (program) => {
  const errors = [];
  const warnings = [];
  if (!program.length) {
    errors.push('The thermal cycler program is empty. Add at least one step.');
    return { errors, warnings };
  }
  program.forEach((s, i) => {
    const label = `Step ${i + 1} (${s.name || 'unnamed'})`;
    const t = toNumber(s.temp);
    if (t == null) errors.push(`${label}: temperature (°C) is mandatory.`);
    else if (t < 0 || t > 100) errors.push(`${label}: temperature must be 0–100 °C.`);
    const tv = toNumber(s.timeValue);
    if (tv == null || tv <= 0) errors.push(`${label}: a positive duration is mandatory.`);
    const cy = toNumber(s.cycles);
    if (cy == null || cy < 1) errors.push(`${label}: number of cycles must be ≥ 1.`);
  });
  if (!program.some((s) => /initial\s*denat|denaturation/i.test(s.name || '') && (toNumber(s.temp) || 0) >= 90)) {
    warnings.push('Recommended: start with an Initial Denaturation step (≥ 90 °C).');
  }
  if (!program.some((s) => /anneal/i.test(s.name || ''))) {
    warnings.push('Recommended: include an Annealing step.');
  }
  if (!program.some((s) => /exten/i.test(s.name || ''))) {
    warnings.push('Recommended: include an Extension step.');
  }
  const last = program[program.length - 1];
  if (!(toNumber(last?.temp) <= 10)) {
    warnings.push('Recommended: end with a Hold step at ≤ 10 °C.');
  }
  return { errors, warnings };
};

const stepInvalid = (s) => {
  const t = toNumber(s.temp);
  const tv = toNumber(s.timeValue);
  const cy = toNumber(s.cycles);
  return (
    t == null || t < 0 || t > 100 ||
    tv == null || tv <= 0 ||
    cy == null || cy < 1
  );
};

const programRuntimeSeconds = (program) =>
  program.reduce((sum, s) => {
    const tv = toNumber(s.timeValue) || 0;
    const cy = toNumber(s.cycles) || 1;
    const sec = s.timeUnit === 'min' ? tv * 60 : tv;
    return sum + sec * cy;
  }, 0);

const formatRuntime = (sec) => {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
};

const MIX_COMPONENTS = [
  'Nuclease-free Water',
  '10X Reaction Buffer',
  'dNTP Mix',
  'Forward Primer',
  'Reverse Primer',
  'Template DNA',
  'Polymerase',
  'MgCl₂',
  'DMSO'
];

const parseConc = (str) => {
  const m = String(str || '').match(/([\d.]+)\s*(nM|µM|uM|mM|M|X|%)?/i);
  if (!m) return null;
  const value = parseFloat(m[1]);
  if (!Number.isFinite(value)) return null;
  const unit = (m[2] || '').replace('uM', 'µM');
  return { value, unit };
};

export const CloningSetupSection = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const program = Array.isArray(activeTest.pcrProgram) ? activeTest.pcrProgram : [];
  const mix = Array.isArray(activeTest.reactionMix) ? activeTest.reactionMix : [];
  const lidTemp = activeTest.lidTemp ?? '';
  const targetVol = activeTest.mixTargetVolume ?? '';
  const { errors, warnings } = validateProgram(program);
  const complete = program.length > 0 && errors.length === 0;

  const setProgram = (next) => updateActiveTest({ pcrProgram: next });
  const updateStep = (id, patch) =>
    setProgram(program.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const addStep = (preset) =>
    setProgram([...program, { id: uid('step'), ...preset }]);
  const removeStep = (id) => setProgram(program.filter((s) => s.id !== id));
  const moveStep = (idx, dir) => {
    const next = [...program];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setProgram(next);
  };
  const loadTemplate = () =>
    setProgram(PCR_TEMPLATE.map((s) => ({ id: uid('step'), ...s })));

  const setMix = (next) => updateActiveTest({ reactionMix: next });
  const updateMixRow = (id, patch) =>
    setMix(mix.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const addMixRow = () =>
    setMix([...mix, { id: uid('mix'), name: '', stock: '', volume: '', note: '' }]);
  const removeMixRow = (id) => setMix(mix.filter((r) => r.id !== id));
  const totalVol = mix.reduce((s, r) => s + (toNumber(r.volume) || 0), 0);
  const finalConcOf = (row) => {
    const stock = parseConc(row.stock);
    const vol = toNumber(row.volume);
    if (!stock || vol == null || totalVol <= 0) return '—';
    if (!['nM', 'µM', 'mM', 'M', 'X', '%'].includes(stock.unit)) return '—';
    return `${round((stock.value * vol) / totalVol, 2)} ${stock.unit}`;
  };
  const autoFillWater = () => {
    const target = toNumber(targetVol);
    if (!target) { alert('Set a target total volume first.'); return; }
    const others = mix
      .filter((r) => !/water/i.test(r.name || ''))
      .reduce((s, r) => s + (toNumber(r.volume) || 0), 0);
    const water = Math.max(0, +(target - others).toFixed(2));
    const idx = mix.findIndex((r) => /water/i.test(r.name || ''));
    if (idx >= 0) {
      setMix(mix.map((r, i) => (i === idx ? { ...r, volume: String(water) } : r)));
    } else {
      setMix([
        { id: uid('mix'), name: 'Nuclease-free Water', stock: '', volume: String(water), note: 'auto-filled' },
        ...mix
      ]);
    }
  };

  return (
    <div className="flex flex-col">
      <div className="flex justify-end mb-4">
        <span className={`text-[10px] font-black px-2 py-1 rounded-full border ${complete ? 'bg-emerald-100 border-emerald-300 text-emerald-700' : 'bg-red-100 border-red-300 text-red-700'}`}>
          {complete ? '✅ Program complete' : '⚠️ Program incomplete'}
        </span>
      </div>

      {/* Cloning Strategy Planner — nested here, before the Thermal Cycler subsection */}
      <div className="mb-6">
        <CloningStrategyPlanner ctx={ctx} />
        <div className="mb-2">
          <SectionComment
            value={activeTest.cloningStrategyComment}
            onChange={(v) => updateActiveTest({ cloningStrategyComment: v })}
            placeholder="Notes about the chosen strategy (enzymes, assembly, troubleshooting)..."
          />
        </div>
      </div>

      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-3">
          <h4 className="text-xs font-black text-slate-600 uppercase">
            🧬 Thermal Cycler Program (structured — all fields mandatory)
          </h4>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={loadTemplate}
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs shadow-sm">
              ⚡ Load Standard 30-Cycle PCR
            </button>
            {STEP_PRESETS.map((p) => (
              <button key={p.name} type="button" onClick={() => addStep(p)}
                className="bg-white border border-slate-300 hover:bg-blue-50 hover:border-blue-300 text-slate-700 font-bold px-2.5 py-1.5 rounded-lg text-xs shadow-sm">
                + {p.name}
              </button>
            ))}
          </div>
        </div>

        {errors.length > 0 && (
          <div className="bg-red-50 border border-red-300 rounded-lg p-3 mb-3">
            <p className="text-xs font-black text-red-700 uppercase mb-1">
              ⚠️ Program incomplete — every step must define temperature, time and cycles
            </p>
            <ul className="list-disc ml-5 text-xs text-red-700 flex flex-col gap-0.5">
              {errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </div>
        )}
        {errors.length === 0 && warnings.length > 0 && (
          <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 mb-3">
            <ul className="list-disc ml-5 text-xs text-amber-700 flex flex-col gap-0.5">
              {warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </div>
        )}
        {complete && (
          <div className="bg-emerald-50 border border-emerald-300 rounded-lg p-3 mb-3 flex flex-wrap gap-4 items-center text-xs font-bold text-emerald-700">
            <span>✅ Program complete</span>
            <span>🧩 {program.length} steps</span>
            <span>⏱️ Estimated runtime: {formatRuntime(programRuntimeSeconds(program))}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Lid Temperature (°C)</label>
            <input type="number" value={lidTemp} onChange={(e) => updateActiveTest({ lidTemp: e.target.value })}
              className={INPUT_CLS} placeholder="e.g. 105" />
          </div>
        </div>

        <div className="overflow-x-auto custom-scrollbar border border-slate-200 rounded-lg bg-white">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="text-xs text-slate-500 uppercase bg-slate-100">
              <tr>
                <th className="px-3 py-2 text-left border-b">#</th>
                <th className="px-3 py-2 text-left border-b">Step Name *</th>
                <th className="px-3 py-2 text-left border-b">Temp (°C) *</th>
                <th className="px-3 py-2 text-left border-b">Time *</th>
                <th className="px-3 py-2 text-left border-b">Unit</th>
                <th className="px-3 py-2 text-left border-b">Cycles *</th>
                <th className="px-3 py-2 border-b w-24"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {program.length === 0 ? (
                <tr><td colSpan="7" className="px-3 py-6 text-center text-slate-400 italic">
                  No steps defined. Add steps manually or load the standard PCR template.
                </td></tr>
              ) : (
                program.map((s, idx) => {
                  const invalid = stepInvalid(s);
                  return (
                    <tr key={s.id} className={invalid ? 'bg-red-50/50' : 'hover:bg-slate-50'}>
                      <td className="px-3 py-1.5 text-xs font-bold text-slate-400">{idx + 1}</td>
                      <td className="px-3 py-1.5">
                        <input type="text" value={s.name} onChange={(e) => updateStep(s.id, { name: e.target.value })}
                          className={INPUT_CLS} placeholder="Step name (mandatory)" />
                      </td>
                      <td className="px-3 py-1.5 w-28">
                        <input type="number" value={s.temp} onChange={(e) => updateStep(s.id, { temp: e.target.value })}
                          className={toNumber(s.temp) == null || +s.temp < 0 || +s.temp > 100 ? INPUT_BAD_CLS : INPUT_CLS} placeholder="°C" />
                      </td>
                      <td className="px-3 py-1.5 w-24">
                        <input type="number" value={s.timeValue} onChange={(e) => updateStep(s.id, { timeValue: e.target.value })}
                          className={!(toNumber(s.timeValue) > 0) ? INPUT_BAD_CLS : INPUT_CLS} placeholder="time" />
                      </td>
                      <td className="px-3 py-1.5 w-20">
                        <select value={s.timeUnit} onChange={(e) => updateStep(s.id, { timeUnit: e.target.value })} className={INPUT_CLS}>
                          <option value="s">s</option>
                          <option value="min">min</option>
                        </select>
                      </td>
                      <td className="px-3 py-1.5 w-24">
                        <input type="number" value={s.cycles} onChange={(e) => updateStep(s.id, { cycles: e.target.value })}
                          className={!(toNumber(s.cycles) >= 1) ? INPUT_BAD_CLS : INPUT_CLS} placeholder="×" />
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex items-center justify-end gap-1">
                          <button type="button" onClick={() => moveStep(idx, -1)} className="text-slate-400 hover:text-blue-600 font-bold px-1">↑</button>
                          <button type="button" onClick={() => moveStep(idx, 1)} className="text-slate-400 hover:text-blue-600 font-bold px-1">↓</button>
                          <button type="button" onClick={() => removeStep(s.id)} className="text-red-400 hover:text-red-600 font-black px-1">×</button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mb-6">
        <SectionComment
          value={activeTest.pcrComment}
          onChange={(v) => updateActiveTest({ pcrComment: v })}
          placeholder="Notes about the thermal cycler run (annealing optimisations, touchdown, observed bands)..."
        />
      </div>

      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 mb-3">
          <h4 className="text-xs font-black text-slate-600 uppercase">
            🧪 Reaction Mix (volumes & final concentrations)
          </h4>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Target total volume (µL)</label>
              <input type="number" value={targetVol} onChange={(e) => updateActiveTest({ mixTargetVolume: e.target.value })}
                className={`${INPUT_CLS} w-32`} placeholder="e.g. 50" />
            </div>
            <button type="button" onClick={autoFillWater}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-2 rounded-lg text-xs shadow-sm">
              💧 Auto-fill Water to Target
            </button>
            <button type="button" onClick={addMixRow}
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-2 rounded-lg text-xs shadow-sm">
              + Add Component
            </button>
          </div>
        </div>

        <div className="overflow-x-auto custom-scrollbar border border-slate-200 rounded-lg bg-white">
          <table className="w-full text-sm min-w-[680px]">
            <thead className="text-xs text-slate-500 uppercase bg-slate-100">
              <tr>
                <th className="px-3 py-2 text-left border-b">Component</th>
                <th className="px-3 py-2 text-left border-b">Stock (conc./unit)</th>
                <th className="px-3 py-2 text-left border-b">Volume (µL)</th>
                <th className="px-3 py-2 text-left border-b">Final Conc. (auto)</th>
                <th className="px-3 py-2 text-left border-b">Notes</th>
                <th className="px-3 py-2 border-b w-12"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {mix.length === 0 ? (
                <tr><td colSpan="6" className="px-3 py-6 text-center text-slate-400 italic">
                  No components. Add your reaction mix.
                </td></tr>
              ) : (
                mix.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="px-3 py-1.5">
                      <input type="text" list="cloning-mix-components" value={row.name}
                        onChange={(e) => updateMixRow(row.id, { name: e.target.value })}
                        className={INPUT_CLS} placeholder="Component…" />
                    </td>
                    <td className="px-3 py-1.5 w-36">
                      <input type="text" value={row.stock} onChange={(e) => updateMixRow(row.id, { stock: e.target.value })}
                        className={INPUT_CLS} placeholder="e.g. 10 µM / 10X" />
                    </td>
                    <td className="px-3 py-1.5 w-28">
                      <input type="number" step="0.1" value={row.volume} onChange={(e) => updateMixRow(row.id, { volume: e.target.value })}
                        className={INPUT_CLS} placeholder="µL" />
                    </td>
                    <td className="px-3 py-1.5 text-xs font-bold text-blue-700 font-mono">
                      {finalConcOf(row)}
                    </td>
                    <td className="px-3 py-1.5">
                      <input type="text" value={row.note} onChange={(e) => updateMixRow(row.id, { note: e.target.value })}
                        className={INPUT_CLS} placeholder="Notes…" />
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <button type="button" onClick={() => removeMixRow(row.id)}
                        className="text-red-400 hover:text-red-600 font-black text-lg leading-none">×</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {mix.length > 0 && (
              <tfoot>
                <tr className="bg-slate-50 font-bold text-xs text-slate-600">
                  <td className="px-3 py-2 border-t" colSpan="2">TOTAL VOLUME</td>
                  <td className="px-3 py-2 border-t font-mono text-blue-700">{round(totalVol, 2)} µL</td>
                  <td className="px-3 py-2 border-t" colSpan="3">
                    {toNumber(targetVol) && Math.abs(totalVol - toNumber(targetVol)) > 0.01 ? (
                      <span className="text-amber-600">
                        ⚠️ differs from target ({targetVol} µL) by {round(totalVol - toNumber(targetVol), 2)} µL
                      </span>
                    ) : (
                      <span className="text-emerald-600">✓ matches target</span>
                    )}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <datalist id="cloning-mix-components">
          {MIX_COMPONENTS.map((c) => <option key={c} value={c} />)}
        </datalist>
      </div>

      <div className="mb-2">
        <SectionComment
          value={activeTest.reactionComment}
          onChange={(v) => updateActiveTest({ reactionComment: v })}
          placeholder="Notes about the reaction mix (volumes, final concentrations, storage)..."
        />
      </div>
    </div>
  );
};

export default CloningSetupSection;