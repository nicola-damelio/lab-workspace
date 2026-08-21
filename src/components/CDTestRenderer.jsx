import React from 'react';
import TestShellRenderer from './TestShellRenderer';
import { CD_TAB_CONFIG } from './tabConfigs';
import { All, InstrumentalSetup, NotebookExtra } from './CDSections';

export const CDTestRenderer = (props) => {
  const appCategories =
    Array.isArray(props.testCategories) && props.testCategories.length
      ? props.testCategories
      : CD_TAB_CONFIG.fallbackCategories;

  const config = {
    ...CD_TAB_CONFIG,
    categories: appCategories,
    // Remove the cell-lines selector from "Compounds & Biological Models"
    samples: { ...CD_TAB_CONFIG.samples, cellLines: false }
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
          if (checked.spectra) html += NotebookExtra({ ctx, checkId: 'spectra' });
          if (checked.struct) html += NotebookExtra({ ctx, checkId: 'struct' });
          return html;
        }
      }}
      testCategories={appCategories}
    />
  );
};

export default CDTestRenderer;
