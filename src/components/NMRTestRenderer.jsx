import React from 'react';
import TestShellRenderer, { CollapsibleSection } from './TestShellRenderer';
import { NMR_TAB_CONFIG } from './tabConfigs';
import * as NMRSections from './NMRSections';

/* ============================================================================
NMR renderer using the shared shell.
Common sections come from TestShellRenderer.
NMR-specific sections come from NMRSections.
========================================================================== */

const buildNmrNotebookHtml = (checked, ctx) => {
  const t = ctx.activeTest || {};
  let html = '';

  if (checked.cond) {
    html += `<p style="font-size: 12px; color: #475569; margin-bottom: 8px;">
      <b>Compound:</b> ${t.compound || 'N/A'} |
      <b>Solvent:</b> ${t.solvent || 'N/A'} |
      <b>Temperature:</b> ${t.temperature || 'N/A'} |
      <b>Concentration:</b> ${t.concentration || 'N/A'} |
      <b>Salt:</b> ${t.saltConcentration || 'N/A'} |
      <b>pH:</b> ${t.ph || 'N/A'} |
      <b>Other molecule:</b> ${t.otherMolecule || 'N/A'} |
      <b>Ratio:</b> ${t.ratio || 'N/A'}
    </p>`;
  }

  if (checked.seq) {
    html += `<p style="font-size: 12px; color: #475569; margin-bottom: 12px;">
      <b>Sequence:</b>
      <span style="font-family: monospace; background: #e2e8f0; padding: 2px 4px; border-radius: 4px;">
        ${t.proteinSequence || 'N/A'}
      </span>
    </p>`;
  }

  if (checked.table) {
    const shifts = t.chemicalShifts || {};

    if (Object.keys(shifts).length > 0) {
      html += `<table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 11px; text-align: left; background: white;">
        <tr style="background-color: #f1f5f9;">
          <th style="padding: 6px; border: 1px solid #cbd5e1;">Key</th>
          <th style="padding: 6px; border: 1px solid #cbd5e1;">Shift</th>
        </tr>`;

      Object.entries(shifts).forEach(([key, value]) => {
        html += `<tr>
          <td style="padding: 6px; border: 1px solid #e2e8f0; color: #334155;">${key}</td>
          <td style="padding: 6px; border: 1px solid #e2e8f0; color: #334155; font-family: monospace;">${value}</td>
        </tr>`;
      });

      html += `</table>`;
    }
  }

  if (checked.images) {
    const images = t.nmrSpectraImages || [];

    if (images.length > 0) {
      html += `<div style="margin-top: 15px;">
        <h5 style="color: #1e40af; font-size: 12px; margin-bottom: 8px;">📷 Spectra Images:</h5>`;

      images.forEach((imgSrc, idx) => {
        html += `<div style="margin-bottom: 10px;">
          <img src="${imgSrc}" alt="Spectrum ${idx + 1}" style="max-width: 100%; height: auto; border: 1px solid #e2e8f0; border-radius: 4px;"/>
          <p style="font-size: 10px; color: #64748b; margin-top: 4px;">Image ${idx + 1}</p>
        </div>`;
      });

      html += `</div>`;
    }
  }

  // Formula export is intentionally left empty in this minimal version.
  // It can be re-added later from the legacy NMR exporter.
  if (checked.formula) {
    html += '';
  }

  return html;
};

const NMRAll = ({ ctx }) => {
  return (
    <div className="flex flex-col gap-6">
      <NMRSections.Toolbar ctx={ctx} />

      <CollapsibleSection title="Sequence & Configuration" icon="🧬">
        <NMRSections.Setup ctx={ctx} />
      </CollapsibleSection>

      <CollapsibleSection title="Assignment Data" icon="📋">
        <NMRSections.Data ctx={ctx} />
      </CollapsibleSection>

      <CollapsibleSection title="Fitting" icon="📐">
        <div className="flex flex-col gap-6">
          <CollapsibleSection title="Error Management" icon="⚠️" defaultOpen={false}>
            <NMRSections.FittingErrors ctx={ctx} />
          </CollapsibleSection>

          <CollapsibleSection title="Graphical Parameters" icon="🎨" defaultOpen={false}>
            <NMRSections.FittingGraphics ctx={ctx} />
          </CollapsibleSection>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Simulations" icon="🧬" defaultOpen={false}>
        <NMRSections.Simulations ctx={ctx} />
      </CollapsibleSection>
    </div>
  );
};

export const NMRTestRenderer = (props) => {
  return (
    <TestShellRenderer
      {...props}
      config={NMR_TAB_CONFIG}
      custom={{
        All: NMRAll,
        buildNotebookHtml: buildNmrNotebookHtml
      }}
      testCategories={NMR_TAB_CONFIG.categories}
    />
  );
};

export default NMRTestRenderer;

