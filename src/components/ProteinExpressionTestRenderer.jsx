import React, {useRef, useMemo} from 'react';
import {
LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
ResponsiveContainer, ReferenceArea
} from 'recharts';
import { ChartPanel, SharedChartStylePanel, useXZoom, useChartFsHeight } from './SharedAnalysisTools';
import TestShellRenderer, {
CollapsibleSection,
SmartImage
} from './TestShellRenderer';
import GelScheme, { gelSchemeToHtml } from './GelScheme';
import { PROTEIN_EXPRESSION_TAB_CONFIG } from './tabConfigs';

/* ============================================================================
CHROMATOGRAPHY METHOD DEFINITIONS
========================================================================== */
const CHROMATOGRAPHY_METHODS = [
'Affinity',
'His-Trap',
'GST',
'Ion Exchange',
'Gel Filtration'
];

const METHOD_BADGE = {
'Affinity': 'bg-blue-100 border-blue-300 text-blue-700',
'His-Trap': 'bg-teal-100 border-teal-300 text-teal-700',
'GST': 'bg-violet-100 border-violet-300 text-violet-700',
'Ion Exchange': 'bg-amber-100 border-amber-300 text-amber-700',
'Gel Filtration': 'bg-emerald-100 border-emerald-300 text-emerald-700'
};

const METHOD_STROKE = {
'Affinity': '#1e40af',
'His-Trap': '#0d9488',
'GST': '#7c3aed',
'Ion Exchange': '#d97706',
'Gel Filtration': '#059669'
};

