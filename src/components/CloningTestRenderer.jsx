import React, { useRef } from 'react';
import TestShellRenderer, { CollapsibleSection, SmartImage } from './TestShellRenderer';
import { CLONING_TAB_CONFIG } from './tabConfigs';

// ================= CLONING SPECIFIC CONTENT =================
const CloningAll = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const update = updateActiveTest;

  // Estraiamo i dati specifici per il clonaggio
  const dnaQuantification = Array.isArray(activeTest.dnaQuantification) ? activeTest.dnaQuantification : [];
  const gelImages = Array.isArray(activeTest.gelImages) ? activeTest.gelImages : [];
  const pcrConditions = activeTest.pcrConditions || '';

  const gelImageInputRef = useRef(null);

  // Gestione Tabella Quantificazione
  const addQuantRow = () => {
    const newRow = {
      id: `quant_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      sample: '',
      concentration: '',
      a260_280: '',
      a260_230: '',
      notes: ''
    };
    update({ dnaQuantification: [...dnaQuantification, newRow] });
  };

  const updateQuantRow = (id, field, value) => {
    update({
      dnaQuantification: dnaQuantification.map(row => 
        row.id === id ? { ...row, [field]: value } : row
      )
    });
  };

  const removeQuantRow = (id) => {
    update({
      dnaQuantification: dnaQuantification.filter(row => row.id !== id)
    });
  };

  // Gestione Immagini Gel
  const importGelImages = async (fileList) => {
    const files = Array.from(fileList || []).filter((f) => f && f.type && f.type.startsWith('image/'));
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
      update({ gelImages: [...gelImages, ...imported] });
    } catch (e) {
      console.error(e);
      alert('Gel image import failed.');
    }
  };

  const addGelImageLinks = () => {
    const urlsText = prompt('Paste external link(s) for gel images (comma separated):');
    if (urlsText && urlsText.trim()) {
      const urls = urlsText.split(/[\s,]+/).filter((u) => u.trim() !== '');
      update({ gelImages: [...gelImages, ...urls] });
    }
  };

  return (
    <div className="flex flex-col gap-6">
      
      <CollapsibleSection title="DNA Quantification" icon="💧" defaultOpen={true}>
        <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-xs font-bold text-slate-600 uppercase">Nanodrop / Qubit Results</h3>
            <button
              onClick={addQuantRow}
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs shadow-sm transition-colors"
            >
              + Add Sample
            </button>
          </div>
          
          <div className="overflow-x-auto custom-scrollbar border border-slate-200 rounded-lg">
            <table className="w-full text-sm text-left min-w-[600px]">
              <thead className="text-xs text-slate-500 uppercase bg-slate-100">
                <tr>
                  <th className="px-3 py-2 border-b border-slate-200">Sample Name</th>
                  <th className="px-3 py-2 border-b border-slate-200">Conc. (ng/µL)</th>
                  <th className="px-3 py-2 border-b border-slate-200">260/280</th>
                  <th className="px-3 py-2 border-b border-slate-200">260/230</th>
                  <th className="px-3 py-2 border-b border-slate-200">Notes</th>
                  <th className="px-3 py-2 border-b border-slate-200 w-16"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {dnaQuantification.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="px-3 py-6 text-center text-slate-400 italic">
                      No DNA quantification data added.
                    </td>
                  </tr>
                ) : (
                  dnaQuantification.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="px-3 py-1.5">
                        <input
                          type="text"
                          value={row.sample}
                          onChange={(e) => updateQuantRow(row.id, 'sample', e.target.value)}
                          className="w-full border border-slate-300 rounded px-2 py-1 outline-none focus:border-blue-500 text-sm"
                          placeholder="e.g. Plasmid 1"
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          type="number"
                          value={row.concentration}
                          onChange={(e) => updateQuantRow(row.id, 'concentration', e.target.value)}
                          className="w-full border border-slate-300 rounded px-2 py-1 outline-none focus:border-blue-500 text-sm font-mono text-blue-700 font-bold"
                          placeholder="ng/µL"
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          type="number"
                          step="0.01"
                          value={row.a260_280}
                          onChange={(e) => updateQuantRow(row.id, 'a260_280', e.target.value)}
                          className="w-full border border-slate-300 rounded px-2 py-1 outline-none focus:border-blue-500 text-sm"
                          placeholder="~1.8"
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          type="number"
                          step="0.01"
                          value={row.a260_230}
                          onChange={(e) => updateQuantRow(row.id, 'a260_230', e.target.value)}
                          className="w-full border border-slate-300 rounded px-2 py-1 outline-none focus:border-blue-500 text-sm"
                          placeholder="2.0-2.2"
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          type="text"
                          value={row.notes}
                          onChange={(e) => updateQuantRow(row.id, 'notes', e.target.value)}
                          className="w-full border border-slate-300 rounded px-2 py-1 outline-none focus:border-blue-500 text-sm"
                          placeholder="Notes..."
                        />
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        <button
                          onClick={() => removeQuantRow(row.id)}
                          className="text-red-400 hover:text-red-600 font-bold text-lg leading-none"
                        >
                          &times;
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Reaction & PCR Setup" icon="🌡️" defaultOpen={false}>
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
          <label className="text-xs font-bold text-slate-600 uppercase mb-2 block">
            Thermal Cycler Conditions / Reaction Mix
          </label>
          <textarea
            value={pcrConditions}
            onChange={(e) => update({ pcrConditions: e.target.value })}
            className="w-full border border-slate-300 rounded-lg p-3 font-mono text-xs outline-none focus:border-blue-500 h-32 resize-y shadow-inner"
            placeholder={`e.g.\n98°C - 30s\n[ 98°C - 10s | 60°C - 20s | 72°C - 1m ] x 30 cycles\n72°C - 5m\n4°C - hold`}
          />
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Gel Electrophoresis" icon="🧬" defaultOpen={true}>
        <div className="border border-slate-200 bg-slate-50 rounded-lg p-4">
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
            <label className="text-xs font-bold text-slate-600 uppercase">🖼️ Gel Images</label>
            <div className="flex gap-2">
              <button
                onClick={() => gelImageInputRef.current?.click()}
                className="bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 font-bold px-3 py-1.5 rounded text-xs shadow-sm"
              >
                📁 Upload Images
              </button>
              <button
                onClick={addGelImageLinks}
                className="bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-600 font-bold px-3 py-1.5 rounded text-xs shadow-sm"
              >
                🔗 Link URLs
              </button>
            </div>
          </div>
          {gelImages.length === 0 ? (
            <p className="text-xs text-slate-400 italic">No gel images attached.</p>
          ) : (
            <div className="flex flex-wrap gap-4 mt-4">
              {gelImages.map((imgSrc, idx) => (
                <div key={idx} className="relative group">
                  <div className="cursor-pointer border border-slate-300 rounded-lg p-1 bg-white shadow-md">
                    <SmartImage
                      src={imgSrc}
                      alt={`Gel img ${idx + 1}`}
                      style={{ maxHeight: '200px', maxWidth: '300px' }}
                    />
                  </div>
                  <button
                    onClick={() => update({ gelImages: gelImages.filter((_, i) => i !== idx) })}
                    className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm font-bold shadow opacity-0 group-hover:opacity-100 transition-opacity no-print z-10"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </CollapsibleSection>
    </div>
  );
};

// ================= NOTEBOOK EXPORT =================
const buildCloningNotebookHtml = (checked, ctx) => {
  const t = ctx.activeTest || {};
  let html = '';

  if (checked.cond) {
    const protTitles = (t.linkedProtocolIds || [])
      .map((id) => (ctx.datasetProtocols || []).find((p) => p.id === id)?.title)
      .filter(Boolean).join(', ') || 'N/A';
      
    html += `<p style="font-size: 12px; color: #475569; margin-bottom: 8px;">
      <b>Vector:</b> ${t.vectorBackbone || 'N/A'} |
      <b>Method:</b> ${t.cloningMethod || 'N/A'} |
      <b>Selection:</b> ${t.selectionMarker || 'N/A'} |
      <b>Sequencing:</b> ${t.sequencingStatus || 'N/A'} |
      <b>Protocols:</b> ${protTitles}
    </p>`;
  }

  if (checked.quant && Array.isArray(t.dnaQuantification) && t.dnaQuantification.length > 0) {
    html += `<h4 style="font-size: 12px; color: #334155; margin-bottom: 4px; border-bottom: 1px solid #cbd5e1; padding-bottom: 2px;">DNA Quantification</h4>
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 11px; text-align: left; background: white;">
      <tr style="background-color: #f1f5f9;">
        <th style="padding: 6px; border: 1px solid #cbd5e1;">Sample</th>
        <th style="padding: 6px; border: 1px solid #cbd5e1;">Conc (ng/µL)</th>
        <th style="padding: 6px; border: 1px solid #cbd5e1;">260/280</th>
        <th style="padding: 6px; border: 1px solid #cbd5e1;">260/230</th>
      </tr>`;
    t.dnaQuantification.forEach(row => {
      html += `<tr>
        <td style="padding: 6px; border: 1px solid #e2e8f0;"><b>${row.sample || '—'}</b></td>
        <td style="padding: 6px; border: 1px solid #e2e8f0; color: #1d4ed8; font-family: monospace;"><b>${row.concentration || '—'}</b></td>
        <td style="padding: 6px; border: 1px solid #e2e8f0;">${row.a260_280 || '—'}</td>
        <td style="padding: 6px; border: 1px solid #e2e8f0;">${row.a260_230 || '—'}</td>
      </tr>`;
    });
    html += `</table>`;
  }

  if (checked.gels && Array.isArray(t.gelImages) && t.gelImages.length > 0) {
    html += `<h4 style="font-size: 12px; color: #334155; margin-bottom: 4px;">Gel Images</h4>
    <p style="font-size: 11px; color: #64748b;">${t.gelImages.length} images attached.</p>`;
  }

  return html;
};

// ================= MAIN CLONING RENDERER =================
export const CloningTestRenderer = (props) => {
  // Le categorie definite in App → Definitions & Labels hanno la priorità
  const appCategories = Array.isArray(props.testCategories) && props.testCategories.length
    ? props.testCategories
    : CLONING_TAB_CONFIG.fallbackCategories || [
        'Vector Construction', 'Mutagenesis', 'Plasmid Prep', 'Validation'
      ];

  const config = { ...CLONING_TAB_CONFIG, categories: appCategories };

  return (
    <TestShellRenderer
      {...props}
      config={config}
      custom={{
        All: CloningAll,
        buildNotebookHtml: buildCloningNotebookHtml
      }}
      testCategories={appCategories}
    />
  );
};

export default CloningTestRenderer;
