import React, {useRef} from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceArea
} from 'recharts';
import {useXZoom} from './SharedAnalysisTools';
import { CollapsibleSection, SmartImage } from './TestShellRenderer';
import {uid, round, parseSpectrumText, analyzeSpectrum, effectiveSpectrumProps, INPUT_CLS} from './cloningUtils';

const UV_CHART_MARGIN = { top: 8, right: 10, bottom: 30, left: 40 };

const UvZoomChart = ({ pts }) => {
  const chartRef = useRef(null);
  const wavelengths = pts.map(p => p.wavelength);
  const dataDomain = wavelengths.length > 1 ? [Math.min(...wavelengths), Math.max(...wavelengths)] : [220, 320];
  const zoom = useXZoom(chartRef, dataDomain, UV_CHART_MARGIN);
  return (
    <div className="flex flex-col gap-1">
      <div ref={chartRef} onMouseDown={zoom.onMouseDown} className="select-none" style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={pts} margin={UV_CHART_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="wavelength" type="number" domain={[zoom.domain[0], zoom.domain[1]]} allowDataOverflow
              tick={{ fontSize: 11, fill: '#64748b' }}
              label={{ value: 'Wavelength (nm)', position: 'insideBottom', offset: -15, fontSize: 11, fill: '#64748b' }} />
            <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
            <Tooltip formatter={(v) => Number(v).toFixed(4)} labelFormatter={(l) => `${l} nm`} />
            <ReferenceLine x={260} stroke="#3b82f6" strokeDasharray="4 4" />
            <ReferenceLine x={280} stroke="#ef4444" strokeDasharray="4 4" />
            <Line type="monotone" dataKey="absorbance" stroke="#1e40af" strokeWidth={2} dot={false} isAnimationActive={false} />
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

/* ==========================================================================
   UV SPECTRUM CARD
========================================================================== */
const UvSpectrumCard = ({ spec, onChange, onRemove, onSendToQuant }) => {
  const an = analyzeSpectrum(spec);
  const seqProps = effectiveSpectrumProps(spec);
  const isProtein = spec.seqType === 'protein';

  const ratioCls = (val, lo, hi) =>
    val == null
      ? 'bg-white border-slate-300 text-slate-400'
      : val >= lo && val <= hi
      ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
      : 'bg-amber-50 border-amber-300 text-amber-700';

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <div className="flex justify-between items-center mb-3 gap-2 flex-wrap">
        <input
          type="text"
          value={spec.name}
          onChange={(e) => onChange({ name: e.target.value })}
          className="font-bold text-slate-800 bg-transparent border-none outline-none focus:ring-1 focus:ring-blue-400 rounded px-1 flex-1 min-w-[160px]"
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onSendToQuant}
            disabled={!an}
            className="bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 font-bold px-3 py-1.5 rounded text-xs shadow-sm disabled:opacity-40"
          >
            ➕ Send to Quantification Table
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="bg-red-50 hover:bg-red-100 text-red-500 font-bold px-3 py-1.5 rounded text-xs border border-red-200"
          >
            🗑 Remove
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* parameters */}
        <div className="flex flex-col gap-3 bg-slate-50 border border-slate-200 rounded-lg p-3">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
              Path length (cm)
            </label>
            <input
              type="number"
              step="0.1"
              value={spec.pathLength}
              onChange={(e) => onChange({ pathLength: e.target.value })}
              className={INPUT_CLS}
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
              Extinction coefficient ε (M⁻¹cm⁻¹)
            </label>
            <div className="flex gap-2 mb-2">
              {['manual', 'sequence'].map((mode) => (
                <label key={mode} className="flex items-center gap-1 text-xs font-bold text-slate-600 cursor-pointer">
                  <input
                    type="radio"
                    checked={(spec.epsMode || 'manual') === mode}
                    onChange={() => onChange({ epsMode: mode })}
                    className="accent-blue-600"
                  />
                  {mode === 'manual' ? 'Manual' : 'From sequence'}
                </label>
              ))}
            </div>

            {(spec.epsMode || 'manual') === 'manual' ? (
              <div className="flex flex-col gap-2">
                <input
                  type="number"
                  value={spec.epsilon}
                  onChange={(e) => onChange({ epsilon: e.target.value })}
                  className={INPUT_CLS}
                  placeholder="ε at 260nm (DNA) or 280nm (protein)"
                />
                <input
                  type="number"
                  value={spec.mw}
                  onChange={(e) => onChange({ mw: e.target.value })}
                  className={INPUT_CLS}
                  placeholder="Molecular weight (Da) — for ng/µL"
                />
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <select
                  value={spec.seqType || 'dsDNA'}
                  onChange={(e) => onChange({ seqType: e.target.value })}
                  className={INPUT_CLS}
                >
                  <option value="dsDNA">dsDNA</option>
                  <option value="ssDNA">ssDNA</option>
                  <option value="protein">Protein</option>
                </select>
                <textarea
                  value={spec.sequence || ''}
                  onChange={(e) => onChange({ sequence: e.target.value })}
                  rows={4}
                  className={`${INPUT_CLS} font-mono`}
                  placeholder={spec.seqType === 'protein' ? 'Paste AA sequence…' : 'Paste DNA sequence…'}
                />
                {spec.sequence?.trim() && (
                  <div className="text-[11px] font-bold text-slate-600 bg-white border border-slate-200 rounded p-2 flex flex-col gap-0.5">
                    <span>Length: {seqProps.length}</span>
                    <span>
                      ε{isProtein ? '280' : '260'} (computed):{' '}
                      <span className="text-blue-700 font-mono">
                        {seqProps.epsilon ? Math.round(seqProps.epsilon).toLocaleString() : '—'}
                      </span>{' '}
                      M⁻¹cm⁻¹
                    </span>
                    <span>MW (computed): <span className="text-blue-700 font-mono">{round(seqProps.mw, 0)} Da</span></span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* chart */}
        <div className="lg:col-span-2 flex flex-col gap-1">
          {an ? (
            <UvZoomChart pts={an.pts} />
          ) : (
            <div className="h-[220px] flex items-center justify-center text-slate-400 italic text-sm">
              Not enough data points.
            </div>
          )}
        </div>
      </div>

      {/* results */}
      {an && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mt-4">
          {[
            { label: 'A260', value: an.a260 != null ? an.a260.toFixed(3) : '—' },
            { label: 'A280', value: an.a280 != null ? an.a280.toFixed(3) : '—' },
            { label: 'A230', value: an.a230 != null ? an.a230.toFixed(3) : '—' },
            { label: '260/280', value: an.r260_280 != null ? an.r260_280.toFixed(2) : '—', cls: ratioCls(an.r260_280, isProtein ? 0.5 : 1.7, isProtein ? 0.7 : 1.9) },
            { label: '260/230', value: an.r260_230 != null ? an.r260_230.toFixed(2) : '—', cls: ratioCls(an.r260_230, 2.0, 2.4) },
            { label: 'Conc. (µM)', value: an.concUM != null ? round(an.concUM, 3) : '—', accent: true },
            { label: 'Conc. (ng/µL)', value: an.concNgUl != null ? round(an.concNgUl, 2) : '—', accent: true }
          ].map((cell) => (
            <div key={cell.label} className="text-center">
              <div className="text-[10px] font-bold text-slate-500 uppercase mb-1">{cell.label}</div>
              <div
                className={`border rounded-lg p-2 text-sm font-mono font-bold ${
                  cell.accent
                    ? 'bg-blue-50 border-blue-300 text-blue-700'
                    : cell.cls || 'bg-white border-slate-300 text-slate-700'
                }`}
              >
                {cell.value}
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="text-[10px] text-slate-400 italic mt-3">
        Beer–Lambert: c = A / (ε × l). Baseline subtracted using mean absorbance ≥ 320 nm.
        {an && an.baseline > 0 && ` (baseline = ${an.baseline.toFixed(4)})`}
      </p>
    </div>
  );
};

/* ==========================================================================
   DNA QUANTIFICATION TABLE
========================================================================== */
const DnaQuantTable = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const rows = Array.isArray(activeTest.dnaQuantification) ? activeTest.dnaQuantification : [];

  const addRow = () =>
    updateActiveTest({
      dnaQuantification: [
        ...rows,
        { id: uid('quant'), sample: '', concentration: '', a260_280: '', a260_230: '', notes: '' }
      ]
    });

  const updateRow = (id, field, value) =>
    updateActiveTest({
      dnaQuantification: rows.map((r) => (r.id === id ? { ...r, [field]: value } : r))
    });

  const removeRow = (id) =>
    updateActiveTest({ dnaQuantification: rows.filter((r) => r.id !== id) });

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-xs font-bold text-slate-600 uppercase">Nanodrop / Qubit Results</h3>
        <button
          type="button"
          onClick={addRow}
          className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs shadow-sm"
        >
          + Add Sample
        </button>
      </div>
      <div className="overflow-x-auto custom-scrollbar border border-slate-200 rounded-lg">
        <table className="w-full text-sm text-left min-w-[650px]">
          <thead className="text-xs text-slate-500 uppercase bg-slate-100">
            <tr>
              <th className="px-3 py-2 border-b">Sample Name</th>
              <th className="px-3 py-2 border-b">Conc. ng/µL</th>
              <th className="px-3 py-2 border-b">260/280</th>
              <th className="px-3 py-2 border-b">260/230</th>
              <th className="px-3 py-2 border-b">Notes</th>
              <th className="px-3 py-2 border-b w-16"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {rows.length === 0 ? (
              <tr>
                <td colSpan="6" className="px-3 py-6 text-center text-slate-400 italic">
                  No DNA quantification data. Add manually or import from the UV Spectra tool above.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className="px-3 py-1.5">
                    <input type="text" value={row.sample}
                      onChange={(e) => updateRow(row.id, 'sample', e.target.value)}
                      className={INPUT_CLS} placeholder="e.g. Plasmid 1" />
                  </td>
                  <td className="px-3 py-1.5">
                    <input type="number" value={row.concentration}
                      onChange={(e) => updateRow(row.id, 'concentration', e.target.value)}
                      className={`${INPUT_CLS} font-mono text-blue-700 font-bold`} placeholder="ng/µL" />
                  </td>
                  <td className="px-3 py-1.5">
                    <input type="number" step="0.01" value={row.a260_280}
                      onChange={(e) => updateRow(row.id, 'a260_280', e.target.value)}
                      className={INPUT_CLS} placeholder="~1.8" />
                  </td>
                  <td className="px-3 py-1.5">
                    <input type="number" step="0.01" value={row.a260_230}
                      onChange={(e) => updateRow(row.id, 'a260_230', e.target.value)}
                      className={INPUT_CLS} placeholder="2.0–2.2" />
                  </td>
                  <td className="px-3 py-1.5">
                    <input type="text" value={row.notes}
                      onChange={(e) => updateRow(row.id, 'notes', e.target.value)}
                      className={INPUT_CLS} placeholder="Notes…" />
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    <button type="button" onClick={() => removeRow(row.id)}
                      className="text-red-400 hover:text-red-600 font-bold text-lg leading-none">×</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/* ==========================================================================
   GEL ELECTROPHORESIS PANEL
========================================================================== */
const GelPanel = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const gelImages = Array.isArray(activeTest.gelImages) ? activeTest.gelImages : [];
  const fileRef = useRef(null);

  const importFiles = async (fileList) => {
    const files = Array.from(fileList || []).filter((f) => f?.type?.startsWith('image/'));
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
    } catch (err) {
      console.error(err);
      alert('Gel image import failed.');
    }
  };

  const addLinks = () => {
    const urlsText = prompt('Paste external link(s) for gel images, separated by commas:');
    if (!urlsText || !urlsText.trim()) return;
    const urls = urlsText.split(/[\s,]+/).map((u) => u.trim()).filter(Boolean);
    updateActiveTest({ gelImages: [...gelImages, ...urls] });
  };

  return (
    <div className="border border-slate-200 bg-slate-50 rounded-lg p-4">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          importFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
        <label className="text-xs font-bold text-slate-600 uppercase">Gel Images</label>
        <div className="flex gap-2">
          <button type="button" onClick={() => fileRef.current?.click()}
            className="bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 font-bold px-3 py-1.5 rounded text-xs shadow-sm">
            📁 Upload Images
          </button>
          <button type="button" onClick={addLinks}
            className="bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-600 font-bold px-3 py-1.5 rounded text-xs shadow-sm">
            🔗 Add Links
          </button>
        </div>
      </div>
      {gelImages.length === 0 ? (
        <p className="text-xs text-slate-400 italic">No gel images attached.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-4">
          {gelImages.map((imgSrc, idx) => (
            <div key={idx} className="relative group bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-500">Gel Image {idx + 1}</span>
                <button
                  type="button"
                  onClick={() => updateActiveTest({ gelImages: gelImages.filter((_, i) => i !== idx) })}
                  className="bg-red-50 hover:bg-red-100 text-red-500 rounded-full w-6 h-6 flex items-center justify-center text-sm font-bold border border-red-200"
                >
                  ×
                </button>
              </div>
              <div className="bg-slate-50 rounded-lg p-2 border border-slate-100">
                <SmartImage src={imgSrc} alt={`Gel image ${idx + 1}`} style={{ maxHeight: '260px', minHeight: '120px' }} />
              </div>
              {!String(imgSrc).startsWith('data:') && (
                <a href={imgSrc} target="_blank" rel="noopener noreferrer"
                  className="mt-2 text-xs text-blue-500 hover:text-blue-700 font-medium flex items-center gap-1">
                  🔗 Open original
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/* ==========================================================================
   DATA — UNIQUE SECTION WRAPPER (UV Spectra / Quantification / Gels)
========================================================================== */
export const CloningDataSection = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const uvSpectra = Array.isArray(activeTest.uvSpectra) ? activeTest.uvSpectra : [];
  const uvFileRef = useRef(null);

  const importUvFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const imported = [];
    for (const file of files) {
      const text = await file.text();
      const points = parseSpectrumText(text);
      if (points.length >= 3) {
        imported.push({
          id: uid('uv'),
          name: file.name.replace(/\.[^.]+$/, ''),
          pathLength: '1',
          epsMode: 'manual',
          epsilon: '',
          mw: '',
          seqType: 'dsDNA',
          sequence: '',
          points
        });
      }
    }
    if (imported.length) {
      updateActiveTest({ uvSpectra: [...uvSpectra, ...imported] });
    } else {
      alert('No readable numeric data found. Expected 2 columns: wavelength, absorbance (CSV/TSV/TXT).');
    }
  };

  const updateSpectrum = (id, patch) =>
    updateActiveTest({ uvSpectra: uvSpectra.map((s) => (s.id === id ? { ...s, ...patch } : s)) });

  const removeSpectrum = (id) =>
    updateActiveTest({ uvSpectra: uvSpectra.filter((s) => s.id !== id) });

  const sendToQuant = (spec) => {
    const an = analyzeSpectrum(spec);
    if (!an) return;
    const rows = Array.isArray(activeTest.dnaQuantification) ? activeTest.dnaQuantification : [];
    updateActiveTest({
      dnaQuantification: [
        ...rows,
        {
          id: uid('quant'),
          sample: spec.name || 'UV import',
          concentration: an.concNgUl != null ? an.concNgUl.toFixed(1) : '',
          a260_280: an.r260_280 != null ? an.r260_280.toFixed(2) : '',
          a260_230: an.r260_230 != null ? an.r260_230.toFixed(2) : '',
          notes: `From UV spectrum "${spec.name}" (A260=${an.a260 != null ? an.a260.toFixed(3) : '—'}, baseline corrected)`
        }
      ]
    });
  };

  return (
    <div className="flex flex-col gap-6">
      {/* ---------- UV SPECTRA ---------- */}
      <CollapsibleSection title="UV Spectra — Concentration from Absorbance" icon="💧">
        <input
          ref={uvFileRef}
          type="file"
          accept=".csv,.txt,.tsv"
          multiple
          className="hidden"
          onChange={(e) => {
            importUvFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <div className="flex justify-between items-center flex-wrap gap-2 mb-4">
          <p className="text-xs text-slate-500">
            Upload exported spectra (2 columns: wavelength, absorbance). Concentration is computed with
            Beer–Lambert using molar extinction coefficients (manual or sequence-derived).
          </p>
          <button
            type="button"
            onClick={() => uvFileRef.current?.click()}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-lg text-xs shadow-sm"
          >
            📁 Upload UV Spectrum (CSV/TXT)
          </button>
        </div>
        {uvSpectra.length === 0 ? (
          <div className="text-center py-8 text-slate-400 italic bg-slate-50 rounded-lg border border-dashed border-slate-300 text-sm">
            No UV spectra uploaded yet.
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {uvSpectra.map((spec) => (
              <UvSpectrumCard
                key={spec.id}
                spec={spec}
                onChange={(patch) => updateSpectrum(spec.id, patch)}
                onRemove={() => removeSpectrum(spec.id)}
                onSendToQuant={() => sendToQuant(spec)}
              />
            ))}
          </div>
        )}
      </CollapsibleSection>

      {/* ---------- DNA QUANTIFICATION ---------- */}
      <CollapsibleSection title="DNA Quantification" icon="🧮">
        <DnaQuantTable ctx={ctx} />
      </CollapsibleSection>

      {/* ---------- GELS ---------- */}
      <CollapsibleSection title="Gel Electrophoresis" icon="🧬">
        <GelPanel ctx={ctx} />
      </CollapsibleSection>
    </div>
  );
};

export default CloningDataSection;
