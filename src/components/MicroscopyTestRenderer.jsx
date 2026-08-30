// components/MicroscopyTestRenderer.jsx
import React from 'react';
import TestShellRenderer from './TestShellRenderer';
import { MICROSCOPY_TAB_CONFIG } from './tabConfigs';
import { All, InstrumentalSetup, ExperimentalSetup, NotebookExtra } from './MicroscopySections';

export const MicroscopyTestRenderer = (props) => {
  const appCategories =
    Array.isArray(props.testCategories) && props.testCategories.length
      ? props.testCategories
      : MICROSCOPY_TAB_CONFIG.fallbackCategories;

  const config = {
    ...MICROSCOPY_TAB_CONFIG,
    categories: appCategories
  };

  return (
    <TestShellRenderer
      {...props}
      config={config}
      custom={{
        All: All,
        InstrumentalSetup: InstrumentalSetup,
        ExperimentalSetup: ExperimentalSetup,
        buildNotebookHtml: (checked, ctx) => {
          let html = '';
          if (checked.cond) html += NotebookExtra({ ctx, checkId: 'cond' });
          if (checked.instrument) html += NotebookExtra({ ctx, checkId: 'instrument' });
          if (checked.setup) html += NotebookExtra({ ctx, checkId: 'setup' });
          if (checked.data) html += NotebookExtra({ ctx, checkId: 'data' });
          if (checked.analysis) html += NotebookExtra({ ctx, checkId: 'analysis' });
          return html;
        }
      }}
      testCategories={appCategories}
    />
  );
};

export default MicroscopyTestRenderer;
