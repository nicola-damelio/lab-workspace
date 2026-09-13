import React, {useMemo} from 'react';
import { ChartPanel, SharedChartStylePanel, SharedChart } from './SharedAnalysisTools';
import { CollapsibleSection } from './TestShellRenderer';
import {
  uid, toNumber, round, GAUSS, DS_DNA_HYPOCHROMICITY, DNA_BASE_EPS,
  analyzeDnaSequence, analyzeProteinSequence, absorbanceAt,
  INPUT_CLS
} from './cloningUtils';

const SIM_UV_MARGIN = { top: 8, right: 10, bottom: 30 };

/* Fully wired through SharedChart → SharedChartStylePanel: every
   "Graphical Parameters" command really modifies the simulated spectrum. */
const SimUvZoomChart = ({ data, cfg = {} }) => (
  <SharedChart
    data={data}
    xKey="wavelength"
    series={[{ key: 'absorbance', label: 'Absorbance', color: '#7c3aed' }]}
    cfg={cfg}
    unit="nm"
    margin={SIM_UV_MARGIN}
    yAxisWidth={50}
    height={300}
    yFormatter={(v) => Number(v).toFixed(4)}
    xFormatter={(l) => `${l} nm`}
    referenceLines={[
      { x: 260, color: '#3b82f6', label: '260' },
      { x: 280, color: '#ef4444', label: '280' }
    ]}
  />
);

