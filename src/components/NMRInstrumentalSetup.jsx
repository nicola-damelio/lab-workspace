import React from 'react';

const makeNmrInstrumentalDatasetId = () =>
  `instrumental_dataset_${Date.now()}_${Math.random().toString(16).slice(2)}`;

const itemName = (item) => {
  if (!item) return '';
  if (typeof item === 'string') return item;
  return item.name || item.label || '';
};

const LABEL_CLS = 'text-[10px] font-bold text-slate-500 uppercase';
const INPUT_CLS =
  'border border-slate-300 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-500 bg-white';

export const NMRInstrumentalSetup = ({ ctx, extraFields = null, hideDatasets = false }) => {
  const {
    activeTest = {},
    updateActiveTest
  } = ctx || {};

  const instruments = Array.isArray(ctx?.nmrInstruments)
    ? ctx.nmrInstruments
    : [];

  const probes = Array.isArray(ctx?.nmrProbes)
    ? ctx.nmrProbes
    : [];

  const experiments = Array.isArray(ctx?.nmrExperiments)
    ? ctx.nmrExperiments
    : [];

  const datasets = Array.isArray(activeTest.instrumentalDatasets)
    ? activeTest.instrumentalDatasets
    : [];

  const update = (patch) => {
    if (typeof updateActiveTest === 'function') {
      updateActiveTest(patch);
    }
  };

  const nextExperimentNumber = () => {
    const nums = datasets
      .map((d) => parseInt(d.experimentNumber, 10))
      .filter((n) => Number.isFinite(n));

    return String(nums.length ? Math.max(...nums) + 1 : datasets.length + 1);
  };

  const addDataset = () => {
    const expNum = nextExperimentNumber();

    const nextDataset = {
      id: makeNmrInstrumentalDatasetId(),
      experimentNumber: expNum,
      name: `Dataset ${expNum}`,
      date: new Date().toISOString().split('T')[0],
      operator: activeTest.operator || '',
      link: '',
      comments: ''
    };

    update({
      instrumentalDatasets: [...datasets, nextDataset]
    });
  };

  const patchDataset = (id, patch) => {
    update({
      instrumentalDatasets: datasets.map((d) =>
        d.id === id ? { ...d, ...patch } : d
      )
    });
  };

  const removeDataset = (id) => {
    update({
      instrumentalDatasets: datasets.filter((d) => d.id !== id)
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="flex flex-col gap-1">
          <label className={LABEL_CLS}>Instrument</label>
          <select
            value={activeTest.instrument || ''}
            onChange={(e) => update({ instrument: e.target.value })}
            className={INPUT_CLS}
          >
            <option value="">—</option>
            {instruments.map((instrument) => {
              const name = itemName(instrument);
              return (
                <option key={instrument.id || name} value={name}>
                  {name}
                </option>
              );
            })}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className={LABEL_CLS}>Probe</label>
          <select
            value={activeTest.probe || ''}
            onChange={(e) => update({ probe: e.target.value })}
            className={INPUT_CLS}
          >
            <option value="">—</option>
            {probes.map((probe) => {
              const name = itemName(probe);
              return (
                <option key={probe.id || name} value={name}>
                  {name}
                </option>
              );
            })}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className={LABEL_CLS}>Pulse Program / Experiment</label>
          <select
            value={activeTest.pulseProgram || ''}
            onChange={(e) => update({ pulseProgram: e.target.value })}
            className={INPUT_CLS}
          >
            <option value="">—</option>
            {experiments.map((experiment) => {
              const name = itemName(experiment);
              return (
                <option key={experiment.id || name} value={name}>
                  {name}
                </option>
              );
            })}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className={LABEL_CLS}>Acquisition Date</label>
          <input
            type="date"
            value={activeTest.experimentDate || ''}
            onChange={(e) => update({ experimentDate: e.target.value })}
            className={INPUT_CLS}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className={LABEL_CLS}>Sample Tube</label>
          <input
            type="text"
            value={activeTest.sampleTube || ''}
            onChange={(e) => update({ sampleTube: e.target.value })}
            placeholder="e.g. 5 mm NMR tube"
            className={INPUT_CLS}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className={LABEL_CLS}>Lock Solvent</label>
          <input
            type="text"
            value={activeTest.lockSolvent || ''}
            onChange={(e) => update({ lockSolvent: e.target.value })}
            placeholder="e.g. D2O, CDCl3"
            className={INPUT_CLS}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className={LABEL_CLS}>Data Path / Link</label>
          <input
            type="text"
            value={activeTest.datasetLink || ''}
            onChange={(e) => update({ datasetLink: e.target.value })}
            placeholder="e.g. TopSpin path or Drive link"
            className={INPUT_CLS}
          />
        </div>
      </div>

      {!hideDatasets && (
      <div className="border border-slate-200 rounded-xl bg-slate-50 p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h4 className="text-sm font-bold text-slate-700">Datasets</h4>
            <p className="text-[10px] text-slate-400">
              Add instrumental datasets associated with this NMR condition.
            </p>
          </div>

          <button
            type="button"
            onClick={addDataset}
            disabled={typeof updateActiveTest !== 'function'}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold px-4 py-2 rounded-lg text-xs shadow-sm transition-colors"
          >
            + Add Dataset
          </button>
        </div>

        {datasets.length === 0 ? (
          <div className="text-xs text-slate-400 italic bg-white border border-dashed border-slate-300 rounded-lg p-4 text-center">
            No datasets added yet.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {datasets.map((ds) => (
              <div
                key={ds.id}
                className="border border-slate-200 rounded-lg bg-white p-3 flex flex-col gap-2 shadow-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-700 uppercase">
                    Dataset
                  </span>

                  <button
                    type="button"
                    onClick={() => removeDataset(ds.id)}
                    className="text-red-500 hover:text-red-700 font-black text-sm px-1"
                    title="Remove dataset"
                  >
                    ×
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <div className="flex flex-col gap-1">
                    <label className={LABEL_CLS}>Experiment Number</label>
                    <input
                      type="text"
                      value={ds.experimentNumber || ''}
                      onChange={(e) =>
                        patchDataset(ds.id, { experimentNumber: e.target.value })
                      }
                      className={INPUT_CLS}
                      placeholder="e.g. 1"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className={LABEL_CLS}>Dataset Name</label>
                    <input
                      type="text"
                      value={ds.name || ''}
                      onChange={(e) =>
                        patchDataset(ds.id, { name: e.target.value })
                      }
                      className={INPUT_CLS}
                      placeholder="e.g. Dataset 1"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className={LABEL_CLS}>Date</label>
                    <input
                      type="date"
                      value={ds.date || ''}
                      onChange={(e) =>
                        patchDataset(ds.id, { date: e.target.value })
                      }
                      className={INPUT_CLS}
                    />
                  </div>

                </div>

                <div className="flex flex-col gap-1">
                  <label className={LABEL_CLS}>Link / Path</label>
                  <input
                    type="text"
                    value={ds.link || ''}
                    onChange={(e) =>
                      patchDataset(ds.id, { link: e.target.value })
                    }
                    className={INPUT_CLS}
                    placeholder="e.g. Drive link, folder path, or dataset URL"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className={LABEL_CLS}>Comments</label>
                  <textarea
                    value={ds.comments || ''}
                    onChange={(e) =>
                      patchDataset(ds.id, { comments: e.target.value })
                    }
                    className={`${INPUT_CLS} h-16 custom-scrollbar`}
                    placeholder="Optional dataset notes"
                  />
                </div>

                <div className="border-t border-slate-100 pt-2 mt-1">
                  <span className="text-[10px] font-bold text-slate-500 uppercase">
                    Acquisition Parameters (from acqus)
                  </span>
                  <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-2 mt-1.5">
                    {[
                      ['NS', 'ns', 'Number of scans'],
                      ['DS', 'ds', 'Dummy scans'],
                      ['D1 (s)', 'd1', 'Relaxation delay'],
                      ['D8 (s)', 'd8', 'Delay D8'],
                      ['D6 (s)', 'd6', 'Delay D6'],
                      ['SW (ppm)', 'sw', 'Spectral width (ppm)'],
                      ['O1 (Hz)', 'o1', 'Carrier offset (Hz)'],
                      ['TD', 'td', 'Time domain points']
                    ].map(([lbl, k, tip]) => {
                      const acqus = ds.acqus || {};
                      return (
                        <div key={k} className="flex flex-col gap-1">
                          <label className={LABEL_CLS}>{lbl}</label>
                          <input
                            type="number"
                            step="any"
                            value={acqus[k] !== undefined && acqus[k] !== '' ? acqus[k] : ''}
                            onChange={(e) =>
                              patchDataset(ds.id, { acqus: { ...acqus, [k]: e.target.value } })
                            }
                            className={INPUT_CLS}
                            placeholder="—"
                            title={tip || `acqus ${k}`}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {extraFields}

      <p className="text-[10px] text-slate-400">
        NMR instrumental setup and datasets are saved per active condition.
      </p>
    </div>
  );
};

export default NMRInstrumentalSetup;
