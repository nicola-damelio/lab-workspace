import React, { useRef } from 'react';
import TestShellRenderer, {
  CollapsibleSection,
  SmartImage
} from './TestShellRenderer';
import { CLONING_TAB_CONFIG } from './tabConfigs';

/* ============================================================================
   HELPERS
========================================================================== */

const getOperatorLabel = (op) => {
  if (typeof op === 'string') return op;
  return `${op?.name || ''} ${op?.surname || ''}`.trim();
};

/* ============================================================================
   SETUP SECTION
========================================================================== */

const CloningSetupSection = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;

  return (
    <CollapsibleSection title="Experiment Setup" icon="🌡️">
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
        <label className="text-xs font-bold text-slate-600 uppercase mb-2 block">
          Thermal Cycler Conditions / Reaction Mix
        </label>

        <textarea
          value={activeTest.pcrConditions || ''}
          onChange={(e) => updateActiveTest({ pcrConditions: e.target.value })}
          className="w-full border border-slate-300 rounded-lg p-3 font-mono text-xs outline-none focus:border-blue-500 h-40 resize-y shadow-inner"
          placeholder={`e.g.

Initial denaturation: 98°C for 30 s
30 cycles:
  1. Denature: 98°C for 10 s
  2. Anneal: 60°C for 20 s
  3. Extend: 72°C for 30 s
Final extension: 72°C for 5 min
Hold: 4°C`}
        />
      </div>
    </CollapsibleSection>
  );
};

/* ============================================================================
   DATA SECTION — DNA QUANTIFICATION + GEL ELECTROPHORESIS
========================================================================== */

