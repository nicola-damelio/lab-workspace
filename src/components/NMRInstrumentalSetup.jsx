import React, { useState } from 'react';

/* ============================================================
   NMRInstrumentalSetup — Instrument, Probe, Pulse Program,
   dynamic acquisition parameters, and dataset rows.
   Works for both NMRTestRenderer and NMRFittingsTestRenderer.
   Props: ctx (with activeTest, updateActiveTest), nmrInstruments,
          nmrProbes, nmrExperiments (all from Definitions & Labels)
   ============================================================ */

const NUCLEUS_OPTIONS = ['1H', '13C', '15N', '31P', '19F', '2H'];
const cls = 'border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white outline-none focus:border-blue-500';
const lblCls = 'text-[10px] font-bold text-slate-600 uppercase tracking-wide';

const Field = ({ label, children, className = '' }) => (
  <div className={`flex flex-col gap-1 ${className}`}>
    <label className={lblCls}>{label}</label>
    {children}
  </div>
);

export const NMRInstrumentalSetup = ({ ctx }) => {
  const { activeTest: t, updateActiveTest: update } = ctx;
  const nmrInstruments = Array.isArray(ctx.nmrInstruments) ? ctx.nmrInstruments : [];
  const nmrProbes = Array.isArray(ctx.nmrProbes) ? ctx.nmrProbes : [];
  const nmrExperiments = Array.isArray(ctx.nmrExperiments) ? ctx.nmrExperiments : [];

  const selectedInstrument = nmrInstruments.find(i => i.name === t.nmrInstrumentName) || null;
  const availableProbes = selectedInstrument
    ? nmrProbes.filter(p => (selectedInstrument.availableProbes || []).includes(p.name))
    : nmrProbes;

  const selectedProbe = nmrProbes.find(p => p.name === t.nmrProbeName) || null;
  const selectedExp = nmrExperiments.find(e => e.name === t.nmrPulseProgram) || null;

  const dimCount = selectedExp
    ? (selectedExp.dimensions === '3D' ? 3 : selectedExp.dimensions === '2D' ? 2 : 1)
    : 1;

  const isSolid = selectedProbe?.state === 'solid';
  const isNoesy = selectedExp?.expType === 'NOESY';
  const isTocsy = selectedExp?.expType === 'TOCSY';

  const datasets = t.nmrDatasets || [];
  const addDataset = () => update({ nmrDatasets: [...datasets, { id: Date.now().toString(), name: '', expNo: '', link: '' }] });
  const updateDataset = (id, patch) => update({ nmrDatasets: datasets.map(d => d.id === id ? { ...d, ...patch } : d) });
  const removeDataset = (id) => update({ nmrDatasets: datasets.filter(d => d.id !== id) });

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Field label="Instrument">
          <select value={t.nmrInstrumentName || ''} onChange={e => update({ nmrInstrumentName: e.target.value, nmrFieldMHz: nmrInstruments.find(i => i.name === e.target.value)?.frequency || t.nmrFieldMHz })} className={cls}>
            <option value="">— Select instrument —</option>
            {[...nmrInstruments].sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(i => (
              <option key={i.id} value={i.name}>{i.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Field (MHz)">
          <input type="number" value={t.nmrFieldMHz || ''} onChange={e => update({ nmrFieldMHz: e.target.value })}
            className={cls} placeholder="e.g. 600" />
        </Field>
        <Field label="Probe">
          <select value={t.nmrProbeName || ''} onChange={e => update({ nmrProbeName: e.target.value })} className={cls}>
            <option value="">— Select probe —</option>
            {[...availableProbes].sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(p => (
              <option key={p.id} value={p.name}>{p.name} ({p.subtype}, {p.state})</option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Field label="Probe type (L/S)">
          <select value={t.nmrProbeType || selectedProbe?.state || 'liquid'} onChange={e => update({ nmrProbeType: e.target.value })} className={cls}>
            <option value="liquid">Liquid</option>
            <option value="solid">Solid</option>
          </select>
        </Field>
        <Field label="Probe subtype">
          <select value={t.nmrProbeSubtype || selectedProbe?.subtype || ''} onChange={e => update({ nmrProbeSubtype: e.target.value })} className={cls}>
            <option value="">—</option>
            {['TCI','TXI','HCN','BBO','BBF','QNP','CPTCI','CPTXO','MAS','HX','HXY'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        {isSolid && (
          <Field label="MAS Rate (kHz)">
            <input type="number" value={t.nmrMasRate || ''} onChange={e => update({ nmrMasRate: e.target.value })}
              className={cls} placeholder="e.g. 10" />
          </Field>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Field label="Pulse program">
          <select value={t.nmrPulseProgram || ''} onChange={e => update({ nmrPulseProgram: e.target.value })} className={cls}>
            <option value="">— Select or type —</option>
            {[...nmrExperiments].sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(e => (
              <option key={e.id} value={e.name}>{e.name} ({e.dimensions}, {e.expType})</option>
            ))}
          </select>
        </Field>
        <Field label="Or type pulse program">
          <input type="text" value={t.nmrPulseProgramFreeText || ''} onChange={e => update({ nmrPulseProgramFreeText: e.target.value })}
            className={cls} placeholder="e.g. hsqcetgpsi2" />
        </Field>
      </div>

      {(selectedExp || t.nmrPulseProgram) && (
        <div className="border-t border-slate-100 pt-4">
          <p className="text-[10px] font-black text-slate-500 uppercase mb-3">Acquisition Parameters</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: dimCount }).map((_, i) => (
              <Field key={i} label={i === 0 ? 'Nucleus (F2/direct)' : i === 1 ? 'Nucleus F1 (indirect)' : 'Nucleus F3'}>
                <select value={(t.nmrNuclei || [])[i] || NUCLEUS_OPTIONS[i === 0 ? 0 : 1]} onChange={e => {
                  const n = [...(t.nmrNuclei || ['1H', '13C', '15N'])]; n[i] = e.target.value;
                  update({ nmrNuclei: n });
                }} className={cls}>
                  {NUCLEUS_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </Field>
            ))}

            <Field label="TD (direct)">
              <input type="number" value={t.nmrTD || ''} onChange={e => update({ nmrTD: e.target.value })} className={cls} placeholder="e.g. 2048" />
            </Field>
            {dimCount >= 2 && (
              <Field label="TD1 (indirect)">
                <input type="number" value={t.nmrTD1 || ''} onChange={e => update({ nmrTD1: e.target.value })} className={cls} placeholder="e.g. 256" />
              </Field>
            )}
            {dimCount >= 3 && (
              <Field label="TD2 (third dim)">
                <input type="number" value={t.nmrTD2 || ''} onChange={e => update({ nmrTD2: e.target.value })} className={cls} placeholder="e.g. 64" />
              </Field>
            )}

            {isNoesy && (
              <Field label="NOESY mixing d8 (ms)">
                <input type="number" value={t.nmrNoesyD8 || ''} onChange={e => update({ nmrNoesyD8: e.target.value })} className={cls} placeholder="e.g. 100" />
              </Field>
            )}

            {isTocsy && (
              <Field label="TOCSY mixing d9 (ms)">
                <input type="number" value={t.nmrTocsyD9 || ''} onChange={e => update({ nmrTocsyD9: e.target.value })} className={cls} placeholder="e.g. 80" />
              </Field>
            )}

            {selectedExp?.param1Name && (
              <Field label={selectedExp.param1Name}>
                <input type="text" value={t.nmrCustomParam1 || ''} onChange={e => update({ nmrCustomParam1: e.target.value })} className={cls} />
              </Field>
            )}
            {selectedExp?.param2Name && (
              <Field label={selectedExp.param2Name}>
                <input type="text" value={t.nmrCustomParam2 || ''} onChange={e => update({ nmrCustomParam2: e.target.value })} className={cls} />
              </Field>
            )}
            {selectedExp?.param3Name && (
              <Field label={selectedExp.param3Name}>
                <input type="text" value={t.nmrCustomParam3 || ''} onChange={e => update({ nmrCustomParam3: e.target.value })} className={cls} />
              </Field>
            )}

            <Field label="Relaxation delay D1 (s)">
              <input type="number" value={t.nmrD1 || ''} onChange={e => update({ nmrD1: e.target.value })} className={cls} placeholder="e.g. 1.5" />
            </Field>

            <Field label="Number of Scans (NS)">
              <input type="number" value={t.nmrNS || ''} onChange={e => update({ nmrNS: e.target.value })} className={cls} placeholder="e.g. 16" />
            </Field>

            <Field label="Dummy Scans (DS)">
              <input type="number" value={t.nmrDS || ''} onChange={e => update({ nmrDS: e.target.value })} className={cls} placeholder="e.g. 4" />
            </Field>

            {isSolid && (
              <Field label="MAS Rate (kHz)">
                <input type="number" value={t.nmrMasRate || ''} onChange={e => update({ nmrMasRate: e.target.value })} className={cls} placeholder="e.g. 10" />
              </Field>
            )}
          </div>
        </div>
      )}

      <div className="border-t border-slate-100 pt-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-black text-slate-500 uppercase">Datasets</p>
          <button type="button" onClick={addDataset}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-1 rounded-lg text-xs transition-colors">
            + Add Dataset
          </button>
        </div>
        {datasets.length === 0 && <p className="text-xs text-slate-400 italic">No datasets added.</p>}
        {datasets.map(d => (
          <div key={d.id} className="flex gap-2 items-center mb-2 flex-wrap">
            <input type="text" value={d.name} onChange={e => updateDataset(d.id, { name: e.target.value })}
              placeholder="Dataset name..." className={`${cls} flex-1 min-w-[140px]`} />
            <input type="number" value={d.expNo} onChange={e => updateDataset(d.id, { expNo: e.target.value })}
              placeholder="Exp. #" className={`${cls} w-24`} />
            <input type="text" value={d.link} onChange={e => updateDataset(d.id, { link: e.target.value })}
              placeholder="Link (URL)..." className={`${cls} flex-1 min-w-[120px]`} />
            <button type="button" onClick={() => removeDataset(d.id)}
              className="text-slate-400 hover:text-red-500 font-bold px-2">×</button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default NMRInstrumentalSetup;