const uid = (prefix) =>
`${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const parseChromatogram = (raw) => {
if (!raw) return [];
return String(raw)
.split('\n')
.map((line) => {
const parts = line.split(/[,\t; ]+/).filter(Boolean);
if (parts.length >= 2) {
const x = parseFloat(parts[0]);
const y = parseFloat(parts[1]);
if (!isNaN(x) && !isNaN(y)) return { volume: x, absorbance: y };
}
return null;
})
.filter(Boolean)
.sort((a, b) => a.volume - b.volume);
};

/* ============================================================================
COMMENT BOX — reusable comment field for each subsection
========================================================================== */
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

const CHROMA_MARGIN = { top: 10, right: 10, bottom: 35, left: 50 };
const ChromaZoomChart = ({ data, stroke, cfg = {} }) => {
  const chartRef = useRef(null);
  const xs = data.map(p => p.volume);
  const dataDomain = xs.length > 1 ? [Math.min(...xs), Math.max(...xs)] : [0, 1];
  const zoom = useXZoom(chartRef, dataDomain, CHROMA_MARGIN);
  const fs = Number(cfg.fontSize) || 11;
  const dash = cfg.lineStyle === 'dashed' ? '4 4' : cfg.lineStyle === 'dotted' ? '1 3' : undefined;
  const dot = cfg.pointStyle && cfg.pointStyle !== 'none' ? { r: Number(cfg.ptSize) || 4, fill: stroke, strokeWidth: 0 } : false;
  const height = useChartFsHeight(Number(cfg.height) || 230);
  return (
    <div className="flex flex-col gap-1">
      <div ref={chartRef} onMouseDown={zoom.onMouseDown} className="select-none" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={CHROMA_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="volume" type="number" domain={[zoom.domain[0], zoom.domain[1]]} allowDataOverflow
              tick={{ fontSize: fs, fill: '#64748b' }}
              label={{ value: cfg.xAxisLabel || 'Elution Volume (mL)', position: 'insideBottom', offset: -15, fontSize: fs, fill: '#64748b' }} />
            <YAxis tick={{ fontSize: fs, fill: '#64748b' }}
              label={cfg.yAxisLabel ? { value: cfg.yAxisLabel, angle: -90, position: 'insideLeft', fontSize: fs, fill: '#64748b' } : { value: 'Absorbance', angle: -90, position: 'insideLeft', fontSize: fs, fill: '#64748b' }} />
            <Tooltip formatter={(v) => Number(v).toFixed(2)} labelFormatter={(l) => `${l} mL`} />
            <Line type="monotone" dataKey="absorbance" stroke={stroke} strokeWidth={Number(cfg.lineThickness) || 2} strokeDasharray={dash} dot={dot} isAnimationActive={false} />
            {zoom.refLo !== null && zoom.refHi !== null && <ReferenceArea x1={zoom.refLo} x2={zoom.refHi} strokeOpacity={0.3} fill="#cbd5e1" />}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {zoom.isZoomed && (
        <button type="button" onClick={zoom.reset} className="self-end text-[10px] bg-slate-200 hover:bg-slate-300 text-slate-700 px-2 py-1 rounded font-bold">Reset Zoom</button>
      )}
    </div>
  );
};

/* ============================================================================
CHROMATOGRAM CARD (one card = one run, method is mandatory)
========================================================================== */
const ChromatogramCard = ({ chr, index, onChange, onRemove }) => {
const chartData = useMemo(() => parseChromatogram(chr.rawData), [chr.rawData]);
const stroke = METHOD_STROKE[chr.method] || '#1e40af';

return (
<div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
  {/* header */}
  <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
    <div className="flex items-center gap-2">
      <span className="text-xs font-black text-slate-500">
        📈 Chromatogram {index + 1}
      </span>
      <span
        className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
          METHOD_BADGE[chr.method] || 'bg-slate-100 border-slate-300 text-slate-600'
        }`}
      >
        {chr.method}
      </span>
    </div>
    <button
      type="button"
      onClick={onRemove}
      className="bg-red-50 hover:bg-red-100 text-red-500 font-bold px-3 py-1.5 rounded text-xs border border-red-200"
    >
      🗑 Remove
    </button>
  </div>

  {/* parameters */}
  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
    <div>
      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
        Name / Run ID
      </label>
      <input
        type="text"
        value={chr.name}
        onChange={(e) => onChange({ name: e.target.value })}
        className="w-full border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500"
        placeholder="e.g. Ni-NTA elution pool"
      />
    </div>
    <div>
      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
        Method type *
      </label>
      <select
        value={chr.method}
        onChange={(e) => onChange({ method: e.target.value })}
        className="w-full border border-slate-300 rounded-lg p-2 text-sm bg-white outline-none focus:border-blue-500 font-semibold"
      >
        {CHROMATOGRAPHY_METHODS.map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>
    </div>
    <div>
      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
        Running Buffer
      </label>
      <input
        type="text"
        value={chr.buffer}
        onChange={(e) => onChange({ buffer: e.target.value })}
        className="w-full border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500"
        placeholder="e.g. 50 mM NaPi, 300 mM NaCl"
      />
    </div>
  </div>

  {/* data + chart */}
  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
    <div className="flex flex-col gap-2">
      <label className="block text-[10px] font-bold text-slate-500 uppercase">
        Paste Data (Volume vs Absorbance)
      </label>
      <textarea
        value={chr.rawData}
        onChange={(e) => onChange({ rawData: e.target.value })}
        className="w-full h-48 border border-slate-300 rounded-lg p-3 font-mono text-xs outline-none focus:border-blue-500 shadow-inner resize-y"
        placeholder={'Two columns (Volume mL, Absorbance mAU)\nseparated by tabs, commas or spaces.'}
      />
      <p className="text-[10px] text-slate-400">Data points: {chartData.length}</p>
    </div>
    <div className="lg:col-span-2">
      {chartData.length > 0 ? (
        <ChartPanel
          title={(chr.chartCfg && chr.chartCfg.title) || `Elution Profile${chr.method ? ` — ${chr.method}` : ''}`}
          icon="📈"
          cfgPanel={<SharedChartStylePanel cfg={chr.chartCfg || {}} setCfg={(patch) => onChange({ chartCfg: { ...(chr.chartCfg || {}), ...patch } })} unit="Elution Volume (mL)" />}
        >
          <ChromaZoomChart data={chartData} stroke={stroke} cfg={chr.chartCfg || {}} />
        </ChartPanel>
      ) : (
        <div className="flex h-full items-center justify-center text-slate-400 italic text-sm bg-slate-50 rounded-xl border border-slate-200 min-h-[280px]">
          Paste data to view the chromatogram.
        </div>
      )}
    </div>
  </div>
</div>
);
};

