import React from 'react';
import TestShellRenderer from './TestShellRenderer';
import { CLONING_TAB_CONFIG } from './tabConfigs';
import { CloningSetupSection } from './CloningSetupSection';
import { CloningDataSection } from './CloningDataSection';
import { CloningSimulationsSection } from './CloningSimulationsSection';
import { analyzeSpectrum, getOperatorLabel } from './cloningUtils';

/* Cloning Strategy Planner now lives inside CloningSetupSection itself,
   nested within the "Experiment Setup" section and positioned before
   the "Thermal Cycler" subsection. */

/* ============================================================================
LAB NOTEBOOK EXPORT
========================================================================== */
const buildCloningNotebookHtml = (checked, ctx) => {
  const t = ctx.activeTest || {};
  const operatorNames = (Array.isArray(t.operators) ? t.operators : [])
    .map(getOperatorLabel)
    .filter(Boolean)
    .join(', ');

  const category = t.testCategory || 'N/A';
  const secondary = t.secondaryCategory || '';
  const samples = Array.isArray(ctx.selectedCompounds) && ctx.selectedCompounds.length
    ? ctx.selectedCompounds.join(', ')
    : 'N/A';
  const strains = Array.isArray(ctx.cellLines) && ctx.cellLines.length
    ? ctx.cellLines.join(', ')
    : 'N/A';

  let html = '';

  if (checked.cond) {
    const protTitles = (t.linkedProtocolIds || [])
      .map((id) => (ctx.datasetProtocols || []).find((p) => p.id === id)?.title)
      .filter(Boolean)
      .join(', ') || 'N/A';

    html += `
      <p style="font-size: 12px; color: #475569; margin-bottom: 8px;">
        <b>Experiment Type:</b> ${category} |
        ${secondary ? `<b>Secondary:</b> ${secondary} | ` : ''}
        <b>Operator(s):</b> ${operatorNames || 'N/A'} |
        <b>Construct/Insert:</b> ${samples} |
        <b>Strain(s):</b> ${strains} |
        <b>Vector:</b> ${t.vectorBackbone || 'N/A'} |
        <b>Method:</b> ${t.cloningMethod || 'N/A'} |
        <b>Selection:</b> ${t.selectionMarker || 'N/A'} |
        <b>Sequencing:</b> ${t.sequencingStatus || 'N/A'} |
        <b>Protocols:</b> ${protTitles}
      </p>`;
  }

  if (checked.strategy && t.cloningStrategy) {
    const s = t.cloningStrategy;
    html += `
      <p style="font-size: 12px; color: #475569; margin-bottom: 8px;">
        <b>Cloning Strategy:</b> ${s.method || 'restriction'} |
        <b>Insert:</b> ${s.insertCompound || '—'} |
        <b>Vector:</b> ${s.vectorName || '—'} |
        ${s.method === 'gibson'
          ? `<b>Overlap:</b> ${s.overlap || 20} bp | <b>Position:</b> ${s.insertionIndex ?? '—'}`
          : `<b>Enzymes:</b> 5′ ${s.enzyme5 || '—'} / 3′ ${s.enzyme3 || '—'} | <b>MCS:</b> ${s.mcs || '—'}`}
      </p>`;
  }

  if (checked.setup) {
    const program = Array.isArray(t.pcrProgram) ? t.pcrProgram : [];
    const mix = Array.isArray(t.reactionMix) ? t.reactionMix : [];

    if (program.length) {
      html += `
        <h4 style="font-size: 12px; color: #334155; margin-bottom: 4px;">
          🌡️ Thermal Cycler Program ${t.lidTemp ? `(Lid: ${t.lidTemp} °C)` : ''}
        </h4>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 11px; background: white;">
          <tr style="background-color: #f1f5f9;">
            <th style="padding: 5px; border: 1px solid #cbd5e1;">Step</th>
            <th style="padding: 5px; border: 1px solid #cbd5e1;">Temp (°C)</th>
            <th style="padding: 5px; border: 1px solid #cbd5e1;">Time</th>
            <th style="padding: 5px; border: 1px solid #cbd5e1;">Cycles</th>
          </tr>`;
      program.forEach((s) => {
        html += `
          <tr>
            <td style="padding: 5px; border: 1px solid #e2e8f0;"><b>${s.name || '—'}</b></td>
            <td style="padding: 5px; border: 1px solid #e2e8f0;">${s.temp ?? '—'}</td>
            <td style="padding: 5px; border: 1px solid #e2e8f0;">${s.timeValue ?? '—'} ${s.timeUnit || 's'}</td>
            <td style="padding: 5px; border: 1px solid #e2e8f0;">${s.cycles ?? '—'}</td>
          </tr>`;
      });
      html += `</table>`;
    }

    if (mix.length) {
      const total = mix.reduce((s, r) => s + (parseFloat(r.volume) || 0), 0);
      html += `
        <h4 style="font-size: 12px; color: #334155; margin-bottom: 4px;">
          🧪 Reaction Mix (total ${Math.round(total * 100) / 100} µL)
        </h4>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 11px; background: white;">
          <tr style="background-color: #f1f5f9;">
            <th style="padding: 5px; border: 1px solid #cbd5e1;">Component</th>
            <th style="padding: 5px; border: 1px solid #cbd5e1;">Stock</th>
            <th style="padding: 5px; border: 1px solid #cbd5e1;">Volume (µL)</th>
            <th style="padding: 5px; border: 1px solid #cbd5e1;">Notes</th>
          </tr>`;
      mix.forEach((r) => {
        html += `
          <tr>
            <td style="padding: 5px; border: 1px solid #e2e8f0;">${r.name || '—'}</td>
            <td style="padding: 5px; border: 1px solid #e2e8f0;">${r.stock || '—'}</td>
            <td style="padding: 5px; border: 1px solid #e2e8f0;">${r.volume || '—'}</td>
            <td style="padding: 5px; border: 1px solid #e2e8f0;">${r.note || '—'}</td>
          </tr>`;
      });
      html += `</table>`;
    }

    if (t.pcrConditions) {
      html += `<pre style="white-space: pre-wrap; font-size: 11px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px; font-family: monospace; margin-bottom: 12px;">${t.pcrConditions}</pre>`;
    }
  }

  if (checked.quant && Array.isArray(t.dnaQuantification) && t.dnaQuantification.length) {
    html += `
      <h4 style="font-size: 12px; color: #334155; margin-bottom: 4px;">💧 DNA Quantification</h4>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 11px; background: white;">
        <tr style="background-color: #f1f5f9;">
          <th style="padding: 6px; border: 1px solid #cbd5e1;">Sample</th>
          <th style="padding: 6px; border: 1px solid #cbd5e1;">Conc ng/µL</th>
          <th style="padding: 6px; border: 1px solid #cbd5e1;">260/280</th>
          <th style="padding: 6px; border: 1px solid #cbd5e1;">260/230</th>
          <th style="padding: 6px; border: 1px solid #cbd5e1;">Notes</th>
        </tr>`;
    t.dnaQuantification.forEach((row) => {
      html += `
        <tr>
          <td style="padding: 6px; border: 1px solid #e2e8f0;"><b>${row.sample || '—'}</b></td>
          <td style="padding: 6px; border: 1px solid #e2e8f0; color: #1d4ed8; font-family: monospace;"><b>${row.concentration || '—'}</b></td>
          <td style="padding: 6px; border: 1px solid #e2e8f0;">${row.a260_280 || '—'}</td>
          <td style="padding: 6px; border: 1px solid #e2e8f0;">${row.a260_230 || '—'}</td>
          <td style="padding: 6px; border: 1px solid #e2e8f0;">${row.notes || '—'}</td>
        </tr>`;
    });
    html += `</table>`;
  }

  if (checked.uv && Array.isArray(t.uvSpectra) && t.uvSpectra.length) {
    html += `
      <h4 style="font-size: 12px; color: #334155; margin-bottom: 4px;">📈 UV Spectra Analysis</h4>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 11px; background: white;">
        <tr style="background-color: #f1f5f9;">
          <th style="padding: 5px; border: 1px solid #cbd5e1;">Spectrum</th>
          <th style="padding: 5px; border: 1px solid #cbd5e1;">A260</th>
          <th style="padding: 5px; border: 1px solid #cbd5e1;">260/280</th>
          <th style="padding: 5px; border: 1px solid #cbd5e1;">260/230</th>
          <th style="padding: 5px; border: 1px solid #cbd5e1;">Conc. (ng/µL)</th>
        </tr>`;
    t.uvSpectra.forEach((spec) => {
      const an = analyzeSpectrum(spec);
      if (!an) return;
      html += `
        <tr>
          <td style="padding: 5px; border: 1px solid #e2e8f0;"><b>${spec.name || '—'}</b></td>
          <td style="padding: 5px; border: 1px solid #e2e8f0;">${an.a260 != null ? an.a260.toFixed(3) : '—'}</td>
          <td style="padding: 5px; border: 1px solid #e2e8f0;">${an.r260_280 != null ? an.r260_280.toFixed(2) : '—'}</td>
          <td style="padding: 5px; border: 1px solid #e2e8f0;">${an.r260_230 != null ? an.r260_230.toFixed(2) : '—'}</td>
          <td style="padding: 5px; border: 1px solid #e2e8f0; color: #1d4ed8; font-family: monospace;"><b>${an.concNgUl != null ? an.concNgUl.toFixed(1) : '—'}</b></td>
        </tr>`;
    });
    html += `</table>`;
  }

  if (checked.gels && Array.isArray(t.gelImages) && t.gelImages.length) {
    html += `
      <h4 style="font-size: 12px; color: #334155; margin-bottom: 4px;">🧬 Gel Images</h4>
      <p style="font-size: 11px; color: #64748b;">${t.gelImages.length} gel image(s) attached.</p>`;
  }

  if (checked.sim && t.sim && t.sim.sequence) {
    html += `
      <p style="font-size: 12px; color: #475569; margin-bottom: 8px;">
        <b>Simulation:</b> ${t.sim.molType || 'dsDNA'} |
        <b>Conc.:</b> ${t.sim.conc || '—'} ${t.sim.concUnit || 'ng/µL'} |
        <b>Path:</b> ${t.sim.pathLengthMm || '10'} mm |
        <b>Length:</b> ${String(t.sim.sequence || '').replace(/[^A-Za-z]/g, '').length} residues
      </p>`;
  }

  return html;
};