/* ==========================================================================
   SIMULATIONS — DNA / PROTEIN UV SPECTRUM SIMULATOR
========================================================================== */
export const CloningSimulationsSection = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const sim = activeTest.sim || {};

  const molType = sim.molType || 'dsDNA';
  const sequence = sim.sequence || '';
  const concStr = sim.conc ?? '50';
  const concUnit = sim.concUnit || 'ng/µL';
  const pathMm = sim.pathLengthMm ?? '10';
  const noise = !!sim.noise;

  const setSim = (patch) => updateActiveTest({ sim: { ...sim, ...patch } });

  const props = useMemo(() => {
    if (molType === 'Protein') return analyzeProteinSequence(sequence);
    return analyzeDnaSequence(sequence, molType);
  }, [molType, sequence]);

  const concM = useMemo(() => {
    const v = toNumber(concStr);
    if (v == null || !props.mw) return null;
    if (concUnit === 'µM') return v * 1e-6;
    // ng/µL → g/L = v × 1e-3
    return (v * 1e-3) / props.mw;
  }, [concStr, concUnit, props.mw]);

  const data = useMemo(() => {
    if (!sequence.trim() || concM == null) return [];
    const l = (toNumber(pathMm) || 10) / 10; // mm → cm
    const out = [];
    const isProt = molType === 'Protein';
    const start = isProt ? 190 : 220;
    const end = isProt ? 350 : 320;

    for (let wl = start; wl <= end; wl += 1) {
      let eps = 0;
      if (isProt) {
        const nBonds = Math.max(0, props.length - 1);
        eps += nBonds * 3000 * GAUSS(wl, 205, 13);          // peptide bond
        eps += (props.counts.W || 0) * 5500 * GAUSS(wl, 280, 7);
        eps += (props.counts.Y || 0) * 1490 * GAUSS(wl, 274, 6);
        eps += (props.counts.F || 0) * 200 * GAUSS(wl, 257, 6);
        eps += Math.floor((props.counts.C || 0) / 2) * 125 * GAUSS(wl, 250, 8);
      } else {
        Object.entries(DNA_BASE_EPS).forEach(([base, cfg]) => {
          eps += (props.counts[base] || 0) * cfg.eps * GAUSS(wl, cfg.peak, cfg.sigma);
        });
        if (molType === 'dsDNA') eps *= DS_DNA_HYPOCHROMICITY;
      }
      let A = eps * concM * l;
      if (noise) A += (Math.random() - 0.5) * 0.004;
      out.push({ wavelength: wl, absorbance: Math.max(0, A) });
    }
    return out;
  }, [molType, sequence, concM, pathMm, noise, props]);

  const a260 = absorbanceAt(data, 260);
  const a280 = absorbanceAt(data, 280);
  const a230 = absorbanceAt(data, 230);
  const isProt = molType === 'Protein';
  const refEps = isProt ? props.eps280 : props.eps260;
  const refA = isProt ? a280 : a260;
  const pathCm = (toNumber(pathMm) || 10) / 10;
  const recoveredUM = refEps && refA != null ? (refA / (refEps * pathCm)) * 1e6 : null;

  const exportCsv = () => {
    if (!data.length) return;
    const csv = 'wavelength,absorbance\n' + data.map((d) => `${d.wavelength},${d.absorbance.toFixed(5)}`).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `simulated_${molType.replace(/\s/g, '_')}_spectrum.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 500);
  };

  const sendToUvTool = () => {
    if (!data.length) return;
    const uvSpectra = Array.isArray(activeTest.uvSpectra) ? activeTest.uvSpectra : [];
    updateActiveTest({
      uvSpectra: [
        ...uvSpectra,
        {
          id: uid('uv'),
          name: `Simulated ${molType} (${concStr} ${concUnit})`,
          pathLength: String(pathCm),
          epsMode: 'manual',
          epsilon: refEps ? String(Math.round(refEps)) : '',
          mw: props.mw ? String(Math.round(props.mw)) : '',
          seqType: isProt ? 'protein' : molType,
          sequence: '',
          points: data.map((d) => ({ wavelength: d.wavelength, absorbance: d.absorbance }))
        }
      ]
    });
    alert('Simulated spectrum added to Data → UV Spectra. You can now test the concentration tool on it.');
  };

  return (
    <CollapsibleSection title="Simulations — UV Spectra Simulator" icon="🧪" defaultOpen={false}>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* controls */}
        <div className="flex flex-col gap-3 bg-slate-50 border border-slate-200 rounded-xl p-4">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Molecule type</label>
            <select value={molType} onChange={(e) => setSim({ molType: e.target.value })} className={INPUT_CLS}>
              <option value="dsDNA">dsDNA</option>
              <option value="ssDNA">ssDNA</option>
              <option value="Protein">Protein</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Sequence</label>
            <textarea
              value={sequence}
              onChange={(e) => setSim({ sequence: e.target.value })}
              rows={6}
              className={`${INPUT_CLS} font-mono`}
              placeholder={isProt ? 'e.g. MTEYKLVVVGAGGVGK…' : 'e.g. ATGGCTGAC…'}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Concentration</label>
              <input type="number" value={concStr} onChange={(e) => setSim({ conc: e.target.value })} className={INPUT_CLS} />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Unit</label>
              <select value={concUnit} onChange={(e) => setSim({ concUnit: e.target.value })} className={INPUT_CLS}>
                <option value="ng/µL">ng/µL</option>
                <option value="µM">µM</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Path length (mm)</label>
              <input type="number" value={pathMm} onChange={(e) => setSim({ pathLengthMm: e.target.value })} className={INPUT_CLS} />
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 text-xs font-bold text-slate-600 cursor-pointer">
                <input type="checkbox" checked={noise} onChange={(e) => setSim({ noise: e.target.checked })} className="accent-blue-600" />
                Add instrumental noise
              </label>
            </div>
          </div>

          {sequence.trim() && (
            <div className="text-[11px] font-bold text-slate-600 bg-white border border-slate-200 rounded-lg p-2 flex flex-col gap-0.5">
              <span>Length: {props.length}</span>
              <span>MW: <span className="font-mono text-blue-700">{round(props.mw, 0)} Da</span></span>
              <span>
                ε{isProt ? '280' : '260'}: <span className="font-mono text-blue-700">{refEps ? Math.round(refEps).toLocaleString() : '—'} M⁻¹cm⁻¹</span>
              </span>
              <span>Input conc.: <span className="font-mono text-blue-700">{concM != null ? round(concM * 1e6, 3) : '—'} µM</span></span>
            </div>
          )}

          <div className="flex flex-col gap-2 mt-1">
            <button type="button" onClick={exportCsv} disabled={!data.length}
              className="bg-slate-800 hover:bg-slate-900 disabled:opacity-40 text-white font-bold py-2 rounded-lg text-xs shadow-sm">
              💾 Download Simulated CSV
            </button>
            <button type="button" onClick={sendToUvTool} disabled={!data.length}
              className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-bold py-2 rounded-lg text-xs shadow-sm">
              ➕ Add to Data → UV Spectra Tool
            </button>
          </div>
        </div>

        {/* chart + readouts */}
        <div className="lg:col-span-2">
          {data.length ? (
            <ChartPanel
              title={(sim.chartCfg && sim.chartCfg.title) || 'Simulated UV Spectrum'}
              icon="🧪"
              cfg={sim.chartCfg || {}}
              setCfg={(patch) => setSim({ chartCfg: { ...(sim.chartCfg || {}), ...patch } })}
              unit="Wavelength (nm)"
              cfgPanel={<SharedChartStylePanel cfg={sim.chartCfg || {}} setCfg={(patch) => setSim({ chartCfg: { ...(sim.chartCfg || {}), ...patch } })} unit="Wavelength (nm)" />}
            >
              <SimUvZoomChart data={data} cfg={sim.chartCfg || {}} />
            </ChartPanel>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-slate-400 italic text-sm bg-slate-50 rounded-lg border border-dashed border-slate-300">
              Enter a sequence and concentration to simulate the UV spectrum.
            </div>
          )}

          {data.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4">
              {[
                { label: isProt ? 'A280 (sim)' : 'A260 (sim)', value: refA != null ? refA.toFixed(3) : '—' },
                { label: 'A260/A280', value: a260 != null && a280 > 0 ? (a260 / a280).toFixed(2) : '—' },
                { label: 'A260/A230', value: a260 != null && a230 > 0 ? (a260 / a230).toFixed(2) : '—' },
                { label: 'Recovered conc. (µM)', value: recoveredUM != null ? round(recoveredUM, 3) : '—' },
                { label: 'Recovery', value: recoveredUM != null && concM ? `${round((recoveredUM / (concM * 1e6)) * 100, 1)} %` : '—' }
              ].map((cell) => (
                <div key={cell.label} className="text-center">
                  <div className="text-[10px] font-bold text-slate-500 uppercase mb-1">{cell.label}</div>
                  <div className="border border-violet-300 bg-violet-50 text-violet-700 rounded-lg p-2 text-sm font-mono font-bold">
                    {cell.value}
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="text-[10px] text-slate-400 italic mt-3">
            Simulation uses base-specific Gaussian bands (hypochromicity ×{DS_DNA_HYPOCHROMICITY} for dsDNA) and
            Beer–Lambert A = ε·c·l. For dsDNA this reproduces the rule A260 = 1 ≈ 50 µg/mL.
            Protein bands: peptide bond (205 nm), Trp (280), Tyr (274), Phe (257), cystine (250).
          </p>
        </div>
      </div>
    </CollapsibleSection>
  );
};

export default CloningSimulationsSection;