/* ============================================================================
DATA SECTION — YIELD, MULTIPLE CHROMATOGRAMS & SDS-PAGE
(Each subsection now has a comment field)
========================================================================== */
const ProteinDataSection = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const yieldData = Array.isArray(activeTest.yieldData) ? activeTest.yieldData : [];
  const gelImages = Array.isArray(activeTest.gelImages) ? activeTest.gelImages : [];
  const gelImageInputRef = useRef(null);

  /* -------- chromatograms (multi-run, with legacy migration) -------- */
  const chromatograms = Array.isArray(activeTest.chromatograms)
    ? activeTest.chromatograms
    : activeTest.chromatogramRaw
      ? [
          {
            id: 'chr_legacy',
            name: 'Chromatogram 1',
            method: 'Affinity',
            buffer: '',
            rawData: activeTest.chromatogramRaw
          }
        ]
      : [];

  const setChromatograms = (next) =>
    updateActiveTest({ chromatograms: next, chromatogramRaw: '' });

  const addChromatogram = () =>
    setChromatograms([
      ...chromatograms,
      {
        id: uid('chr'),
        name: `Chromatogram ${chromatograms.length + 1}`,
        method: 'Affinity',
        buffer: '',
        rawData: ''
      }
    ]);

  const updateChromatogram = (id, patch) =>
    setChromatograms(chromatograms.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const removeChromatogram = (id) =>
    setChromatograms(chromatograms.filter((c) => c.id !== id));

  /* -------- yield management -------- */
  const addYieldRow = () => {
    const newRow = {
      id: uid('yield'),
      fraction: '',
      concentration: '',
      volume: '',
      totalMass: '',
      purity: '',
      notes: ''
    };
    updateActiveTest({ yieldData: [...yieldData, newRow] });
  };

  const updateYieldRow = (id, field, value) => {
    updateActiveTest({
      yieldData: yieldData.map((row) => {
        if (row.id === id) {
          const updated = { ...row, [field]: value };
          if (field === 'concentration' || field === 'volume') {
            const c = parseFloat(updated.concentration) || 0;
            const v = parseFloat(updated.volume) || 0;
            updated.totalMass = (c * v).toFixed(2);
          }
          return updated;
        }
        return row;
      })
    });
  };

  /* -------- gel images -------- */
  const importGelImages = async (fileList) => {
    const files = Array.from(fileList || []).filter(
      (f) => f && f.type && f.type.startsWith('image/')
    );
    if (!files.length) return;
    try {
      const imported = await Promise.all(
        files.map(
          (file) =>
            new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.onerror = reject;
              reader.readAsDataURL(file);
            })
        )
      );
      updateActiveTest({ gelImages: [...gelImages, ...imported] });
    } catch (error) {
      console.error(error);
      alert('Gel image import failed.');
    }
  };

  const addGelImageLinks = () => {
    const urlsText = prompt('Paste external link(s) for gel images, separated by commas:');
    if (!urlsText || !urlsText.trim()) return;
    const urls = urlsText.split(/[\s,]+/).map((u) => u.trim()).filter(Boolean);
    updateActiveTest({ gelImages: [...gelImages, ...urls] });
  };

  return (
    <div className="flex flex-col gap-6">
      {/* ============ 1. PROTEIN YIELD ============ */}
      <CollapsibleSection title="Protein Yield (BCA / Bradford / UV)" icon="💧" defaultOpen={false}>
        <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-xs font-bold text-slate-600 uppercase">Purified Fractions</h3>
            <button
              type="button"
              onClick={addYieldRow}
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs shadow-sm transition-colors"
            >
              + Add Fraction
            </button>
          </div>
          <div className="overflow-x-auto custom-scrollbar border border-slate-200 rounded-lg">
            <table className="w-full text-sm text-left min-w-[720px]">
              <thead className="text-xs text-slate-500 uppercase bg-slate-100">
                <tr>
                  <th className="px-3 py-2 border-b">Fraction / Pool</th>
                  <th className="px-3 py-2 border-b">Conc (mg/mL)</th>
                  <th className="px-3 py-2 border-b">Volume (mL)</th>
                  <th className="px-3 py-2 border-b">Total Yield (mg)</th>
                  <th className="px-3 py-2 border-b">Purity %</th>
                  <th className="px-3 py-2 border-b">Notes</th>
                  <th className="px-3 py-2 border-b w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {yieldData.length === 0 ? (
                  <tr>
                    <td colSpan="7" className="px-3 py-4 text-center text-slate-400 italic">
                      No fractions added.
                    </td>
                  </tr>
                ) : (
                  yieldData.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="px-3 py-1.5">
                        <input
                          type="text"
                          value={row.fraction}
                          onChange={(e) => updateYieldRow(row.id, 'fraction', e.target.value)}
                          className="w-full border border-slate-300 rounded px-2 py-1 text-sm outline-none focus:border-blue-500"
                          placeholder="e.g. Elution 1"
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          type="number"
                          value={row.concentration}
                          onChange={(e) => updateYieldRow(row.id, 'concentration', e.target.value)}
                          className="w-full border border-slate-300 rounded px-2 py-1 text-sm outline-none focus:border-blue-500"
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          type="number"
                          value={row.volume}
                          onChange={(e) => updateYieldRow(row.id, 'volume', e.target.value)}
                          className="w-full border border-slate-300 rounded px-2 py-1 text-sm outline-none focus:border-blue-500"
                        />
                      </td>
                      <td className="px-3 py-1.5 font-bold text-blue-700 font-mono">
                        {row.totalMass || '—'}
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          type="number"
                          step="0.1"
                          value={row.purity}
                          onChange={(e) => updateYieldRow(row.id, 'purity', e.target.value)}
                          className="w-full border border-slate-300 rounded px-2 py-1 text-sm outline-none focus:border-blue-500"
                          placeholder="e.g. 95"
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          type="text"
                          value={row.notes}
                          onChange={(e) => updateYieldRow(row.id, 'notes', e.target.value)}
                          className="w-full border border-slate-300 rounded px-2 py-1 text-sm outline-none focus:border-blue-500"
                          placeholder="Notes..."
                        />
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        <button
                          type="button"
                          onClick={() =>
                            updateActiveTest({ yieldData: yieldData.filter((r) => r.id !== row.id) })
                          }
                          className="text-red-400 hover:text-red-600 font-bold"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <SectionComment
            value={activeTest.yieldComment}
            onChange={(v) => updateActiveTest({ yieldComment: v })}
            placeholder="Notes about yield measurements, BCA/Bradford results, observations..."
          />
        </div>
      </CollapsibleSection>

      {/* ============ 2. CHROMATOGRAMS ============ */}
      <CollapsibleSection title="Chromatograms (FPLC / AKTA)" icon="📈" defaultOpen={false}>
        <div className="flex flex-col gap-4">
          <div className="flex justify-between items-center flex-wrap gap-2">
            <p className="text-xs text-slate-500">
              Add one chromatogram per purification step and select the method type
              (Ion Exchange, Affinity, His-Trap, GST, Gel Filtration).
            </p>
            <button
              type="button"
              onClick={addChromatogram}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-4 py-2 rounded-lg text-xs shadow-sm"
            >
              + Add Chromatogram
            </button>
          </div>
          {chromatograms.length === 0 ? (
            <div className="text-center py-8 text-slate-400 italic bg-slate-50 rounded-lg border border-dashed border-slate-300 text-sm">
              No chromatograms recorded. Add your first run above.
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {chromatograms.map((chr, idx) => (
                <ChromatogramCard
                  key={chr.id}
                  chr={chr}
                  index={idx}
                  onChange={(patch) => updateChromatogram(chr.id, patch)}
                  onRemove={() => removeChromatogram(chr.id)}
                />
              ))}
            </div>
          )}

          <SectionComment
            value={activeTest.chromatogramComment}
            onChange={(v) => updateActiveTest({ chromatogramComment: v })}
            placeholder="Notes about purification runs, column behavior, peak observations..."
          />
        </div>
      </CollapsibleSection>

      {/* ============ 3. SDS-PAGE GELS ============ */}
      <CollapsibleSection title="SDS-PAGE Gels & Blots" icon="🖼️" defaultOpen={false}>
        <div className="border border-slate-200 bg-slate-50 rounded-lg p-4">
          <div className="mb-5">
            <GelScheme
              ctx={ctx}
              bandKind="protein"
              title="SDS-PAGE gel scheme"
              subtitle="Scheme of the SDS-PAGE gel — click a well and add compounds from Definitions & Labels to show which sample is loaded in each lane."
            />
          </div>
          <input
            ref={gelImageInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              importGelImages(e.target.files);
              e.target.value = '';
            }}
          />
          <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
            <label className="text-xs font-bold text-slate-600 uppercase">Gel Images</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => gelImageInputRef.current?.click()}
                className="bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 font-bold px-3 py-1.5 rounded text-xs shadow-sm"
              >
                📁 Upload Images
              </button>
              <button
                type="button"
                onClick={addGelImageLinks}
                className="bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-600 font-bold px-3 py-1.5 rounded text-xs shadow-sm"
              >
                🔗 Add Links
              </button>
            </div>
          </div>
          {gelImages.length === 0 ? (
            <p className="text-xs text-slate-400 italic">No gel images attached.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-4">
              {gelImages.map((imgSrc, idx) => (
                <div
                  key={idx}
                  className="relative group bg-white p-3 rounded-xl border border-slate-200 shadow-sm"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-slate-500">Gel {idx + 1}</span>
                    <button
                      type="button"
                      onClick={() =>
                        updateActiveTest({ gelImages: gelImages.filter((_, i) => i !== idx) })
                      }
                      className="bg-red-50 hover:bg-red-100 text-red-500 rounded-full w-6 h-6 flex items-center justify-center text-sm font-bold border border-red-200"
                    >
                      ×
                    </button>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-2 border border-slate-100">
                    <SmartImage
                      src={imgSrc}
                      alt={`Gel image ${idx + 1}`}
                      style={{ maxHeight: '260px', minHeight: '120px' }}
                    />
                  </div>
                  {!String(imgSrc).startsWith('data:') && (
                    <a
                      href={imgSrc}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 text-xs text-blue-500 hover:text-blue-700 font-medium flex items-center gap-1"
                    >
                      🔗 Open original
                    </a>
                  )}
                  <input
                    type="text"
                    value={((activeTest.gelCaptions || [])[idx]) || ''}
                    onChange={(e) => {
                      const caps = (activeTest.gelCaptions || []).slice();
                      caps[idx] = e.target.value;
                      updateActiveTest({ gelCaptions: caps });
                    }}
                    placeholder={`Caption for gel ${idx + 1}...`}
                    className="mt-2 w-full border border-slate-200 rounded px-2 py-1 text-xs outline-none focus:border-blue-500"
                  />
                </div>
              ))}
            </div>
          )}

          <SectionComment
            value={activeTest.gelComment}
            onChange={(v) => updateActiveTest({ gelComment: v })}
            placeholder="Notes about gel results, band patterns, molecular weight markers..."
          />
        </div>
      </CollapsibleSection>
    </div>
  );
};