/* ============================================================================
MAIN CLONING RENDERER
Operators (from App.jsx → Definitions & Labels) are forwarded explicitly
and rendered in the shell's Classification section.
========================================================================== */
export const CloningTestRenderer = (props) => {
  const appCategories =
    Array.isArray(props.testCategories) && props.testCategories.length
      ? props.testCategories
      : CLONING_TAB_CONFIG.fallbackCategories;

  const config = {
    ...CLONING_TAB_CONFIG,
    categories: appCategories,
    notebookChecks: [
      { id: 'cond', label: 'Classification & Conditions' },
      { id: 'strategy', label: 'Cloning Strategy' },
      { id: 'setup', label: 'Thermal Cycler & Reaction Mix' },
      { id: 'quant', label: 'DNA Quantification' },
      { id: 'uv', label: 'UV Spectra Analysis' },
      { id: 'gels', label: 'Gel Images' },
      { id: 'sim', label: 'Simulation Parameters' }
    ]
  };

  return (
    <TestShellRenderer
      {...props}
      config={config}
      custom={{
        Setup: CloningSetupSection,
        Data: CloningDataSection,
        Simulations: CloningSimulationsSection,
        buildNotebookHtml: buildCloningNotebookHtml
      }}
      testCategories={appCategories}
      operators={Array.isArray(props.operators) ? props.operators : []}
    />
  );
};

export default CloningTestRenderer;