const CloningDataSection = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;

  const dnaQuantification = Array.isArray(activeTest.dnaQuantification)
    ? activeTest.dnaQuantification
    : [];

  const gelImages = Array.isArray(activeTest.gelImages)
    ? activeTest.gelImages
    : [];

  const gelImageInputRef = useRef(null);

  const addQuantRow = () => {
    const newRow = {
      id: `quant_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      sample: '',
      concentration: '',
      a260_280: '',
      a260_230: '',
      notes: ''
    };

    updateActiveTest({
      dnaQuantification: [...dnaQuantification, newRow]
    });
  };

  const updateQuantRow = (id, field, value) => {
    updateActiveTest({
      dnaQuantification: dnaQuantification.map((row) =>
        row.id === id ? { ...row, [field]: value } : row
      )
    });
  };

  const removeQuantRow = (id) => {
    updateActiveTest({
      dnaQuantification: dnaQuantification.filter((row) => row.id !== id)
    });
  };

  const importGelImages = async (fileList) => {
    const files = Array.from(fileList || []).filter(
      (file) => file && file.type && file.type.startsWith('image/')
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

      updateActiveTest({
        gelImages: [...gelImages, ...imported]
      });
    } catch (error) {
      console.error(error);
      alert('Gel image import failed.');
    }
  };

  const addGelImageLinks = () => {
    const urlsText = prompt(
      'Paste external link(s) for gel images, separated by commas:'
    );

    if (!urlsText || !urlsText.trim()) return;

    const urls = urlsText
      .split(/[\s,]+/)
      .map((url) => url.trim())
      .filter(Boolean);

    updateActiveTest({
      gelImages: [...gelImages, ...urls]
    });
  };

  return (
    <>
      {/* DNA quantification */}
      <CollapsibleSection title="Data — DNA Quantification" icon="💧">
        <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-xs font-bold text-slate-600 uppercase">
              Nanodrop / Qubit Results
            </h3>

            <button
              type="button"
              onClick={addQuantRow}
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs shadow-sm transition-colors"
            >
              + Add Sample
            </button>
          </div>

          <div className="overflow-x-auto custom-scrollbar border border-slate-200 rounded-lg">
            <table className="w-full text-sm text-left min-w-[650px]">
              <thead className="text-xs text-slate-500 uppercase bg-slate-100">
                <tr>
                  <th className="px-3 py-2 border-b border-slate-200">
                    Sample Name
                  </th>
                  <th className="px-3 py-2 border-b border-slate-200">
                    Conc. ng/µL
                  </th>
                  <th className="px-3 py-2 border-b border-slate-200">
                    260/280
                  </th>
                  <th className="px-3 py-2 border-b border-slate-200">
                    260/230
                  </th>
                  <th className="px-3 py-2 border-b border-slate-200">Notes</th>
                  <th className="px-3 py-2 border-b border-slate-200 w-16"></th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100 bg-white">
                {dnaQuantification.length === 0 ? (
                  <tr>
                    <td
                      colSpan="6"
                      className="px-3 py-6 text-center text-slate-400 italic"
                    >
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
                          onChange={(e) =>
                            updateQuantRow(row.id, 'sample', e.target.value)
                          }
                          className="w-full border border-slate-300 rounded px-2 py-1 outline-none focus:border-blue-500 text-sm"
                          placeholder="e.g. Plasmid 1"
                        />
                      </td>

                      <td className="px-3 py-1.5">
                        <input
                          type="number"
                          value={row.concentration}
                          onChange={(e) =>
                            updateQuantRow(
                              row.id,
                              'concentration',
                              e.target.value
                            )
                          }
                          className="w-full border border-slate-300 rounded px-2 py-1 outline-none focus:border-blue-500 text-sm font-mono text-blue-700 font-bold"
                          placeholder="ng/µL"
                        />
                      </td>

                      <td className="px-3 py-1.5">
                        <input
                          type="number"
                          step="0.01"
                          value={row.a260_280}
                          onChange={(e) =>
                            updateQuantRow(row.id, 'a260_280', e.target.value)
                          }
                          className="w-full border border-slate-300 rounded px-2 py-1 outline-none focus:border-blue-500 text-sm"
                          placeholder="~1.8"
                        />
                      </td>

                      <td className="px-3 py-1.5">
                        <input
                          type="number"
                          step="0.01"
                          value={row.a260_230}
                          onChange={(e) =>
                            updateQuantRow(row.id, 'a260_230', e.target.value)
                          }
                          className="w-full border border-slate-300 rounded px-2 py-1 outline-none focus:border-blue-500 text-sm"
                          placeholder="2.0–2.2"
                        />
                      </td>

                      <td className="px-3 py-1.5">
                        <input
                          type="text"
                          value={row.notes}
                          onChange={(e) =>
                            updateQuantRow(row.id, 'notes', e.target.value)
                          }
                          className="w-full border border-slate-300 rounded px-2 py-1 outline-none focus:border-blue-500 text-sm"
                          placeholder="Notes..."
                        />
                      </td>

                      <td className="px-3 py-1.5 text-center">
                        <button
                          type="button"
                          onClick={() => removeQuantRow(row.id)}
                          className="text-red-400 hover:text-red-600 font-bold text-lg leading-none"
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
        </div>
      </CollapsibleSection>

      {/* Gel electrophoresis */}
      <CollapsibleSection title="Data — Gel Electrophoresis" icon="🧬">
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
            <label className="text-xs font-bold text-slate-600 uppercase">
              Gel Images
            </label>

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
            <p className="text-xs text-slate-400 italic">
              No gel images attached.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-4">
              {gelImages.map((imgSrc, idx) => (
                <div
                  key={idx}
                  className="relative group bg-white p-3 rounded-xl border border-slate-200 shadow-sm"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-slate-500">
                      Gel Image {idx + 1}
                    </span>

                    <button
                      type="button"
                      onClick={() =>
                        updateActiveTest({
                          gelImages: gelImages.filter((_, i) => i !== idx)
                        })
                      }
                      className="bg-red-50 hover:bg-red-100 text-red-500 hover:text-red-700 rounded-full w-6 h-6 flex items-center justify-center text-sm font-bold transition-colors border border-red-200"
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

                  <a
                    href={imgSrc}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 text-xs text-blue-500 hover:text-blue-700 font-medium flex items-center gap-1"
                  >
                    🔗 Open original
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      </CollapsibleSection>
    </>
  );
};

/* ============================================================================
   NOTEBOOK EXPORT
========================================================================== */

const buildCloningNotebookHtml = (checked, ctx) => {
  const t = ctx.activeTest || {};

  const operatorNames = (Array.isArray(t.operators) ? t.operators : [])
    .map(getOperatorLabel)
    .filter(Boolean)
    .join(', ');

  const category = t.testCategory || 'N/A';
  const secondary = t.secondaryCategory || '';

  let html = '';

  if (checked.cond) {
    const protTitles =
      (t.linkedProtocolIds || [])
        .map((id) =>
          (ctx.datasetProtocols || []).find((p) => p.id === id)?.title
        )
        .filter(Boolean)
        .join(', ') || 'N/A';

    html += `
      <p style="font-size: 12px; color: #475569; margin-bottom: 8px;">
        <b>Experiment Type:</b> ${category} |
        ${secondary ? `<b>Secondary Classification:</b> ${secondary} |` : ''}
        <b>Operator(s):</b> ${operatorNames || 'N/A'} |
        <b>Vector:</b> ${t.vectorBackbone || 'N/A'} |
        <b>Method:</b> ${t.cloningMethod || 'N/A'} |
        <b>Selection:</b> ${t.selectionMarker || 'N/A'} |
        <b>Sequencing:</b> ${t.sequencingStatus || 'N/A'} |
        <b>Protocols:</b> ${protTitles}
      </p>
    `;
  }

  if (checked.setup && t.pcrConditions) {
    html += `
      <h4 style="font-size: 12px; color: #334155; margin-bottom: 4px; border-bottom: 1px solid #cbd5e1; padding-bottom: 2px;">
        PCR / Reaction Setup
      </h4>
      <pre style="white-space: pre-wrap; font-size: 11px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px; font-family: monospace; color: #0f172a; margin-bottom: 12px;">${t.pcrConditions}</pre>
    `;
  }

  if (
    checked.quant &&
    Array.isArray(t.dnaQuantification) &&
    t.dnaQuantification.length > 0
  ) {
    html += `
      <h4 style="font-size: 12px; color: #334155; margin-bottom: 4px; border-bottom: 1px solid #cbd5e1; padding-bottom: 2px;">
        DNA Quantification
      </h4>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 11px; text-align: left; background: white;">
        <tr style="background-color: #f1f5f9;">
          <th style="padding: 6px; border: 1px solid #cbd5e1;">Sample</th>
          <th style="padding: 6px; border: 1px solid #cbd5e1;">Conc ng/µL</th>
          <th style="padding: 6px; border: 1px solid #cbd5e1;">260/280</th>
          <th style="padding: 6px; border: 1px solid #cbd5e1;">260/230</th>
          <th style="padding: 6px; border: 1px solid #cbd5e1;">Notes</th>
        </tr>
    `;

    t.dnaQuantification.forEach((row) => {
      html += `
        <tr>
          <td style="padding: 6px; border: 1px solid #e2e8f0;"><b>${
            row.sample || '—'
          }</b></td>
          <td style="padding: 6px; border: 1px solid #e2e8f0; color: #1d4ed8; font-family: monospace;"><b>${
            row.concentration || '—'
          }</b></td>
          <td style="padding: 6px; border: 1px solid #e2e8f0;">${
            row.a260_280 || '—'
          }</td>
          <td style="padding: 6px; border: 1px solid #e2e8f0;">${
            row.a260_230 || '—'
          }</td>
          <td style="padding: 6px; border: 1px solid #e2e8f0;">${
            row.notes || '—'
          }</td>
        </tr>
      `;
    });

    html += `</table>`;
  }

  if (checked.gels && Array.isArray(t.gelImages) && t.gelImages.length > 0) {
    html += `
      <h4 style="font-size: 12px; color: #334155; margin-bottom: 4px;">
        Gel Images
      </h4>
      <p style="font-size: 11px; color: #64748b;">
        ${t.gelImages.length} gel image(s) attached.
      </p>
    `;
  }

  return html;
};

/* ============================================================================
   MAIN CLONING RENDERER
========================================================================== */

export const CloningTestRenderer = (props) => {
  const appCategories =
    Array.isArray(props.testCategories) && props.testCategories.length
      ? props.testCategories
      : CLONING_TAB_CONFIG.fallbackCategories || [
          'Vector Construction',
          'Mutagenesis',
          'Plasmid Prep',
          'Validation'
        ];

  const config = {
    ...CLONING_TAB_CONFIG,
    categories: appCategories,
    notebookChecks: [
      { id: 'cond', label: 'Classification & Conditions' },
      { id: 'setup', label: 'PCR / Reaction Setup' },
      { id: 'quant', label: 'DNA Quantification' },
      { id: 'gels', label: 'Gel Images' }
    ]
  };

  return (
    <TestShellRenderer
      {...props}
      config={config}
      custom={{
        Setup: CloningSetupSection,
        Data: CloningDataSection,
        buildNotebookHtml: buildCloningNotebookHtml
      }}
      testCategories={appCategories}
    />
  );
};

export default CloningTestRenderer;