/* ============================================================================
NOTEBOOK EXPORT
========================================================================== */
const buildProteinNotebookHtml = (checked, ctx) => {
const t = ctx.activeTest || {};
const operatorNames = (Array.isArray(t.operators) ? t.operators : [])
.map((op) =>
typeof op === 'string' ? op : `${op?.name || ''} ${op?.surname || ''}`.trim()
)
.filter(Boolean)
.join(', ');

const samples =
Array.isArray(ctx.selectedCompounds) && ctx.selectedCompounds.length
? ctx.selectedCompounds.join(', ')
: 'N/A';

const hosts =
Array.isArray(ctx.cellLines) && ctx.cellLines.length
? ctx.cellLines.join(', ')
: 'N/A';

let html = '';

if (checked.cond) {
html += `<p style="font-size: 12px; color: #475569; margin-bottom: 8px;"> <b>Experiment Type:</b> ${t.testCategory || 'N/A'} | <b>Operator(s):</b> ${operatorNames || 'N/A'} | <b>Construct:</b> ${samples} | <b>Host:</b> ${hosts} </p> <p style="font-size: 12px; color: #475569; margin-bottom: 8px;"> <b>Culture:</b> ${t.cultureVolume || '—'} in ${t.medium || '—'} (${t.antibiotic || '—'}) | <b>Induction:</b> ${t.inductionMethod || '—'} ${t.iptgConcentration ? `(${t.iptgConcentration})` : ''} at OD ${t.inductionOD || '—'}, ${t.inductionTemp || '—'} for ${t.inductionDuration || '—'} (harvest OD ${t.harvestOD || '—'}) | <b>Lysis:</b> ${t.lysisMethod || '—'} in ${t.lysisBuffer || '—'} ${t.proteaseInhibitors ? `(+inhibitors: ${t.proteaseInhibitors})` : ''} </p> <p style="font-size: 12px; color: #475569; margin-bottom: 8px;"> <b>Tag:</b> ${t.proteinTag || '—'} | <b>Protease:</b> ${t.cleavageProtease || '—'} | <b>Column:</b> ${t.columnType || '—'} | <b>Elution:</b> ${t.elutionConditions || '—'} | <b>Storage buffer:</b> ${t.storageBuffer || '—'} </p>`;
}

if (checked.yield && Array.isArray(t.yieldData) && t.yieldData.length > 0) {
html += `<h4 style="font-size: 12px; color: #334155; margin-bottom: 4px; border-bottom: 1px solid #cbd5e1; padding-bottom: 2px;">Purification Yield</h4> <table style="width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 11px; text-align: left; background: white;"> <tr style="background-color: #f1f5f9;"> <th style="padding: 6px; border: 1px solid #cbd5e1;">Fraction</th> <th style="padding: 6px; border: 1px solid #cbd5e1;">Conc (mg/mL)</th> <th style="padding: 6px; border: 1px solid #cbd5e1;">Vol (mL)</th> <th style="padding: 6px; border: 1px solid #cbd5e1;">Total (mg)</th> <th style="padding: 6px; border: 1px solid #cbd5e1;">Purity %</th> <th style="padding: 6px; border: 1px solid #cbd5e1;">Notes</th> </tr>`;

t.yieldData.forEach((row) => {
html += `<tr> <td style="padding: 6px; border: 1px solid #e2e8f0;"><b>${row.fraction || '—'}</b></td> <td style="padding: 6px; border: 1px solid #e2e8f0;">${row.concentration || '—'}</td> <td style="padding: 6px; border: 1px solid #e2e8f0;">${row.volume || '—'}</td> <td style="padding: 6px; border: 1px solid #e2e8f0; color: #1d4ed8;"><b>${row.totalMass || '—'}</b></td> <td style="padding: 6px; border: 1px solid #e2e8f0;">${row.purity || '—'}</td> <td style="padding: 6px; border: 1px solid #e2e8f0;">${row.notes || '—'}</td> </tr>`;
});

html += `</table>`;

if (t.yieldComment) {
html += `<p style="font-size: 11px; color: #64748b; font-style: italic; margin-bottom: 8px;">📝 ${t.yieldComment}</p>`;
}
}

if (checked.chromatogram) {
const chromatograms = Array.isArray(t.chromatograms)
? t.chromatograms
: t.chromatogramRaw
? [{ id: 'chr_legacy', name: 'Chromatogram 1', method: 'Affinity', buffer: '', rawData: t.chromatogramRaw }]
: [];

if (chromatograms.length > 0) {
html += `<h4 style="font-size: 12px; color: #334155; margin-bottom: 4px; border-bottom: 1px solid #cbd5e1; padding-bottom: 2px;">Chromatograms</h4> <table style="width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 11px; text-align: left; background: white;"> <tr style="background-color: #f1f5f9;"> <th style="padding: 6px; border: 1px solid #cbd5e1;">Run</th> <th style="padding: 6px; border: 1px solid #cbd5e1;">Method</th> <th style="padding: 6px; border: 1px solid #cbd5e1;">Buffer</th> <th style="padding: 6px; border: 1px solid #cbd5e1;">Data points</th> </tr>`;

chromatograms.forEach((chr) => {
const nPoints = parseChromatogram(chr.rawData).length;
html += `<tr> <td style="padding: 6px; border: 1px solid #e2e8f0;"><b>${chr.name || '—'}</b></td> <td style="padding: 6px; border: 1px solid #e2e8f0;">${chr.method || '—'}</td> <td style="padding: 6px; border: 1px solid #e2e8f0;">${chr.buffer || '—'}</td> <td style="padding: 6px; border: 1px solid #e2e8f0;">${nPoints}</td> </tr>`;
});

html += `</table>`;

if (t.chromatogramComment) {
html += `<p style="font-size: 11px; color: #64748b; font-style: italic; margin-bottom: 8px;">📝 ${t.chromatogramComment}</p>`;
}
}
}

if (checked.gels) {
const schemeHtml = gelSchemeToHtml(t.gelScheme, ctx, 'protein');
if (schemeHtml) {
html += `<h4 style="font-size: 12px; color: #334155; margin-bottom: 4px;">🧪 SDS-PAGE Gel Scheme</h4>${schemeHtml}`;
}

if (Array.isArray(t.gelImages) && t.gelImages.length > 0) {
html += `<p style="font-size: 11px; color: #64748b;">${t.gelImages.length} SDS-PAGE gel image(s) attached.</p>`;

if (t.gelComment) {
html += `<p style="font-size: 11px; color: #64748b; font-style: italic;">📝 ${t.gelComment}</p>`;
}
}
}

return html;
};

