import React from 'react';
import TestShellRenderer from './TestShellRenderer';
import { NMR_TAB_CONFIG } from './tabConfigs';
import * as NMRSections from './NMRSections';

/* ============================================================================
NMR tab — thin wrapper around the shared shell.
FIXED SCHEMATIC STRUCTURE (same as the CD tab):
• Classification / Compounds & Biological Models / Experimental Conditions
  / Linked Protocols / Agenda / Comments / Images  → TestShellRenderer
• Experiment Setup → Data → Fitting → Simulations  → NMRSections.All
The Export button lives INSIDE the Data section (like CD).
========================================================================== */

// Read the active instance's chemical-shift values (instance/layer model).
const getActiveShifts = (t) => {
  const instances = Array.isArray(t.instances) && t.instances.length
    ? t.instances
    : [{ id: 'inst_default', name: 'Condition 1', values: { cs: t.chemicalShifts || {} } }];
  const active = instances.find((i) => i.id === t.activeInstanceId) || instances[0];
  return {
    instanceName: active?.name || 'N/A',
    shifts: (active && active.values && active.values.cs) || {}
  };
};

const buildNmrNotebookHtml = (checked, ctx) => {
  const t = ctx.activeTest || {};
  const { instanceName, shifts } = getActiveShifts(t);
  let html = '';

  if (checked.cond) {
    const sample =
      (ctx.selectedCompounds && ctx.selectedCompounds.length
        ? ctx.selectedCompounds.join(', ')
        : t.compound) || 'N/A';
    html += `<p style="font-size: 12px; color: #475569; margin-bottom: 8px;"><b>Sample:</b> ${sample} | <b>Condition:</b> ${instanceName} | <b>Solvent:</b> ${t.solvent || 'N/A'} | <b>Temp:</b> ${t.temperature || 'N/A'} | <b>Conc:</b> ${t.concentration || 'N/A'} | <b>Salt:</b> ${t.saltConcentration || 'N/A'} | <b>pH:</b> ${t.ph || 'N/A'} | <b>Other molecule:</b> ${t.otherMolecule || 'N/A'} | <b>Ratio:</b> ${t.ratio || 'N/A'}</p>`;
  }

  if (checked.seq) {
    html += `<p style="font-size: 12px; color: #475569; margin-bottom: 12px;"><b>Sequence:</b> <span style="font-family: monospace; background: #e2e8f0; padding: 2px 4px; border-radius: 4px;">${t.proteinSequence || 'N/A'}</span></p>`;
  }

  if (checked.table && Object.keys(shifts).length > 0) {
    html += `<table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 11px; text-align: left; background: white;"><tr style="background-color: #f1f5f9;"><th style="padding: 6px; border: 1px solid #cbd5e1;">Key</th><th style="padding: 6px; border: 1px solid #cbd5e1;">Shift</th></tr>`;
    Object.entries(shifts).forEach(([key, value]) => {
      html += `<tr><td style="padding: 6px; border: 1px solid #e2e8f0; color: #334155;">${key}</td><td style="padding: 6px; border: 1px solid #e2e8f0; color: #334155; font-family: monospace;">${value}</td></tr>`;
    });
    html += `</table>`;
  }

  if (checked.images) {
    const images = t.nmrSpectraImages || [];
    if (images.length > 0) {
      html += `<div style="margin-top: 15px;"><h5 style="color: #1e40af; font-size: 12px; margin-bottom: 8px;">📷 Spectra Images:</h5>`;
      images.forEach((imgSrc, idx) => {
        html += `<div style="margin-bottom: 10px;"><img src="${imgSrc}" alt="Spectrum ${idx + 1}" style="max-width: 100%; height: auto; border: 1px solid #e2e8f0; border-radius: 4px;"/><p style="font-size: 10px; color: #64748b; margin-top: 4px;">Image ${idx + 1}</p></div>`;
      });
      html += `</div>`;
    }
  }

  if (checked.formula) {
    // Formula export is handled by the "Formula → Notebook" button in Experiment Setup.
    html += '';
  }

  return html;
};

const NMR_CUSTOM = {
  All: NMRSections.All,
  NotebookExtra: NMRSections.NotebookExtra,
  buildNotebookHtml: buildNmrNotebookHtml
};

export const NMRTestRenderer = (props) => {
  return (
    <TestShellRenderer
      {...props}
      config={NMR_TAB_CONFIG}
      custom={NMR_CUSTOM}
      testCategories={props.testCategories || NMR_TAB_CONFIG.categories}
    />
  );
};

export default NMRTestRenderer;
