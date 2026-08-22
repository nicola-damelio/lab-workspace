// components/FlowCytometryTestRenderer.jsx
import React from 'react';
import TestShellRenderer from './TestShellRenderer';
import { FLOW_CYTOMETRY_TAB_CONFIG } from './tabConfigs';
import { All, InstrumentalSetup, NotebookExtra } from './FlowCytometrySections';

export const FlowCytometryTestRenderer = (props) => {
  const appCategories =
    Array.isArray(props.testCategories) && props.testCategories.length
      ? props.testCategories
      : FLOW_CYTOMETRY_TAB_CONFIG.fallbackCategories;

  const config = {
    ...FLOW_CYTOMETRY_TAB_CONFIG,
    categories: appCategories
  };

  return (
    <TestShellRenderer
      {...props}
      config={config}
      custom={{
        All: All,
        InstrumentalSetup: InstrumentalSetup,
        buildNotebookHtml: (checked, ctx) => {
          let html = '';
          if (checked.cond) html += NotebookExtra({ ctx, checkId: 'cond' });
          if (checked.instrument) html += NotebookExtra({ ctx, checkId: 'instrument' });
          if (checked.panel) html += NotebookExtra({ ctx, checkId: 'panel' });
          if (checked.gating) html += NotebookExtra({ ctx, checkId: 'gating' });
          return html;
        }
      }}
      testCategories={appCategories}
    />
  );
};

export default FlowCytometryTestRenderer;