/* ============================================================================
INSTRUMENTAL SETUP — chromatographic parameters for the purification run
========================================================================== */
const ProteinInstrumentalSetup = ({ ctx }) => {
  const { activeTest = {}, updateActiveTest } = ctx || {};
  const LABEL_CLS = 'text-[10px] font-bold text-slate-500 uppercase';
  const INPUT_CLS = 'border border-slate-300 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-500 bg-white';
  const t = activeTest;
  const set = (patch) => { if (updateActiveTest) updateActiveTest(patch); };
  const fields = [
    { key: 'chromaColumn', label: 'Column / Resin', ph: 'e.g. HisTrap HP 1 mL (Ni-NTA)' },
    { key: 'chromaFlowRate', label: 'Flow rate (mL/min)', ph: 'e.g. 1.0' },
    { key: 'chromaFractionVol', label: 'Sample collection volume (mL)', ph: 'e.g. 1.0' },
    { key: 'chromaEquilibration', label: 'Equilibration volume (CV)', ph: 'e.g. 10' },
    { key: 'chromaWashBuffer', label: 'Wash buffer', ph: 'e.g. 50 mM NaPi, 300 mM NaCl, 20 mM imidazole' },
    { key: 'chromaElution', label: 'Elution (buffer / gradient)', ph: 'e.g. linear 20→500 mM imidazole over 20 CV' },
    { key: 'chromaDetection', label: 'Detection wavelength (nm)', ph: 'e.g. 280' },
    { key: 'chromaColumnTemp', label: 'Column temperature (°C)', ph: 'e.g. 4' },
    { key: 'chromaMaxPressure', label: 'Max pressure (MPa)', ph: 'e.g. 0.3' }
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {fields.map((f) => (
          <div key={f.key} className="flex flex-col gap-1">
            <label className={LABEL_CLS}>{f.label}</label>
            <input type="text" value={t[f.key] || ''} onChange={(e) => set({ [f.key]: e.target.value })} placeholder={f.ph} className={INPUT_CLS} />
          </div>
        ))}
      </div>
      <p className="text-[10px] text-slate-400">
        Typical parameters of a chromatographic purification run (ÄKTA / FPLC / gravity column).
      </p>
    </div>
  );
};

/* ============================================================================
MAIN RENDERER
========================================================================== */
export const ProteinExpressionTestRenderer = (props) => {
const appCategories =
Array.isArray(props.testCategories) && props.testCategories.length
? props.testCategories
: PROTEIN_EXPRESSION_TAB_CONFIG.fallbackCategories;

const config = {
...PROTEIN_EXPRESSION_TAB_CONFIG,
categories: appCategories
};

return (
<TestShellRenderer
{...props}
config={config}
custom={{
Data: ProteinDataSection,
InstrumentalSetup: ProteinInstrumentalSetup,
buildNotebookHtml: buildProteinNotebookHtml
}}
testCategories={appCategories}
operators={Array.isArray(props.operators) ? props.operators : []}
/>
);
};

export default ProteinExpressionTestRenderer;