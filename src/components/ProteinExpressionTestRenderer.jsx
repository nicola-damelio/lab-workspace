import React, { useState, useRef, useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer
} from 'recharts';
import TestShellRenderer, {
  CollapsibleSection,
  SmartImage
} from './TestShellRenderer';
import { PROTEIN_EXPRESSION_TAB_CONFIG } from './tabConfigs';

/* ============================================================================
   DATA SECTION — YIELD, CHROMATOGRAM & GELS
========================================================================== */

const ProteinDataSection = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;

  const yieldData = Array.isArray(activeTest.yieldData) ? activeTest.yieldData : [];
  const gelImages = Array.isArray(activeTest.gelImages) ? activeTest.gelImages : [];
  const gelImageInputRef = useRef(null);

  // Chromatogram state
  const [chromatogramRaw, setChromatogramRaw] = useState(activeTest.chromatogramRaw || '');

  // Parse raw text into chart data (Volume vs Absorbance)
  const chartData = useMemo(() => {
    if (!chromatogramRaw) return [];
    return chromatogramRaw
      .split('\n')
      .map(line => {
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
  }, [chromatogramRaw]);

  const handleChromatogramChange = (val) => {
    setChromatogramRaw(val);
    updateActiveTest({ chromatogramRaw: val });
  };

  // Yield Management
  const addYieldRow = () => {
    const newRow = {
      id: `yield_${Date.now()}`,
      fraction: '',
      concentration: '',
      volume: '',
      totalMass: ''
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

  const importGelImages = async (fileList) => {
    const files = Array.from(fileList || []).filter((f) => f.type.startsWith('image/'));
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
      alert('Gel image import failed.');
    }
  };

  return (
    <div className="flex flex-col gap-6">
      
      {/* 1. Protein Yield / Quantification */}
      <CollapsibleSection title="Protein Yield (BCA / Bradford / UV)" icon="💧">
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
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-slate-500 uppercase bg-slate-100">
              <tr>
                <th className="px-3 py-2">Fraction / Pool</th>
                <th className="px-3 py-2">Conc (mg/mL)</th>
                <th className="px-3 py-2">Volume (mL)</th>
                <th className="px-3 py-2">Total Yield (mg)</th>
                <th className="px-3 py-2 w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {yieldData.length === 0 && (
                <tr><td colSpan="5" className="px-3 py-4 text-center text-slate-400 italic">No fractions added.</td></tr>
              )}
              {yieldData.map((row) => (
                <tr key={row.id}>
                  <td className="px-3 py-1.5">
                    <input type="text" value={row.fraction} onChange={(e) => updateYieldRow(row.id, 'fraction', e.target.value)} className="w-full border rounded px-2 py-1 text-sm outline-none focus:border-blue-500" placeholder="e.g. Elution 1" />
                  </td>
                  <td className="px-3 py-1.5">
                    <input type="number" value={row.concentration} onChange={(e) => updateYieldRow(row.id, 'concentration', e.target.value)} className="w-full border rounded px-2 py-1 text-sm outline-none focus:border-blue-500" />
                  </td>
                  <td className="px-3 py-1.5">
                    <input type="number" value={row.volume} onChange={(e) => updateYieldRow(row.id, 'volume', e.target.value)} className="w-full border rounded px-2 py-1 text-sm outline-none focus:border-blue-500" />
                  </td>
                  <td className="px-3 py-1.5 font-bold text-blue-700">{row.totalMass || '—'}</td>
                  <td className="px-3 py-1.5 text-center">
                    <button type="button" onClick={() => updateActiveTest({ yieldData: yieldData.filter(r => r.id !== row.id) })} className="text-red-400 hover:text-red-600 font-bold">×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>

      {/* 2. Chromatogram Upload & Graph */}
      <CollapsibleSection title="Chromatogram (FPLC/AKTA)" icon="📈">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="flex flex-col gap-2">
            <label className="text-xs font-bold text-slate-600 uppercase">Paste Data (Volume vs Absorbance)</label>
            <textarea
              value={chromatogramRaw}
              onChange={(e) => handleChromatogramChange(e.target.value)}
              className="w-full h-48 border border-slate-300 rounded-lg p-3 font-mono text-xs outline-none focus:border-blue-500 shadow-inner"
              placeholder="Paste two columns (Volume in mL, Absorbance in mAU). Separated by tabs or commas."
            />
            <p className="text-[10px] text-slate-400">Data points: {chartData.length}</p>
          </div>
          
          <div className="lg:col-span-2 bg-white p-4 rounded-xl border border-slate-200 shadow-sm min-h-[300px]">
            <h4 className="text-sm font-bold text-slate-700 uppercase mb-4">Elution Profile</h4>
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={chartData} margin={{ top: 10, right: 10, bottom: 20, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="volume" type="number" domain={['auto', 'auto']} tick={{ fontSize: 12 }} label={{ value: 'Elution Volume (mL)', position: 'insideBottom', offset: -15 }} />
                  <YAxis tick={{ fontSize: 12 }} label={{ value: 'Absorbance (mAU)', angle: -90, position: 'insideLeft' }} />
                  <Tooltip formatter={(value) => value.toFixed(2)} labelFormatter={(label) => `${label} mL`} />
                  <Line type="monotone" dataKey="absorbance" stroke="#1e40af" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-slate-400 italic text-sm">
                Paste data to view chromatogram
              </div>
            )}
          </div>
        </div>
      </CollapsibleSection>

      {/* 3. SDS-PAGE Gels */}
      <CollapsibleSection title="SDS-PAGE Gels & Blots" icon="🖼️">
        <div className="border border-slate-200 bg-slate-50 rounded-lg p-4">
          <input
            ref={gelImageInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => { importGelImages(e.target.files); e.target.value = ''; }}
          />
          <div className="flex justify-between items-center mb-3">
            <label className="text-xs font-bold text-slate-600 uppercase">Gel Images</label>
            <button
              type="button"
              onClick={() => gelImageInputRef.current?.click()}
              className="bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 font-bold px-3 py-1.5 rounded text-xs shadow-sm"
            >
              📁 Upload Images
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {gelImages.map((imgSrc, idx) => (
              <div key={idx} className="relative group bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
                <div className="flex justify-between mb-2">
                  <span className="text-xs font-bold text-slate-500">Gel {idx + 1}</span>
                  <button type="button" onClick={() => updateActiveTest({ gelImages: gelImages.filter((_, i) => i !== idx) })} className="bg-red-50 text-red-500 rounded-full w-6 h-6 flex items-center justify-center">×</button>
                </div>
                <div className="bg-slate-50 rounded-lg p-2 border border-slate-100">
                  <SmartImage src={imgSrc} alt={`Gel image ${idx + 1}`} style={{ maxHeight: '260px', minHeight: '120px' }} />
                </div>
              </div>
            ))}
          </div>
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
  let html = '';

  if (checked.cond) {
    html += `
      <p style="font-size: 12px; color: #475569; margin-bottom: 8px;">
        <b>Induction:</b> ${t.inductionMethod || 'N/A'} @ ${t.inductionTemp || 'N/A'} |
        <b>Lysis:</b> ${t.lysisBuffer || 'N/A'} |
        <b>Column:</b> ${t.columnType || 'N/A'}
      </p>
    `;
  }

  if (checked.yield && Array.isArray(t.yieldData) && t.yieldData.length > 0) {
    html += `
      <h4 style="font-size: 12px; color: #334155; margin-bottom: 4px; border-bottom: 1px solid #cbd5e1; padding-bottom: 2px;">Purification Yield</h4>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 11px; text-align: left; background: white;">
        <tr style="background-color: #f1f5f9;">
          <th style="padding: 6px; border: 1px solid #cbd5e1;">Fraction</th>
          <th style="padding: 6px; border: 1px solid #cbd5e1;">Conc (mg/mL)</th>
          <th style="padding: 6px; border: 1px solid #cbd5e1;">Vol (mL)</th>
          <th style="padding: 6px; border: 1px solid #cbd5e1;">Total (mg)</th>
        </tr>
    `;
    t.yieldData.forEach((row) => {
      html += `<tr>
        <td style="padding: 6px; border: 1px solid #e2e8f0;"><b>${row.fraction || '—'}</b></td>
        <td style="padding: 6px; border: 1px solid #e2e8f0;">${row.concentration || '—'}</td>
        <td style="padding: 6px; border: 1px solid #e2e8f0;">${row.volume || '—'}</td>
        <td style="padding: 6px; border: 1px solid #e2e8f0; color: #1d4ed8;"><b>${row.totalMass || '—'}</b></td>
      </tr>`;
    });
    html += `</table>`;
  }

  if (checked.chromatogram && t.chromatogramRaw) {
    html += `<p style="font-size: 11px; color: #64748b;">Chromatogram data attached to original record.</p>`;
  }

  if (checked.gels && Array.isArray(t.gelImages) && t.gelImages.length > 0) {
    html += `<p style="font-size: 11px; color: #64748b;">${t.gelImages.length} SDS-PAGE gel image(s) attached.</p>`;
  }

  return html;
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
        buildNotebookHtml: buildProteinNotebookHtml
      }}
      testCategories={appCategories}
    />
  );
};

export default ProteinExpressionTestRenderer;
